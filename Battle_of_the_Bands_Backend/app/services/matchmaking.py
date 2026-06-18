"""
WebSocket-based matchmaking and real-time game state manager.

Flow:
  1. Player connects → sends { type: "join_queue", userId, teamSize, genre }
  2. Server finds/creates a waiting match → sends { type: "match_found", matchId, teams, ... }
  3. All clients in a match get game state updates in real time
  4. When it's a player's turn, the server tells everyone who is recording
  5. After recording, the client uploads audio via HTTP then tells WS it's done
  6. Server advances turns, then moves to voting, then results

If a team has fewer real players than team_size, each real player gets
multiple turns so the total turn count stays at team_size per team.
If a player disconnects mid-game their turn is auto-skipped.
"""
import asyncio, json, random, uuid
from typing import Dict, List, Optional
from fastapi import WebSocket

MUSICAL_KEYS = [
    {"root": "C", "mode": "Major"}, {"root": "A", "mode": "Minor"},
    {"root": "G", "mode": "Major"}, {"root": "E", "mode": "Minor"},
    {"root": "D", "mode": "Major"}, {"root": "B", "mode": "Minor"},
    {"root": "F", "mode": "Major"}, {"root": "D", "mode": "Minor"},
    {"root": "Bb", "mode": "Major"}, {"root": "G", "mode": "Minor"},
    {"root": "F#", "mode": "Major"}, {"root": "C#", "mode": "Minor"},
]

COLORS = ["#a855f7","#22d3ee","#f472b6","#34d399","#fb923c","#818cf8","#f87171","#4ade80"]


class MatchRoom:
    def __init__(self, match_id: str, team_size: int, genre: str):
        self.match_id = match_id
        self.team_size = team_size
        self.genre = genre
        self.status = "waiting"   # waiting | in_progress | voting | done
        self.battle_key = random.choice(MUSICAL_KEYS)
        self.bpm = 90
        self.connections: Dict[str, WebSocket] = {}   # user_id -> websocket
        self.players: List[dict] = []                  # ordered: A0,B0,A1,B1,...
        self.turns: Dict[str, List[dict]] = {"A": [], "B": []}
        self.turn_idx: Dict[str, int] = {"A": 0, "B": 0}
        self.recordings: List[dict] = []
        self.disconnected: set = set()                 # user_ids that have disconnected
        self.timeout_version: int = 0                  # incremented on each join to cancel stale timeouts

    @property
    def human_count(self):
        return len(self.players)

    @property
    def total_slots(self):
        return self.team_size * 2

    def is_full(self):
        return len(self.players) >= self.total_slots

    def add_player(self, user_id: str, display_name: str, color: str, level: int, xp: int, xp_to_next: int):
        """Add a real player into the next open slot, alternating teams."""
        idx = len(self.players)
        team_id = "A" if idx % 2 == 0 else "B"
        team_idx = idx // 2
        player = {
            "id": user_id,
            "name": display_name,
            "level": level,
            "xp": xp,
            "xpToNext": xp_to_next,
            "color": color,
            "hasRecorded": False,
            "isRecording": False,
            "isNpc": False,
            "teamId": team_id,
            "playerIdx": team_idx,
        }
        self.players.append(player)
        self.timeout_version += 1   # invalidates any pending solo_timeout for this room
        return player

    def build_turns(self):
        """
        Build turn order: A0, B0, A1, B1, ... up to team_size slots per team.
        If a team has fewer players than team_size, players are assigned multiple
        turns (round-robin) so every slot is covered by a real player.
        """
        team_a = [p for p in self.players if p["teamId"] == "A"]
        team_b = [p for p in self.players if p["teamId"] == "B"]

        self.turns["A"] = []
        for slot in range(self.team_size):
            if team_a:
                self.turns["A"].append({"teamId": "A", "playerIdx": slot, "userId": team_a[slot % len(team_a)]["id"]})

        self.turns["B"] = []
        for slot in range(self.team_size):
            if team_b:
                self.turns["B"].append({"teamId": "B", "playerIdx": slot, "userId": team_b[slot % len(team_b)]["id"]})

    def get_teams(self):
        """
        Return teams with virtual player entries for every slot.
        A slot that is covered by a real player via round-robin shows that
        player's info but with the slot's playerIdx.
        """
        team_a_real = [p for p in self.players if p["teamId"] == "A"]
        team_b_real = [p for p in self.players if p["teamId"] == "B"]

        def build_slot_players(real_players, team_id):
            slots = []
            for slot in range(self.team_size):
                source = real_players[slot % len(real_players)]
                slot_player = dict(source)
                slot_player["playerIdx"] = slot
                # Mark if this player is covering an extra slot
                slot_player["isDoubledUp"] = (slot >= len(real_players))
                slots.append(slot_player)
            return slots

        return {
            "A": {"id": "A", "name": "Team A", "players": build_slot_players(team_a_real, "A")},
            "B": {"id": "B", "name": "Team B", "players": build_slot_players(team_b_real, "B")},
        }

    def get_current_turn(self, team_id: str):
        idx = self.turn_idx[team_id]
        if idx < len(self.turns[team_id]):
            return self.turns[team_id][idx]
        return None

    def get_current_player(self, team_id: str):
        """Get the real player object responsible for the current turn."""
        turn = self.get_current_turn(team_id)
        if not turn:
            return None
        user_id = turn.get("userId")
        for p in self.players:
            if p["id"] == user_id:
                return p
        return None

    def is_current_player_disconnected(self, team_id: str):
        player = self.get_current_player(team_id)
        return player is not None and player["id"] in self.disconnected

    def state_snapshot(self):
        return {
            "matchId": self.match_id,
            "status": self.status,
            "teams": self.get_teams(),
            "battleKey": self.battle_key,
            "bpm": self.bpm,
            "currentTurns": {
                "A": self.turn_idx["A"] if self.turn_idx["A"] < self.team_size else None,
                "B": self.turn_idx["B"] if self.turn_idx["B"] < self.team_size else None,
            },
            "turnIdx": max(self.turn_idx["A"], self.turn_idx["B"]),
            "totalTurns": self.team_size,
            "recordings": self.recordings,
        }

    async def broadcast(self, msg: dict, exclude: Optional[str] = None):
        dead = []
        for uid, ws in self.connections.items():
            if uid == exclude:
                continue
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(uid)
        for uid in dead:
            self.connections.pop(uid, None)

    async def broadcast_all(self, msg: dict):
        await self.broadcast(msg)


