"""
WebSocket-based matchmaking and real-time game state manager.

Flow:
  1. Player connects → sends { type: "join_queue", userId, teamSize, genre }
  2. Server waits until the room is full (all slots filled with real players)
  3. Server sends { type: "game_start", matchId, teams, ... } to everyone
  4. Both teams record AT THE SAME TIME — each team has its own independent
     turn order, so Team A and Team B never wait on each other. The state
     snapshot carries both `currentTurnA` and `currentTurnB`.
  5. After a player records, the recorder uploads audio via HTTP then sends
     { type: "loop_vote_request", matchId, recording } to trigger their
     OWN team's teammate votes (the other team keeps recording in parallel)
  6. Each teammate sends { type: "loop_vote_cast", matchId, vote: "keep"|"drop" }
  7. Server tallies that team's loop votes (tie = keep) and broadcasts
     loop_vote_result (scoped to that team)
  8. That team's turn advances independently. Once BOTH teams have finished
     every turn, the game moves to voting.
  9. In voting, each player sends { type: "song_vote", ... } and { type: "mvp_vote", ... }
 10. Server tallies when all votes in, broadcasts results

If a room is not full, players remain on the searching screen until enough
players have joined to fill every slot.
If a player disconnects mid-game their turn is auto-skipped (only affects
their own team's turn order — the other team is unaffected).
"""
import asyncio, json, logging, random, uuid
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

TEAM_IDS = ("A", "B")


