"""
WebSocket-based matchmaking and real-time game state manager.

Flow:
  1. Player connects → sends { type: "join_queue", userId, teamSize, genre }
  2. Server finds/creates a waiting match → sends { type: "match_found", matchId, teams, ... }
  3. All clients in a match get game state updates in real time
  4. When it's a player's turn, the server tells everyone who is recording
  5. After recording, the client uploads audio via HTTP then tells WS it's done
  6. Server advances turns, then moves to voting, then results
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
NPC_NAMES = ["Remy", "Jade", "Axel", "Nova", "Kash", "Blix", "Storm", "Echo"]

def make_npc(team_id: str, idx: int, color: str) -> dict:
    return {
        "id": f"npc-{team_id}-{idx}-{uuid.uuid4().hex[:6]}",
        "name": random.choice(NPC_NAMES),
        "level": random.randint(1, 30),
        "xp": random.randint(100, 800),
        "xpToNext": 1000,
        "color": color,
        "hasRecorded": False,
        "isRecording": False,
        "isNpc": True,
        "teamId": team_id,
        "playerIdx": idx,
    }

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
        self.turns: List[dict] = []                    # [{teamId, playerIdx}]
        self.turn_idx = 0
        self.recordings: List[dict] = []               # kept recordings

    @property
    def human_count(self):
        return sum(1 for p in self.players if not p.get("isNpc"))

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
        return player

    def fill_with_npcs(self):
        """Fill remaining slots with NPCs."""
        while len(self.players) < self.total_slots:
            idx = len(self.players)
            team_id = "A" if idx % 2 == 0 else "B"
            team_idx = idx // 2
            color = COLORS[(idx + 2) % len(COLORS)]
            npc = make_npc(team_id, team_idx, color)
            npc["playerIdx"] = team_idx
            self.players.append(npc)

    def build_turns(self):
        """Build turn order: A0, B0, A1, B1, A2, B2 ..."""
        turns = []
        for i in range(self.team_size):
            turns.append({"teamId": "A", "playerIdx": i})
            turns.append({"teamId": "B", "playerIdx": i})
        self.turns = turns

    def get_teams(self):
        team_a = [p for p in self.players if p["teamId"] == "A"]
        team_b = [p for p in self.players if p["teamId"] == "B"]
        # Sort by playerIdx
        team_a.sort(key=lambda p: p["playerIdx"])
        team_b.sort(key=lambda p: p["playerIdx"])
        return {
            "A": {"id": "A", "name": "Team A", "players": team_a},
            "B": {"id": "B", "name": "Team B", "players": team_b},
        }

    def get_current_turn(self):
        if self.turn_idx < len(self.turns):
            return self.turns[self.turn_idx]
        return None

    def get_current_player(self):
        turn = self.get_current_turn()
        if not turn:
            return None
        for p in self.players:
            if p["teamId"] == turn["teamId"] and p["playerIdx"] == turn["playerIdx"]:
                return p
        return None

    def state_snapshot(self):
        return {
            "matchId": self.match_id,
            "status": self.status,
            "teams": self.get_teams(),
            "battleKey": self.battle_key,
            "bpm": self.bpm,
            "currentTurn": self.get_current_turn(),
            "turnIdx": self.turn_idx,
            "totalTurns": len(self.turns),
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
# key: (team_size, genre) -> list of waiting MatchRoom
_waiting_rooms: Dict[tuple, List[MatchRoom]] = {}
# key: match_id -> MatchRoom
_active_rooms: Dict[str, MatchRoom] = {}

SOLO_TIMEOUT_SECS = 12  # wait this long before filling with NPCs


def get_or_create_room(team_size: int, genre: str) -> MatchRoom:
    key = (team_size, genre)
    if key not in _waiting_rooms:
        _waiting_rooms[key] = []
    waiting = _waiting_rooms[key]
    # Find a room with space
    for room in waiting:
        if not room.is_full() and room.status == "waiting":
            return room
    # Create new room
    match_id = str(uuid.uuid4())
    room = MatchRoom(match_id, team_size, genre)
    waiting.append(room)
    _active_rooms[match_id] = room
    return room


def get_room(match_id: str) -> Optional[MatchRoom]:
    return _active_rooms.get(match_id)


async def start_match(room: MatchRoom, db=None):
    """Fill empty slots with NPCs, build turns, broadcast game start."""
    room.fill_with_npcs()
    room.build_turns()
    room.status = "in_progress"

    # Save match to DB if db provided
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
            if not p.get("isNpc"):
                mp = MatchPlayer(
                    match_id=room.match_id,
                    user_id=p["id"],
                    team_id=p["teamId"],
                    player_idx=p["playerIdx"],
                )
                db.add(mp)
        await db.commit()

    current = room.get_current_turn()
    await room.broadcast_all({
        "type": "game_start",
        **room.state_snapshot(),
    })

    # If first turn is an NPC, auto-advance after a delay
    await maybe_auto_advance(room)


async def maybe_auto_advance(room: MatchRoom):
    """If the current turn belongs to an NPC, auto-advance after a short delay."""
    player = room.get_current_player()
    if player and player.get("isNpc"):
        await asyncio.sleep(random.uniform(3.0, 5.0))
        # Mark NPC as recorded
        for p in room.players:
            if p["id"] == player["id"]:
                p["hasRecorded"] = True
                p["isRecording"] = False
        await advance_turn(room)


async def advance_turn(room: MatchRoom, recording: Optional[dict] = None, db=None):
    """Move to next turn, or end game if all turns done."""
    if recording:
        room.recordings.append(recording)

    room.turn_idx += 1
    current = room.get_current_turn()

    if current is None:
        # All turns done — move to voting
        room.status = "voting"
        await room.broadcast_all({
            "type": "voting_start",
            **room.state_snapshot(),
        })
        return

    # Mark current player as recording
    player = room.get_current_player()
    if player:
        player["isRecording"] = True

    await room.broadcast_all({
        "type": "turn_advance",
        **room.state_snapshot(),
    })

    await maybe_auto_advance(room)


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

    # Clean up waiting queue
    for key, rooms in _waiting_rooms.items():
        if room in rooms:
            rooms.remove(room)


class ConnectionManager:
    async def connect(self, websocket: WebSocket, match_id: str, user_id: str):
        room = get_room(match_id)
        if room:
            room.connections[user_id] = websocket

    async def disconnect(self, match_id: str, user_id: str):
        room = get_room(match_id)
        if room:
            room.connections.pop(user_id, None)
            await room.broadcast_all({
                "type": "player_disconnected",
                "userId": user_id,
            })


manager = ConnectionManager()