# ---- Global matchmaking queues ----
_waiting_rooms: Dict[tuple, List[MatchRoom]] = {}
_active_rooms: Dict[str, MatchRoom] = {}

SOLO_TIMEOUT_SECS = 30  # wait this long before starting with available players


def get_or_create_room(team_size: int, genre: str) -> MatchRoom:
    key = (team_size, genre)
    if key not in _waiting_rooms:
        _waiting_rooms[key] = []
    waiting = _waiting_rooms[key]
    for room in waiting:
        if not room.is_full() and room.status == "waiting":
            return room
    match_id = str(uuid.uuid4())
    room = MatchRoom(match_id, team_size, genre)
    waiting.append(room)
    _active_rooms[match_id] = room
    return room


def get_room(match_id: str) -> Optional[MatchRoom]:
    return _active_rooms.get(match_id)


def get_queue_counts() -> Dict[str, int]:
    """
    Get the current player count in each genre's waiting queue.
    Returns a dict with genre names as keys and player counts as values.
    Counts only waiting rooms (not in-progress or completed matches).
    """
    genres = ["Rock", "Hip-Hop", "Pop", "R&B", "Freestyle"]
    team_sizes = [3, 4]
    
    counts = {genre: 0 for genre in genres}
    
    for (team_size, genre), rooms in _waiting_rooms.items():
        for room in rooms:
            if room.status == "waiting":
                counts[genre] += room.human_count
    
    return counts