def _new_loop_vote_state() -> dict:
    return {
        "recorder_id": None,
        "votes": {},            # voter_id -> "keep"|"drop"
        "expected": 0,          # how many teammates need to vote
        "resolved": True,       # no vote in progress until reset
        "timer_task": None,     # 30-second timeout task
        "pending_recording": None,  # authoritative recording for this team's in-flight vote
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

        # Per-team turn order/index — teams record fully independently of
        # one another, so neither team ever waits on the other.
        self.turns: Dict[str, List[dict]] = {"A": [], "B": []}     # [{playerIdx, userId}]
        self.turn_idx: Dict[str, int] = {"A": 0, "B": 0}

        self.recordings: List[dict] = []
        self.disconnected: set = set()                 # user_ids that have disconnected

        # In-memory audio store: recording_id -> base64 audio data
        # Lets teammates receive audio instantly via WebSocket without an HTTP round-trip.
        self.audio_store: Dict[str, str] = {}

        # Per-team loop vote state (each team can be mid-vote at the same time).
        self.loop_vote: Dict[str, dict] = {"A": _new_loop_vote_state(), "B": _new_loop_vote_state()}

        # End-of-game vote state
        self.song_votes: List[dict] = []               # [{voter_id, ratingA, ratingB}]
        self.mvp_votes: List[dict] = []                # [{voter_id, pickA, pickB}]
        self.end_votes_expected: int = 0               # total players
        self.end_vote_timer_task: Optional[asyncio.Task] = None   # 30-second timeout task

    @property
    def human_count(self):
        return len(self.players)

    @property
    def total_slots(self):
        return self.team_size * 2

    def is_full(self):
        return len(self.players) >= self.total_slots

    def already_has_player(self, user_id: str) -> bool:
        return any(p["id"] == user_id for p in self.players)

    def add_player(self, user_id: str, display_name: str, color: str, level: int, xp: int, xp_to_next: int):
        """Add a real player into the next open slot, alternating teams. No-op if already in room."""
        if self.already_has_player(user_id):
            return next(p for p in self.players if p["id"] == user_id)
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

    def build_turns(self):
        """Build an independent turn order per team: each team just goes through
        its own players slot by slot, with no interleaving between teams."""
        team_a = [p for p in self.players if p["teamId"] == "A"]
        team_b = [p for p in self.players if p["teamId"] == "B"]
        self.turns["A"] = [{"teamId": "A", "playerIdx": i, "userId": team_a[i]["id"]} for i in range(self.team_size)]
        self.turns["B"] = [{"teamId": "B", "playerIdx": i, "userId": team_b[i]["id"]} for i in range(self.team_size)]
        self.turn_idx = {"A": 0, "B": 0}
        self.end_votes_expected = len(self.players)

    def get_teams(self):
        team_a = [p for p in self.players if p["teamId"] == "A"]
        team_b = [p for p in self.players if p["teamId"] == "B"]
        return {
            "A": {"id": "A", "name": "Team A", "players": team_a},
            "B": {"id": "B", "name": "Team B", "players": team_b},
        }

    def get_current_turn(self, team_id: str):
        turns = self.turns.get(team_id, [])
        idx = self.turn_idx.get(team_id, 0)
        if idx < len(turns):
            return turns[idx]
        return None

    def get_current_player(self, team_id: str):
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

    def team_turns_done(self, team_id: str) -> bool:
        return self.turn_idx.get(team_id, 0) >= len(self.turns.get(team_id, []))

    def find_recorder_team(self, recorder_id: str) -> Optional[str]:
        """Figure out which team's current turn belongs to this recorder."""
        for team_id in TEAM_IDS:
            t = self.get_current_turn(team_id)
            if t and t.get("userId") == recorder_id:
                return team_id
        return None

    def store_audio(self, recording_id: str, audio_b64: str):
        """Temporarily cache base64 audio for instant delivery to teammates via WebSocket."""
        self.audio_store[recording_id] = audio_b64

    def get_audio(self, recording_id: str) -> Optional[str]:
        """Retrieve cached base64 audio for a recording, or None if not cached."""
        return self.audio_store.get(recording_id)

    def get_team_members(self, team_id: str) -> List[dict]:
        return [p for p in self.players if p["teamId"] == team_id]

    def cancel_loop_vote_timer(self, team_id: str):
        """Cancel any running loop-vote timeout task for one team."""
        lv = self.loop_vote[team_id]
        task = lv.get("timer_task")
        if task and not task.done():
            task.cancel()
        lv["timer_task"] = None

    def cancel_end_vote_timer(self):
        """Cancel any running end-of-game vote timeout task."""
        if self.end_vote_timer_task and not self.end_vote_timer_task.done():
            self.end_vote_timer_task.cancel()
        self.end_vote_timer_task = None

    def reset_loop_vote(self, team_id: str, recorder_id: str):
        """Set up a fresh loop vote for the given recorder, scoped to their team."""
        self.cancel_loop_vote_timer(team_id)
        lv = self.loop_vote[team_id]
        lv["recorder_id"] = recorder_id
        lv["votes"] = {}
        lv["resolved"] = False
        lv["pending_recording"] = None  # cleared until recorder's recording arrives
        # Only teammates (same team, not the recorder) vote
        teammates = [p for p in self.players
                     if p["teamId"] == team_id and p["id"] != recorder_id]
        lv["expected"] = len(teammates)

    def tally_loop_vote(self, team_id: str) -> bool:
        """Return True (keep) if keep votes >= drop votes, or no connected voters."""
        lv = self.loop_vote[team_id]
        connected_voters = [
            p for p in self.players
            if p["teamId"] == team_id
            and p["id"] != lv["recorder_id"]
            and p["id"] not in self.disconnected
        ]
        if not connected_voters or lv["expected"] == 0:
            return True  # no one to vote — auto-keep
        keep_count = sum(1 for v in lv["votes"].values() if v == "keep")
        drop_count = sum(1 for v in lv["votes"].values() if v == "drop")
        # Tie goes to keep
        return keep_count >= drop_count

    def all_loop_votes_in(self, team_id: str) -> bool:
        lv = self.loop_vote[team_id]
        connected_voters = [
            p for p in self.players
            if p["teamId"] == team_id
            and p["id"] != lv["recorder_id"]
            and p["id"] not in self.disconnected
        ]
        return len(lv["votes"]) >= len(connected_voters)

    def state_snapshot(self, include_audio: bool = False):
        recordings = self.recordings
        if include_audio:
            # Attach cached base64 audio to each recording so the next player
            # can play the team stack immediately without HTTP fetches
            enriched = []
            for rec in recordings:
                rec_copy = dict(rec)
                cached = self.get_audio(rec.get("id", ""))
                if cached:
                    rec_copy["audiob64"] = cached
                enriched.append(rec_copy)
            recordings = enriched
        return {
            "matchId": self.match_id,
            "status": self.status,
            "teams": self.get_teams(),
            "battleKey": self.battle_key,
            "bpm": self.bpm,
            # Both teams' current turns are sent together — that's what lets
            # the client run two independent recording flows side by side.
            "currentTurnA": self.get_current_turn("A"),
            "currentTurnB": self.get_current_turn("B"),
            "turnIdxA": self.turn_idx["A"],
            "turnIdxB": self.turn_idx["B"],
            "totalTurns": self.team_size,
            "recordings": recordings,
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

    async def send_to(self, user_id: str, msg: dict):
        ws = self.connections.get(user_id)
        if ws:
            try:
                await ws.send_json(msg)
            except Exception:
                self.connections.pop(user_id, None)


# ---- Global matchmaking queues ----
_waiting_rooms: Dict[tuple, List[MatchRoom]] = {}
_active_rooms: Dict[str, MatchRoom] = {}


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
    genres = ["Rock", "Hip-Hop", "Pop", "R&B", "Freestyle"]
    counts = {genre: 0 for genre in genres}
    for (team_size, genre), rooms in _waiting_rooms.items():
        for room in rooms:
            if room.status == "waiting":
                counts[genre] += room.human_count
    return counts


async def start_match(room: MatchRoom, db=None):
    if not room.is_full():
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

    # Both teams' first players start recording at the same time.
    for team_id in TEAM_IDS:
        first_player = room.get_current_player(team_id)
        if first_player:
            first_player["isRecording"] = True

    await room.broadcast_all({
        "type": "game_start",
        **room.state_snapshot(),
    })


LOOP_VOTE_TIMEOUT_SECS = 30
END_VOTE_TIMEOUT_SECS = 30


async def _loop_vote_timeout(room: MatchRoom, team_id: str):
    """Auto-keep the loop after LOOP_VOTE_TIMEOUT_SECS if not all votes are in."""
    await asyncio.sleep(LOOP_VOTE_TIMEOUT_SECS)
    lv = room.loop_vote[team_id]
    if not lv["resolved"]:
        lv["resolved"] = True
        # Broadcast that time ran out so clients can update their UI
        await room.broadcast_all({
            "type": "loop_vote_timeout",
            "matchId": room.match_id,
            "teamId": team_id,
        })
        kept = room.tally_loop_vote(team_id)  # partial votes still count; tie/empty → keep
        await finish_loop_vote(room, team_id, kept=kept, recording=lv["pending_recording"] if kept else None)


async def _end_vote_timeout(room: MatchRoom):
    """Tally whatever end-of-game votes arrived after END_VOTE_TIMEOUT_SECS."""
    await asyncio.sleep(END_VOTE_TIMEOUT_SECS)
    if room.status != "done":
        await room.broadcast_all({
            "type": "end_vote_timeout",
            "matchId": room.match_id,
        })
        try:
            from app.database import AsyncSessionLocal
            async with AsyncSessionLocal() as db:
                await _force_finish_voting(room, db=db)
        except Exception:
            # If DB is unavailable, still finish the match without XP
            await _force_finish_voting(room, db=None)


async def _force_finish_voting(room: MatchRoom, db=None):
    """Tally partial votes and finish the match (used by timer and disconnect paths)."""
    if room.status == "done":
        return
    room.cancel_end_vote_timer()

    total_a = sum(v.get("ratingA", 0) for v in room.song_votes)
    total_b = sum(v.get("ratingB", 0) for v in room.song_votes)
    winner = "A" if total_a >= total_b else "B"

    mvp_tally: Dict[str, int] = {}
    for v in room.mvp_votes:
        mvp_tally[v["pickA"]] = mvp_tally.get(v["pickA"], 0) + 1
        mvp_tally[v["pickB"]] = mvp_tally.get(v["pickB"], 0) + 1

    def find_mvp(player_ids: List[str]) -> str:
        best = player_ids[0] if player_ids else ""
        best_count = 0
        for pid in player_ids:
            if mvp_tally.get(pid, 0) > best_count:
                best_count = mvp_tally[pid]
                best = pid
        return best

    team_a_ids = [p["id"] for p in room.players if p["teamId"] == "A"]
    team_b_ids = [p["id"] for p in room.players if p["teamId"] == "B"]
    mvp_a = find_mvp(team_a_ids)
    mvp_b = find_mvp(team_b_ids)

    await handle_vote_complete(
        room,
        winner=winner,
        votes_a=total_a,
        votes_b=total_b,
        mvp_a_id=mvp_a,
        mvp_b_id=mvp_b,
        db=db,
    )


async def start_loop_vote(room: MatchRoom, recorder_id: str, recording: Optional[dict], audio_b64: Optional[str] = None):
    """
    Broadcast a loop_vote_request to the recorder's teammates ONLY — the other
    team is completely unaffected and keeps recording in parallel.
    If recording is None (recorder skipped), auto-advance immediately.
    If there are no connected teammates, auto-keep immediately.
    If audio_b64 is provided, cache it in the room and send it to teammates so they
    can play back the loop instantly without an HTTP round-trip.
    A 30-second countdown timer is started; if not all votes arrive in time the
    partial tally is used (ties and empty votes → keep).
    """
    team_id = room.find_recorder_team(recorder_id)
    if team_id is None:
        return  # not actually this player's turn — ignore stray/late message

    room.reset_loop_vote(team_id, recorder_id)
    lv = room.loop_vote[team_id]

    # Cache audio for instant teammate playback if provided
    if audio_b64 and recording and recording.get("id"):
        room.store_audio(recording["id"], audio_b64)

    # Store the recording server-side — finish_loop_vote will use this authoritative
    # copy instead of relying on clients to re-send it in loop_vote_cast.
    if recording:
        lv["pending_recording"] = recording

    # Recorder skipped — no recording to vote on, just advance the turn
    if recording is None:
        await finish_loop_vote(room, team_id, kept=False, recording=None)
        return

    teammates = [
        p for p in room.players
        if p["teamId"] == team_id and p["id"] != recorder_id
        and p["id"] not in room.disconnected
    ]

    if not teammates:
        # No one to vote — auto-keep
        await finish_loop_vote(room, team_id, kept=True, recording=recording)
        return

    # Build the vote request payload — include audio_b64 so teammates can decode immediately
    vote_payload: dict = {
        "type": "loop_vote_request",
        "matchId": room.match_id,
        "teamId": team_id,
        "recording": recording,
        "recorderId": recorder_id,
        "recorderName": next(
            (pl["name"] for pl in room.players if pl["id"] == recorder_id), "?"
        ),
        "timeoutSecs": LOOP_VOTE_TIMEOUT_SECS,
    }
    if audio_b64:
        vote_payload["audiob64"] = audio_b64

    # Also include the full team stack (previous recordings) with their cached audio
    # so the teammate's LoopVoteModal and RecordingModal can play everything immediately
    team_stack_with_audio = []
    for rec in room.recordings:
        if rec.get("teamId") == team_id:
            rec_copy = dict(rec)
            cached = room.get_audio(rec.get("id", ""))
            if cached:
                rec_copy["audiob64"] = cached
            team_stack_with_audio.append(rec_copy)
    vote_payload["teamStack"] = team_stack_with_audio

    # Send individual vote request to each teammate
    for p in teammates:
        await room.send_to(p["id"], vote_payload)

    # Start 30-second timeout — auto-resolves with partial tally if voters are slow
    lv["timer_task"] = asyncio.create_task(_loop_vote_timeout(room, team_id))


async def receive_loop_vote(room: MatchRoom, voter_id: str, vote: str):
    """Record a teammate's keep/drop vote and tally when all are in (scoped to their team)."""
    voter = next((p for p in room.players if p["id"] == voter_id), None)
    if not voter:
        return
    team_id = voter["teamId"]
    lv = room.loop_vote[team_id]

    # Only accept votes from teammates of the current vote's team
    if lv["recorder_id"] is None or voter_id == lv["recorder_id"]:
        return

    lv["votes"][voter_id] = vote

    if not lv["resolved"] and room.all_loop_votes_in(team_id):
        lv["resolved"] = True
        room.cancel_loop_vote_timer(team_id)
        kept = room.tally_loop_vote(team_id)
        # Always use the server-stored recording — never trust the client to re-send it
        recording = lv["pending_recording"]
        await finish_loop_vote(room, team_id, kept=kept, recording=recording if kept else None)


async def finish_loop_vote(room: MatchRoom, team_id: str, kept: bool, recording: Optional[dict]):
    """Broadcast the loop vote result (to that team) and advance that team's turn only."""
    room.cancel_loop_vote_timer(team_id)
    lv = room.loop_vote[team_id]
    keep_count = sum(1 for v in lv["votes"].values() if v == "keep")
    drop_count = sum(1 for v in lv["votes"].values() if v == "drop")

    if kept and recording:
        room.recordings.append(recording)

    await room.broadcast_all({
        "type": "loop_vote_result",
        "matchId": room.match_id,
        "teamId": team_id,
        "kept": kept,
        "keepCount": keep_count,
        "dropCount": drop_count,
        "recorderName": next(
            (p["name"] for p in room.players if p["id"] == lv["recorder_id"]), "?"
        ),
        # Include the recording so clients can update their local stack
        # without racing against pendingRecordingRef being cleared by turn_advance
        "recording": recording if kept else None,
    })

    # Advance only this team's turn — the other team is unaffected.
    await advance_turn(room, team_id, recording=None)  # recording already appended above


async def advance_turn(room: MatchRoom, team_id: str, recording: Optional[dict] = None, db=None):
    """Move to this team's next turn, skipping disconnected players, or mark the team
    done. Once BOTH teams have finished all turns, the game moves to voting."""
    if recording:
        room.recordings.append(recording)

    # Clear isRecording for this team's current player before advancing
    player = room.get_current_player(team_id)
    if player:
        player["isRecording"] = False
        player["hasRecorded"] = True

    room.turn_idx[team_id] += 1

    while True:
        current = room.get_current_turn(team_id)

        if current is None:
            # This team is done with all its turns.
            await room.broadcast_all({
                "type": "turn_advance",
                "teamId": team_id,
                **room.state_snapshot(include_audio=True),
            })
            break

        if room.is_current_player_disconnected(team_id):
            await room.broadcast_all({
                "type": "turn_advance",
                "teamId": team_id,
                "skippedUserId": current.get("userId"),
                "reason": "disconnected",
                **room.state_snapshot(include_audio=True),
            })
            room.turn_idx[team_id] += 1
            continue

        next_player = room.get_current_player(team_id)
        if next_player:
            next_player["isRecording"] = True

        await room.broadcast_all({
            "type": "turn_advance",
            "teamId": team_id,
            **room.state_snapshot(include_audio=True),
        })
        break

    # Only move to voting once BOTH teams have finished every turn.
    if room.status == "in_progress" and room.team_turns_done("A") and room.team_turns_done("B"):
        room.status = "voting"
        await room.broadcast_all({
            "type": "voting_start",
            **room.state_snapshot(include_audio=True),
            "timeoutSecs": END_VOTE_TIMEOUT_SECS,
        })
        room.end_vote_timer_task = asyncio.create_task(_end_vote_timeout(room))


async def handle_disconnect_during_turn(room: MatchRoom, user_id: str):
    """If this user was up for either team, skip just that team's turn —
    the other team keeps recording uninterrupted."""
    for team_id in TEAM_IDS:
        current_turn = room.get_current_turn(team_id)
        if current_turn and current_turn.get("userId") == user_id:
            await advance_turn(room, team_id, recording=None)


async def receive_song_vote(room: MatchRoom, voter_id: str, rating_a: int, rating_b: int):
    """Record one player's song ratings. Proceed to MVP phase message when all in."""
    if any(v.get("voter_id") == voter_id for v in room.song_votes):
        return
    room.song_votes.append({"voter_id": voter_id, "ratingA": rating_a, "ratingB": rating_b})
    # No broadcast needed — client already knows to move to MVP phase after submitting


async def check_and_finish_voting(room: MatchRoom, db=None):
    connected_players = [p for p in room.players if p["id"] not in room.disconnected and not p.get("isNpc")]
    if len(room.mvp_votes) < len(connected_players) or len(connected_players) == 0:
        return  # Still waiting for more votes

    room.cancel_end_vote_timer()
    await _force_finish_voting(room, db=db)

async def receive_mvp_vote(room: MatchRoom, voter_id: str, pick_a: str, pick_b: str, db=None):
    """Record one player's MVP picks. Tally and broadcast results when all in."""
    if any(v["voter_id"] == voter_id for v in room.mvp_votes):
        return
    room.mvp_votes.append({"voter_id": voter_id, "pickA": pick_a, "pickB": pick_b})
    await check_and_finish_voting(room, db=db)


async def handle_vote_complete(room: MatchRoom, winner: str, votes_a: int, votes_b: int,
                                mvp_a_id: str, mvp_b_id: str, db=None):
    # Guard against double-award: a disconnect during voting can re-trigger
    # check_and_finish_voting after the match has already been scored once.
    if room.status == "done":
        return
    room.status = "done"

    any_failure = False  # initialised here so the broadcast below can reference it even when db=None
    if db:
        from app.models import Match, User
        from app.services.xp_system import apply_xp

        try:
            db_match = await db.get(Match, room.match_id)
            if db_match:
                db_match.status = "done"
                db_match.winner_team = winner
        except Exception as match_err:
            logging.exception("Failed to update Match status for %s", room.match_id)

        for p in room.players:
            if p.get("isNpc"): continue

            try:
                user = await db.get(User, p["id"])
                if not user:
                    logging.warning("XP not saved: no User row for player id %s", p["id"])
                    any_failure = True
                    continue

                is_winner = (p["teamId"] == winner)
                is_mvp = (p["id"] in (mvp_a_id, mvp_b_id))
                earned_xp = (180 if is_winner else 60) + (120 if is_mvp else 0)

                new_xp, new_level, new_xp_to_next = apply_xp(user.xp or 0, user.level or 1, earned_xp)
                user.xp = new_xp
                user.level = new_level
                user.xp_to_next = new_xp_to_next
                user.battles = (user.battles or 0) + 1
                if is_winner:
                    user.wins = (user.wins or 0) + 1
                if is_mvp:
                    user.mvps = (user.mvps or 0) + 1
                db.add(user)

                # Update in-memory player so the results broadcast has the new stats
                p["xp"] = new_xp
                p["level"] = new_level
                p["xpToNext"] = new_xp_to_next
                p["earnedXp"] = earned_xp  # lets client show "+180 XP" without re-fetching
            except Exception:
                logging.exception("Failed to apply XP for player %s in match %s", p.get("id"), room.match_id)
                any_failure = True

        try:
            await db.commit()
        except Exception:
            logging.exception("Failed to commit XP/match updates for match %s", room.match_id)
            any_failure = True

        if any_failure:
            logging.error("Match %s finished with one or more XP-save failures — see log above", room.match_id)

    await room.broadcast_all({
        "type": "results",
        "matchId": room.match_id,
        "winner": winner,
        "votes": {"A": votes_a, "B": votes_b},
        "mvp": {"A": mvp_a_id, "B": mvp_b_id},
        "recordings": room.state_snapshot(include_audio=True)["recordings"],
        "teams": room.get_teams(),
        # xpSaveError=True means at least one player's XP failed to write to DB.
        # The client should warn the user and skip the refreshProfile() call
        # (since the DB data would be stale anyway).
        "xpSaveError": any_failure if db else False,
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
            if room.status == "in_progress":
                await handle_disconnect_during_turn(room, user_id)

                # Check if this disconnect unblocks a pending loop vote, for either team
                for team_id in TEAM_IDS:
                    lv = room.loop_vote[team_id]
                    if not lv["resolved"] and lv["recorder_id"]:
                        current_turn = room.get_current_turn(team_id)
                        if current_turn and current_turn.get("userId") == lv["recorder_id"]:
                            if room.all_loop_votes_in(team_id):
                                lv["resolved"] = True
                                kept = room.tally_loop_vote(team_id)
                                await finish_loop_vote(room, team_id, kept=kept, recording=lv["pending_recording"] if kept else None)
            elif room.status == "voting":
                # Check if this disconnect unblocks the final end-of-game vote tally
                from app.database import AsyncSessionLocal
                async with AsyncSessionLocal() as db:
                    await check_and_finish_voting(room, db=db)


manager = ConnectionManager()