async def start_match(room: MatchRoom, db=None):
    """Require at least 1 player per team, build turns, broadcast game start."""
    team_a = [p for p in room.players if p["teamId"] == "A"]
    team_b = [p for p in room.players if p["teamId"] == "B"]

    # Need at least one player per side to start. If one side is completely
    # empty after the solo timeout, we can't form a match (there's no one to
    # build a virtual roster from) — tell the waiting clients instead of
    # silently leaving them on the "searching" screen forever.
    if not team_a or not team_b:
        await room.broadcast_all({
            "type": "queued",
            "matchId": room.match_id,
            "playersJoined": room.human_count,
            "playersNeeded": room.total_slots,
            "stalled": True,
            "message": "Still waiting for at least one player on each side...",
        })
        return

    room.build_turns()
    room.status = "in_progress"

    if db:
        from app.models import Match, MatchPlayer
        match = Match(
            id=room.match_id,
            team_size=room.team_size,
            genre=room.genre,
            battle_key_root=room.battle_key["root"],
            battle_key_mode=room.battle_key["mode"],
            bpm=room.bpm,
            status="in_progress",
        )
        db.add(match)
        for p in room.players:
            mp = MatchPlayer(
                match_id=room.match_id,
                user_id=p["id"],
                team_id=p["teamId"],
                player_idx=p["playerIdx"],
            )
            db.add(mp)
        await db.commit()

    # Mark the first players as recording
    for team_id in ["A", "B"]:
        p = room.get_current_player(team_id)
        if p: p["isRecording"] = True

    await room.broadcast_all({
        "type": "game_start",
        **room.state_snapshot(),
    })


async def advance_turn(room: MatchRoom, team_id: str, recording: Optional[dict] = None, db=None):
    """Move to next turn, skipping disconnected players, or end game if all turns done."""
    if recording:
        room.recordings.append(recording)

    room.turn_idx[team_id] += 1

    # Skip over any disconnected players' turns
    while True:
        current = room.get_current_turn(team_id)

        if current is None:
            break

        # If the current player is disconnected, auto-skip their turn
        if room.is_current_player_disconnected(team_id):
            await room.broadcast_all({
                "type": "turn_advance",
                "skippedUserId": current.get("userId"),
                "reason": "disconnected",
                **room.state_snapshot(),
            })
            room.turn_idx[team_id] += 1
            continue

        # Valid turn — mark player as recording and notify everyone
        player = room.get_current_player(team_id)
        if player:
            player["isRecording"] = True
        break

    if room.turn_idx["A"] >= room.team_size and room.turn_idx["B"] >= room.team_size:
        room.status = "voting"
        await room.broadcast_all({
            "type": "voting_start",
            **room.state_snapshot(),
        })
        return

        await room.broadcast_all({
            "type": "turn_advance",
            **room.state_snapshot(),
        })
        return


async def handle_disconnect_during_turn(room: MatchRoom, user_id: str):
    """Called when a player disconnects and it is currently their turn."""
    for team_id in ["A", "B"]:
        current_turn = room.get_current_turn(team_id)
        if current_turn and current_turn.get("userId") == user_id:
            # Auto-advance immediately so other players aren't stuck
            await advance_turn(room, team_id, recording=None)


async def handle_vote_complete(room: MatchRoom, winner: str, votes_a: int, votes_b: int,
                                mvp_a_id: str, mvp_b_id: str, db=None):
    room.status = "done"
    await room.broadcast_all({
        "type": "results",
        "matchId": room.match_id,
        "winner": winner,
        "votes": {"A": votes_a, "B": votes_b},
        "mvp": {"A": mvp_a_id, "B": mvp_b_id},
        "recordings": room.recordings,
        "teams": room.get_teams(),
    })

    for key, rooms in _waiting_rooms.items():
        if room in rooms:
            rooms.remove(room)


class ConnectionManager:
    async def connect(self, websocket: WebSocket, match_id: str, user_id: str):
        room = get_room(match_id)
        if room:
            room.connections[user_id] = websocket
            room.disconnected.discard(user_id)

    async def disconnect(self, match_id: str, user_id: str):
        room = get_room(match_id)
        if room:
            room.connections.pop(user_id, None)
            room.disconnected.add(user_id)
            await room.broadcast_all({
                "type": "player_disconnected",
                "userId": user_id,
            })
            # If it was their turn, skip it immediately
            if room.status == "in_progress":
                await handle_disconnect_during_turn(room, user_id)


manager = ConnectionManager()
