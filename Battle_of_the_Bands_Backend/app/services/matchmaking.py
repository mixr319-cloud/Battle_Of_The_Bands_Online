"""
WebSocket-based matchmaking and real-time game state manager.

Flow:
  1. Player connects → sends { type: "join_queue", userId, teamSize, genre }
  2. Server waits until the room is full (all slots filled with real players)
  3. Server sends { type: "game_start", matchId, teams, ... } to everyone
  4. Both teams record SIMULTANEOUSLY — each team cycles through their own members
     independently. Team A's recorder and Team B's recorder are active at the same time.
  5. After recording, each recorder's teammates vote keep/drop for their team only.
  6. Each team advances to their next member after the vote resolves.
  7. Once ALL members of BOTH teams have recorded, game moves to voting.
  8. In voting, each player sends { type: "song_vote", ... } and { type: "mvp_vote", ... }
  9. Server tallies when all votes in, broadcasts results.

If a room is not full, players remain on the searching screen until enough
players have joined to fill every slot.
If a player disconnects mid-game their turn is auto-skipped.
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

# How long a player gets to reconnect (page refresh, brief wifi blip, phone
# locking) before the server treats their disconnect as "real" and starts
# acting on it — skipping their turn, excluding them from vote tallies, etc.
# Without this, a player who drops for even a second during their recording
# turn gets skipped immediately, even though the client-side heartbeat/
# reconnect logic would have brought them right back. The UI is told about
# the disconnect immediately either way (so teammates see a "reconnecting"
# indicator right away) — only the *consequential* actions are delayed.
#
# Set to a full minute on purpose: this is the window the rest of the room
# waits on a dropped player before the game moves on without them, so it
# needs to be generous enough to cover a real reconnect (app relaunch, wifi
# hiccup, switching networks) without making everyone else sit idle for
# much longer than that.
DISCONNECT_GRACE_SECS = 60

# Hard backstop for whoever currently holds the mic. DISCONNECT_GRACE_SECS
# above is what's *supposed* to notice a gone player and skip their turn —
# but it depends on the server actually seeing the disconnect (a clean close,
# ConnectionClosed, or the WS_IDLE_TIMEOUT_SECS silence check all firing
# correctly). This timer doesn't depend on any of that: it's armed the
# instant a turn starts and just asks "has TURN_TIMEOUT_SECS gone by with
# this exact turn still open, and is this player actually not connected
# right now?" If both are true, it skips them — same outcome as the
# disconnect path, just reached a different way. A player who's still
# connected and simply taking a while to record is never touched by this;
# it only ever acts on someone who's actually gone, so a turn can't sit open
# forever even if the primary detection path somehow misses them.
TURN_TIMEOUT_SECS = 60

# How long a finished ("done") room is kept in memory after the match ends,
# so a straggler who was mid-disconnect when results came in can still
# reconnect and be resent their results/recordings.
ROOM_DONE_RETENTION_SECS = 5 * 60

# How long a "waiting" (not-yet-full) room can sit with nobody connected to
# it before it's considered abandoned and evicted. Covers players who queue
# up and then close the tab entirely rather than refreshing.
WAITING_ROOM_ABANDON_SECS = 10 * 60

# How often the cleanup sweep runs.
ROOM_CLEANUP_INTERVAL_SECS = 60

# Max time to wait on a single ws.send_json() call. Without this, a "zombie"
# connection — network dropped without a clean close (very common on mobile/
# wifi) — can make send_json() hang indefinitely, since the OS won't report
# the socket as broken until TCP keepalive eventually times out (often
# minutes away). broadcast()/send_to() are awaited sequentially relative to
# the gameplay logic that follows them (e.g. finish_loop_vote sends
# loop_vote_result, THEN awaits advance_team_turn), so one stuck socket
# freezes turn progression for the entire team/room, not just the
# unresponsive player. A timeout here treats "still hasn't gone through
# after this long" the same as a hard failure: mark that connection dead and
# move on, instead of blocking everyone behind it.
SEND_TIMEOUT_SECS = 5


class TeamTurnState:
    """Tracks turn progress for a single team independently."""
    def __init__(self, team_id: str, player_ids: List[str]):
        self.team_id = team_id
        self.player_ids = player_ids
        self.turn_idx = 0           # which member is currently recording
        self.done = False           # all members have recorded

        # Loop vote state (reset each member's turn)
        self.loop_vote_recorder_id: Optional[str] = None
        self.loop_votes: Dict[str, str] = {}       # voter_id -> "keep"|"drop"
        self.loop_vote_expected: int = 0
        self.loop_vote_resolved: bool = False
        self.loop_vote_timer_task: Optional[asyncio.Task] = None
        self.pending_loop_recording: Optional[dict] = None

        # Hard backstop for the current recording turn — see TURN_TIMEOUT_SECS.
        # Armed whenever a player becomes "the one recording right now" and
        # cancelled the moment that stops being true for any reason (they
        # submit, they get skipped via the normal disconnect path, the team
        # finishes, etc.).
        self.turn_timer_task: Optional[asyncio.Task] = None

    @property
    def current_player_id(self) -> Optional[str]:
        if self.turn_idx < len(self.player_ids):
            return self.player_ids[self.turn_idx]
        return None

    def cancel_loop_vote_timer(self):
        if self.loop_vote_timer_task and not self.loop_vote_timer_task.done():
            self.loop_vote_timer_task.cancel()
        self.loop_vote_timer_task = None

    def cancel_turn_timer(self):
        if self.turn_timer_task and not self.turn_timer_task.done():
            self.turn_timer_task.cancel()
        self.turn_timer_task = None

    def reset_loop_vote(self, recorder_id: str, all_team_players: List[dict]):
        self.cancel_loop_vote_timer()
        self.loop_vote_recorder_id = recorder_id
        self.loop_votes = {}
        self.loop_vote_resolved = False
        self.pending_loop_recording = None
        teammates = [p for p in all_team_players if p["id"] != recorder_id]
        self.loop_vote_expected = len(teammates)

    def tally_loop_vote(self, disconnected: set) -> bool:
        connected_voters = [
            pid for pid in self.player_ids
            if pid != self.loop_vote_recorder_id and pid not in disconnected
        ]
        if not connected_voters or self.loop_vote_expected == 0:
            return True
        keep_count = sum(1 for v in self.loop_votes.values() if v == "keep")
        drop_count = sum(1 for v in self.loop_votes.values() if v == "drop")
        return keep_count >= drop_count

    def all_loop_votes_in(self, disconnected: set) -> bool:
        connected_voters = [
            pid for pid in self.player_ids
            if pid != self.loop_vote_recorder_id and pid not in disconnected
        ]
        return len(self.loop_votes) >= len(connected_voters)


class MatchRoom:
    def __init__(self, match_id: str, team_size: int, genre: str):
        self.match_id = match_id
        self.team_size = team_size
        self.genre = genre
        self.status = "waiting"   # waiting | in_progress | voting | done
        self.battle_key = random.choice(MUSICAL_KEYS)
        self.bpm = 90
        self.connections: Dict[str, WebSocket] = {}   # user_id -> websocket
        self.players: List[dict] = []
        self.recordings: List[dict] = []
        self.disconnected: set = set()

        # user_ids who explicitly left this room (e.g. clicked "Play Again"
        # on the results screen). Distinct from `disconnected`, which means
        # "their socket dropped but they probably want back in" — `left`
        # means "they're done here, on purpose." Without this, a player who
        # finished a match and moved on stays on the roster and in
        # `connections` forever (or until the 5-minute GC sweep for "done"
        # rooms), so the room keeps treating them as a live member: the
        # reconnect-scan on their next page refresh yanks them straight back
        # into the dead match instead of letting them search fresh, and they
        # keep receiving broadcasts (e.g. a former teammate's reconnect)
        # meant for people still actually in that match.
        self.left: set = set()

        # user_id -> asyncio.Task counting down DISCONNECT_GRACE_SECS before
        # the disconnect is treated as "real" (turn-skip, vote exclusion).
        # Cancelled on reconnect.
        self.pending_disconnect_tasks: Dict[str, asyncio.Task] = {}

        # Wall-clock (loop.time()) bookkeeping used by the background room
        # cleanup sweep — see room_cleanup_loop(). Not used for any gameplay
        # logic, purely memory hygiene.
        self.finished_at: Optional[float] = None
        self.empty_since: Optional[float] = None

        # Parallel team state — initialized in build_team_turns()
        self.team_turns: Dict[str, TeamTurnState] = {}  # "A" -> TeamTurnState, "B" -> TeamTurnState

        # In-memory audio store
        self.audio_store: Dict[str, str] = {}

        # End-of-game vote state
        self.song_votes: List[dict] = []
        self.mvp_votes: List[dict] = []
        self.end_votes_expected: int = 0
        self.end_vote_timer_task: Optional[asyncio.Task] = None
        # Wall-clock time (loop.time()) when status first became "voting".
        # Used to give reconnecting players an accurate remaining-time figure
        # instead of always resetting their countdown to the full duration —
        # otherwise a player who reconnects late sees a fresh 30s timer right
        # before the server's own end-of-voting safety timeout (which started
        # counting down from the original moment voting began) cuts the round
        # off out from under them.
        self.voting_started_at: Optional[float] = None

        # Cached final outcome, populated by handle_vote_complete, so a
        # player who reconnects after the match is already "done" can be
        # resent their results instead of hanging forever.
        self.last_result_winner: Optional[str] = None
        self.last_result_votes: Dict[str, int] = {"A": 0, "B": 0}
        self.last_result_mvp: Dict[str, str] = {"A": "", "B": ""}

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

    def is_active_member(self, user_id: str) -> bool:
        """True if this user is on the roster AND hasn't explicitly left.

        Used by the reconnect-scans (a new websocket connecting, or a
        join_queue arriving) to decide whether to pull someone back into
        an old room. `already_has_player` alone isn't enough — it stays
        true forever once a player joins, even after they've finished the
        match and moved on via "Play Again", which is what previously let
        a finished room keep claiming a player who had no intention of
        returning to it.
        """
        return self.already_has_player(user_id) and user_id not in self.left

    def add_player(self, user_id: str, display_name: str, color: str, level: int, xp: int, xp_to_next: int, is_premium: bool = False, avatar_url: str = None):
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
            "isPremium": is_premium,
            "avatarUrl": avatar_url if is_premium else None,
            "teamId": team_id,
            "playerIdx": team_idx,
        }
        self.players.append(player)
        return player

    def build_team_turns(self):
        """Initialize parallel TeamTurnState for each team."""
        team_a = [p for p in self.players if p["teamId"] == "A"]
        team_b = [p for p in self.players if p["teamId"] == "B"]
        self.team_turns["A"] = TeamTurnState("A", [p["id"] for p in team_a])
        self.team_turns["B"] = TeamTurnState("B", [p["id"] for p in team_b])
        self.end_votes_expected = len(self.players)

    def get_teams(self):
        team_a = [p for p in self.players if p["teamId"] == "A"]
        team_b = [p for p in self.players if p["teamId"] == "B"]
        return {
            "A": {"id": "A", "name": "Team A", "players": team_a},
            "B": {"id": "B", "name": "Team B", "players": team_b},
        }

    def get_team_members(self, team_id: str) -> List[dict]:
        return [p for p in self.players if p["teamId"] == team_id]

    def get_player(self, user_id: str) -> Optional[dict]:
        return next((p for p in self.players if p["id"] == user_id), None)

    def get_current_recorder(self, team_id: str) -> Optional[dict]:
        ts = self.team_turns.get(team_id)
        if not ts or ts.done:
            return None
        pid = ts.current_player_id
        return self.get_player(pid) if pid else None

    def both_teams_done(self) -> bool:
        return all(ts.done for ts in self.team_turns.values())

    def store_audio(self, recording_id: str, audio_b64: str):
        self.audio_store[recording_id] = audio_b64

    def get_audio(self, recording_id: str) -> Optional[str]:
        return self.audio_store.get(recording_id)

    def cancel_end_vote_timer(self):
        if self.end_vote_timer_task and not self.end_vote_timer_task.done():
            self.end_vote_timer_task.cancel()
        self.end_vote_timer_task = None

    def cancel_pending_disconnect(self, user_id: str) -> bool:
        """Cancel a not-yet-fired grace-period timer for this user, if any.

        Returns True if a pending (not-yet-expired) disconnect was
        cancelled — i.e. the player came back before the grace window ran
        out, so nothing was ever actually skipped/excluded and the caller
        doesn't need to broadcast a "player_reconnected" correction.
        Returns False if there was no pending task (either they never
        disconnected, or the grace period already expired and the normal
        late-reconnect path — discarding from room.disconnected — applies).
        """
        task = self.pending_disconnect_tasks.pop(user_id, None)
        if task and not task.done():
            task.cancel()
            return True
        return False

    def remaining_vote_secs(self, phase_budget: int) -> int:
        """How long a (re)connecting voter should be told they have left.

        Capped by both the per-phase budget (song or mvp) and by how much
        time is actually left before the server's hard end-of-voting
        timeout fires, whichever is smaller. Without this, a player who
        (re)connects partway through voting would always be told they have
        the full phase_budget seconds, even if the server is about to force
        -finish the round in just a few seconds.
        """
        if self.voting_started_at is None:
            return phase_budget
        elapsed = asyncio.get_event_loop().time() - self.voting_started_at
        remaining_total = max(0, END_VOTE_TIMEOUT_SECS - elapsed)
        return max(1, min(phase_budget, int(remaining_total)))

    def state_snapshot(self, include_audio: bool = False):
        recordings = self.recordings
        if include_audio:
            enriched = []
            for rec in recordings:
                rec_copy = dict(rec)
                cached = self.get_audio(rec.get("id", ""))
                if cached:
                    rec_copy["audiob64"] = cached
                enriched.append(rec_copy)
            recordings = enriched

        # Build current turns per team for the frontend
        current_turns = {}
        for tid, ts in self.team_turns.items():
            current_turns[tid] = {
                "teamId": tid,
                "playerIdx": ts.turn_idx,
                "userId": ts.current_player_id,
                "done": ts.done,
            }

        return {
            "matchId": self.match_id,
            "status": self.status,
            "teams": self.get_teams(),
            "battleKey": self.battle_key,
            "bpm": self.bpm,
            # Keep legacy currentTurn as whichever team is furthest along (for compat)
            "currentTurn": next(
                ({"teamId": tid, "playerIdx": ts.turn_idx, "userId": ts.current_player_id}
                 for tid, ts in self.team_turns.items() if not ts.done),
                None
            ),
            "currentTurns": current_turns,  # NEW: per-team turn info
            "turnIdx": sum(ts.turn_idx for ts in self.team_turns.values()),
            "totalTurns": self.team_size * 2,
            "recordings": recordings,
        }

    def pending_loop_vote_for(self, user_id: str) -> Optional[dict]:
        """
        If this player's team currently has an unresolved loop vote in
        flight, describe it from their point of view. Used to correctly
        resync a reconnecting player instead of letting them fall through
        to a plain game_start snapshot — which still shows it as the
        recorder's turn (turn_idx doesn't advance until the vote resolves)
        and would pop the recording UI again for someone who already
        submitted a loop and is just waiting on their teammates, or leave
        a teammate who's supposed to be voting with nothing on screen.
        """
        player = self.get_player(user_id)
        if not player:
            return None
        team_id = player.get("teamId")
        ts = self.team_turns.get(team_id) if team_id else None
        if not ts or ts.loop_vote_recorder_id is None or ts.loop_vote_resolved:
            return None

        recorder_name = next(
            (p["name"] for p in self.players if p["id"] == ts.loop_vote_recorder_id), "?"
        )

        recording = dict(ts.pending_loop_recording) if ts.pending_loop_recording else None
        if recording:
            cached = self.get_audio(recording.get("id", ""))
            if cached:
                recording["audiob64"] = cached

        team_stack_with_audio = []
        for rec in self.recordings:
            if rec.get("teamId") == team_id:
                rec_copy = dict(rec)
                cached = self.get_audio(rec.get("id", ""))
                if cached:
                    rec_copy["audiob64"] = cached
                team_stack_with_audio.append(rec_copy)

        return {
            "role": "recorder" if user_id == ts.loop_vote_recorder_id else "voter",
            "teamId": team_id,
            "recorderId": ts.loop_vote_recorder_id,
            "recorderName": recorder_name,
            "recording": recording,
            "teamStack": team_stack_with_audio,
            "timeoutSecs": LOOP_VOTE_TIMEOUT_SECS,
            "alreadyVoted": user_id in ts.loop_votes,
        }

    async def broadcast(self, msg: dict, exclude: Optional[str] = None):
        # Send to every connection concurrently rather than one at a time.
        # A sequential loop here meant a single slow/stuck socket (weak
        # wifi, a backgrounded mobile tab, a big base64 audio payload still
        # being flushed) would delay delivery to every player who came
        # after it in iteration order — which is what made it look like
        # some players "jumped ahead" to the voting screen or got their
        # turn-advance late: they weren't actually ahead, a teammate's send
        # was just still stuck in the queue in front of them.
        targets = [(uid, ws) for uid, ws in self.connections.items() if uid != exclude]
        if not targets:
            return

        async def _send(uid: str, ws: WebSocket) -> Optional[str]:
            try:
                await asyncio.wait_for(ws.send_json(msg), timeout=SEND_TIMEOUT_SECS)
                return None
            except Exception:
                return uid

        results = await asyncio.gather(*[_send(uid, ws) for uid, ws in targets])
        dead = [uid for uid in results if uid]
        for uid in dead:
            self.connections.pop(uid, None)
        if dead:
            await self._mark_dead(dead)

    async def broadcast_all(self, msg: dict):
        await self.broadcast(msg)

    async def send_to(self, user_id: str, msg: dict):
        ws = self.connections.get(user_id)
        if ws:
            try:
                await asyncio.wait_for(ws.send_json(msg), timeout=SEND_TIMEOUT_SECS)
            except Exception:
                self.connections.pop(user_id, None)
                await self._mark_dead([user_id])

    async def _mark_dead(self, user_ids: List[str]):
        """A send to these users failed, so their socket is unusable even
        though no clean WebSocketDisconnect was ever raised for them (common
        with network drops / phones locking instead of a clean tab close).
        Without this, they'd stay counted as "still connected, still expected
        to vote" forever, and the end-of-round vote would only ever finish
        via the 30s hard timeout instead of as soon as everyone real votes.
        """
        newly_dead = [uid for uid in user_ids if uid not in self.disconnected]
        if not newly_dead:
            return
        self.disconnected.update(newly_dead)
        if self.status == "voting":
            from app.database import AsyncSessionLocal
            async with AsyncSessionLocal() as db:
                await check_and_finish_voting(self, db=db)

    async def send_to_team(self, team_id: str, msg: dict, exclude: Optional[str] = None):
        """Send a message to all connected members of a team, concurrently
        (see broadcast() for why sequential sends are a problem here too)."""
        targets = [p["id"] for p in self.players if p["teamId"] == team_id and p["id"] != exclude]
        if not targets:
            return
        await asyncio.gather(*[self.send_to(uid, msg) for uid in targets])


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

    room.build_team_turns()
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

    # Mark both first recorders as recording
    for team_id, ts in room.team_turns.items():
        first = room.get_current_recorder(team_id)
        if first:
            first["isRecording"] = True
            _arm_turn_timer(room, team_id)

    await room.broadcast_all({
        "type": "game_start",
        **room.state_snapshot(),
    })


LOOP_VOTE_TIMEOUT_SECS = 30

# The client gives each voting sub-phase (song rating, then MVP pick) its own
# `END_VOTE_PHASE_TIMEOUT_SECS`-second window, run sequentially — so a player
# can legitimately take up to ~2x this value to finish voting. The server's
# hard safety timeout must cover the *whole* sequence, not just one phase, or
# it fires while honest players are still mid-vote and force-finishes the
# match out from under them (symptom: a late song_vote_ack arrives after the
# match is already "done", desyncing the client into a phase that no longer
# matters and leaving it stuck).
END_VOTE_PHASE_TIMEOUT_SECS = 30
END_VOTE_TIMEOUT_SECS = (END_VOTE_PHASE_TIMEOUT_SECS * 2) + 10


async def _loop_vote_timeout(room: MatchRoom, team_id: str):
    """Auto-keep the loop after timeout if not all votes are in for a team."""
    await asyncio.sleep(LOOP_VOTE_TIMEOUT_SECS)
    ts = room.team_turns.get(team_id)
    if ts and not ts.loop_vote_resolved:
        ts.loop_vote_resolved = True
        await room.broadcast_all({
            "type": "loop_vote_timeout",
            "matchId": room.match_id,
            "teamId": team_id,
        })
        kept = ts.tally_loop_vote(room.disconnected)
        await finish_loop_vote(room, team_id, kept=kept,
                               recording=ts.pending_loop_recording if kept else None)


async def _end_vote_timeout(room: MatchRoom):
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
            await _force_finish_voting(room, db=None)


async def _force_finish_voting(room: MatchRoom, db=None):
    if room.status == "done":
        return
    room.cancel_end_vote_timer()

    # Anyone still connected who never submitted a song vote (AFK, distracted,
    # or just too slow before the timer ran out) gets a default 2-star vote for
    # BOTH teams. This keeps the tally fair — a team isn't penalized just
    # because one of its voters didn't get their vote in — and guarantees the
    # match always finishes instead of waiting forever on a straggler.
    # MVP intentionally gets no such default: a missed MVP vote simply doesn't
    # count, so players picked by others still have a fair shot at winning it.
    connected_players = [p for p in room.players if p["id"] not in room.disconnected and not p.get("isNpc")]
    already_song_voted = {v.get("voter_id") for v in room.song_votes}
    for p in connected_players:
        if p["id"] not in already_song_voted:
            room.song_votes.append({"voter_id": p["id"], "ratingA": 2, "ratingB": 2})

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


async def start_loop_vote(room: MatchRoom, team_id: str, recorder_id: str,
                          recording: Optional[dict], audio_b64: Optional[str] = None):
    """
    Broadcast a loop_vote_request to the recorder's teammates (same team only).
    Both teams can have simultaneous active loop votes.
    """
    ts = room.team_turns.get(team_id)
    if not ts:
        return

    # Guard against stale/duplicate submissions. A recorder who reloads the
    # page while their teammates are still voting on a recording they
    # already submitted gets resynced with a snapshot that (correctly)
    # still shows it as their turn — turn_idx doesn't advance until the
    # vote resolves — so without this check their client could pop the
    # recording UI again and let them submit a second loop. That second
    # request would silently wipe out any votes already cast on the first
    # one (reset_loop_vote below clears loop_votes) and, if the turn has
    # since moved on (e.g. the first vote already resolved via timeout
    # while the page was reloading), get processed for a turn that no
    # longer exists — which is how a "second" loop could disappear without
    # ever making it into the game.
    if ts.done or recorder_id != ts.current_player_id:
        return

    # If a vote is already underway for this exact recorder/turn and at
    # least one teammate has already cast a vote, don't let a duplicate or
    # late-arriving request reset it out from under them. A genuine retry
    # before anyone has voted yet is still allowed through (harmless — it
    # just restarts the same vote).
    if (ts.loop_vote_recorder_id == recorder_id
            and not ts.loop_vote_resolved
            and ts.loop_votes):
        return

    team_players = room.get_team_members(team_id)
    ts.reset_loop_vote(recorder_id, team_players)
    # The recorder has engaged with their turn (submitted or explicitly
    # skipped) — whatever happens next is gated by the loop vote's own
    # timeout, not by how long this turn has been open, so the backstop no
    # longer applies.
    ts.cancel_turn_timer()

    if audio_b64 and recording and recording.get("id"):
        room.store_audio(recording["id"], audio_b64)

    if recording:
        ts.pending_loop_recording = recording

    # Recorder skipped
    if recording is None:
        await finish_loop_vote(room, team_id, kept=False, recording=None)
        return

    teammates = [
        p for p in team_players
        if p["id"] != recorder_id and p["id"] not in room.disconnected
    ]

    if not teammates:
        await finish_loop_vote(room, team_id, kept=True, recording=recording)
        return

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

    # Attach team stack with cached audio
    team_stack_with_audio = []
    for rec in room.recordings:
        if rec.get("teamId") == team_id:
            rec_copy = dict(rec)
            cached = room.get_audio(rec.get("id", ""))
            if cached:
                rec_copy["audiob64"] = cached
            team_stack_with_audio.append(rec_copy)
    vote_payload["teamStack"] = team_stack_with_audio

    for p in teammates:
        await room.send_to(p["id"], vote_payload)

    ts.loop_vote_timer_task = asyncio.create_task(_loop_vote_timeout(room, team_id))


async def receive_loop_vote(room: MatchRoom, voter_id: str, vote: str, team_id: str):
    """Record a teammate's keep/drop vote for their team's current loop."""
    ts = room.team_turns.get(team_id)
    if not ts:
        return

    voter = room.get_player(voter_id)
    if not voter or voter["teamId"] != team_id or voter_id == ts.loop_vote_recorder_id:
        return

    ts.loop_votes[voter_id] = vote

    if not ts.loop_vote_resolved and ts.all_loop_votes_in(room.disconnected):
        ts.loop_vote_resolved = True
        ts.cancel_loop_vote_timer()
        kept = ts.tally_loop_vote(room.disconnected)
        recording = ts.pending_loop_recording
        await finish_loop_vote(room, team_id, kept=kept, recording=recording if kept else None)


async def finish_loop_vote(room: MatchRoom, team_id: str, kept: bool, recording: Optional[dict]):
    """Broadcast the loop vote result to the team and advance that team's turn."""
    ts = room.team_turns.get(team_id)
    if not ts:
        return
    ts.cancel_loop_vote_timer()

    keep_count = sum(1 for v in ts.loop_votes.values() if v == "keep")
    drop_count = sum(1 for v in ts.loop_votes.values() if v == "drop")

    if kept and recording:
        room.recordings.append(recording)

    # Broadcast vote result to just this team
    await room.send_to_team(team_id, {
        "type": "loop_vote_result",
        "matchId": room.match_id,
        "teamId": team_id,
        "kept": kept,
        "keepCount": keep_count,
        "dropCount": drop_count,
        "recorderName": next(
            (p["name"] for p in room.players if p["id"] == ts.loop_vote_recorder_id), "?"
        ),
        "recording": recording if kept else None,
    })

    # Advance this team's turn
    await advance_team_turn(room, team_id)


def _arm_turn_timer(room: MatchRoom, team_id: str):
    """(Re)start the TURN_TIMEOUT_SECS backstop for whichever player is now
    the current recorder for this team. Always cancels any timer already
    running for this team first, so there's never more than one in flight.
    No-op if the team has no current player (nothing to time)."""
    ts = room.team_turns.get(team_id)
    if not ts:
        return
    ts.cancel_turn_timer()
    user_id = ts.current_player_id
    if not user_id:
        return
    ts.turn_timer_task = asyncio.create_task(_turn_timeout(room, team_id, user_id, ts.turn_idx))


async def _turn_timeout(room: MatchRoom, team_id: str, user_id: str, turn_idx: int):
    """Fires TURN_TIMEOUT_SECS after a turn starts. This is a pure backstop —
    see the comment on TURN_TIMEOUT_SECS for why it exists alongside the
    disconnect-grace pipeline instead of replacing it. Two checks have to
    both still be true when this wakes up, or it does nothing:
      1. it's still the *same* turn (turn_idx hasn't moved, current
         recorder hasn't changed) — otherwise this fired for a turn that's
         already over and was simply never cancelled in time.
      2. the player is *not* currently connected — a connected player who's
         just taking a while to record is never skipped by this.
    """
    try:
        await asyncio.sleep(TURN_TIMEOUT_SECS)
    except asyncio.CancelledError:
        return

    ts = room.team_turns.get(team_id)
    if not ts or ts.turn_idx != turn_idx or ts.current_player_id != user_id:
        return

    if user_id in room.connections:
        return

    if user_id not in room.disconnected:
        room.disconnected.add(user_id)
        await room.broadcast_all({"type": "player_disconnected", "userId": user_id})

    await handle_disconnect_during_turn(room, user_id)


async def advance_team_turn(room: MatchRoom, team_id: str):
    """Advance a single team's turn index. If both done, move to voting."""
    ts = room.team_turns.get(team_id)
    if not ts:
        return

    # Whatever turn was open is no longer open — its backstop timer (if any)
    # is stale the moment we get here, regardless of which path called us.
    ts.cancel_turn_timer()

    # Clear isRecording for current recorder
    current_recorder = room.get_current_recorder(team_id)
    if current_recorder:
        current_recorder["isRecording"] = False
        current_recorder["hasRecorded"] = True

    ts.turn_idx += 1

    # Skip disconnected players
    while ts.current_player_id and ts.current_player_id in room.disconnected:
        skipped_id = ts.current_player_id
        await room.broadcast_all({
            "type": "team_turn_advance",
            "teamId": team_id,
            "skippedUserId": skipped_id,
            "reason": "disconnected",
            **room.state_snapshot(include_audio=True),
        })
        ts.turn_idx += 1

    if ts.current_player_id is None:
        # This team is done
        ts.done = True

        await room.broadcast_all({
            "type": "team_recording_done",
            "teamId": team_id,
            "matchId": room.match_id,
        })

        # Check if both teams are done
        if room.both_teams_done():
            room.status = "voting"
            room.voting_started_at = asyncio.get_event_loop().time()
            await room.broadcast_all({
                "type": "voting_start",
                **room.state_snapshot(include_audio=True),
                "timeoutSecs": END_VOTE_PHASE_TIMEOUT_SECS,
            })
            room.end_vote_timer_task = asyncio.create_task(_end_vote_timeout(room))
        return

    # Mark next recorder
    next_player = room.get_current_recorder(team_id)
    if next_player:
        next_player["isRecording"] = True
    _arm_turn_timer(room, team_id)

    await room.broadcast_all({
        "type": "team_turn_advance",
        "teamId": team_id,
        **room.state_snapshot(include_audio=True),
    })


async def handle_disconnect_during_turn(room: MatchRoom, user_id: str):
    player = room.get_player(user_id)
    if not player:
        return
    team_id = player.get("teamId")
    if not team_id:
        return
    ts = room.team_turns.get(team_id)
    if ts and not ts.done and ts.current_player_id == user_id:
        await advance_team_turn(room, team_id)


async def receive_song_vote(room: MatchRoom, voter_id: str, rating_a: int, rating_b: int):
    if any(v.get("voter_id") == voter_id for v in room.song_votes):
        return
    room.song_votes.append({"voter_id": voter_id, "ratingA": rating_a, "ratingB": rating_b})


async def check_and_finish_voting(room: MatchRoom, db=None):
    connected_players = [p for p in room.players if p["id"] not in room.disconnected and not p.get("isNpc")]
    if len(room.mvp_votes) < len(connected_players) or len(connected_players) == 0:
        return
    room.cancel_end_vote_timer()
    await _force_finish_voting(room, db=db)


async def receive_mvp_vote(room: MatchRoom, voter_id: str, pick_a: str, pick_b: str, db=None):
    if any(v["voter_id"] == voter_id for v in room.mvp_votes):
        return
    room.mvp_votes.append({"voter_id": voter_id, "pickA": pick_a, "pickB": pick_b})
    await check_and_finish_voting(room, db=db)


async def handle_vote_complete(room: MatchRoom, winner: str, votes_a: int, votes_b: int,
                                mvp_a_id: str, mvp_b_id: str, db=None):
    if room.status == "done":
        return
    room.status = "done"
    room.finished_at = asyncio.get_event_loop().time()
    room.last_result_winner = winner
    room.last_result_votes = {"A": votes_a, "B": votes_b}
    room.last_result_mvp = {"A": mvp_a_id, "B": mvp_b_id}

    any_failure = False
    if db:
        from app.models import Match, User
        from app.services.xp_system import apply_xp

        try:
            db_match = await db.get(Match, room.match_id)
            if db_match:
                db_match.status = "done"
                db_match.winner_team = winner
        except Exception:
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

                p["xp"] = new_xp
                p["level"] = new_level
                p["xpToNext"] = new_xp_to_next
                p["earnedXp"] = earned_xp
            except Exception:
                logging.exception("Failed to apply XP for player %s in match %s", p.get("id"), room.match_id)
                any_failure = True

        try:
            await db.commit()
        except Exception:
            logging.exception("Failed to commit XP/match updates for match %s", room.match_id)
            any_failure = True

    await room.broadcast_all({
        "type": "results",
        "matchId": room.match_id,
        "winner": winner,
        "votes": {"A": votes_a, "B": votes_b},
        "mvp": {"A": mvp_a_id, "B": mvp_b_id},
        "recordings": room.state_snapshot(include_audio=True)["recordings"],
        "teams": room.get_teams(),
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
            room.cancel_pending_disconnect(user_id)

    async def disconnect(self, match_id: str, user_id: str, websocket: WebSocket):
        room = get_room(match_id)
        if room:
            # A user can have a NEWER socket already registered by the time
            # an OLDER socket's WebSocketDisconnect finally arrives — the
            # client force-reconnects on heartbeat timeout and on every page
            # refresh, opening a new connection before the server has
            # noticed the old one is dead. If we blindly pop here, a late
            # disconnect from that stale old socket clobbers the live new
            # one: room.connections[user_id] gets removed, the user gets
            # marked disconnected even though they're actively connected,
            # and every subsequent server -> client message (loop vote
            # requests/results, turn updates) silently fails to deliver.
            # That's what makes the vote-loop screen "hang" and makes a
            # refresh look like it signed the player out instead of
            # reconnecting them. Only tear down if this is still the socket
            # currently on file for this user.
            if room.connections.get(user_id) is not websocket:
                return
            room.connections.pop(user_id, None)

            # Tell everyone right away so the UI can show a "reconnecting"
            # indicator — but don't yet treat this as a real disconnect for
            # gameplay purposes (turn-skip, vote exclusion). Most
            # disconnects are a page refresh or a few seconds of dead wifi
            # that the client's own reconnect logic recovers from on its
            # own; reacting instantly to every one of those is what made a
            # brief blip look and feel like getting kicked out of the game.
            await room.broadcast_all({
                "type": "player_disconnected",
                "userId": user_id,
            })

            # Cancel any stale grace timer from a previous disconnect that
            # never got cleaned up, then start a fresh one.
            room.cancel_pending_disconnect(user_id)
            task = asyncio.create_task(self._grace_period_then_finalize(room, user_id))
            room.pending_disconnect_tasks[user_id] = task

    async def _grace_period_then_finalize(self, room: "MatchRoom", user_id: str):
        """Waits out DISCONNECT_GRACE_SECS, then — only if the player still
        hasn't reconnected — applies the actual consequences of being gone
        (turn-skip, vote-tally exclusion). If they reconnect in the
        meantime, connect()/the reconnect paths in matches.py cancel this
        task and it never reaches the code below.
        """
        try:
            await asyncio.sleep(DISCONNECT_GRACE_SECS)
        except asyncio.CancelledError:
            return

        room.pending_disconnect_tasks.pop(user_id, None)

        # They may have reconnected via a path that didn't go through
        # cancel_pending_disconnect (defensive double-check).
        if user_id in room.connections:
            return

        room.disconnected.add(user_id)

        if room.status == "in_progress":
            player = room.get_player(user_id)
            team_id = player.get("teamId") if player else None
            ts = room.team_turns.get(team_id) if team_id else None

            # If this player's team has an unresolved loop vote in flight,
            # that vote — not the generic "skip the current recorder's
            # turn" path — is the only thing allowed to advance the turn.
            # Both branches call advance_team_turn() at the end, so running
            # both for the same disconnect double-advances: turn_idx moves
            # twice off of one event, which skips a player who should still
            # get their turn and leaves a stale vote/result screen on
            # whichever client was still rendering the first advance.
            # This matters most when the disconnecting player IS the
            # recorder of the pending vote: turn_idx hasn't moved yet (it
            # only advances once the vote resolves), so
            # handle_disconnect_during_turn's "is this the current
            # recorder" check still matches them, even though the correct
            # handling for "recorder of an in-flight vote went away" is to
            # resolve that vote, not to separately skip their turn too.
            if ts and not ts.loop_vote_resolved and ts.loop_vote_recorder_id:
                if ts.all_loop_votes_in(room.disconnected):
                    ts.loop_vote_resolved = True
                    kept = ts.tally_loop_vote(room.disconnected)
                    await finish_loop_vote(room, team_id, kept=kept,
                                           recording=ts.pending_loop_recording if kept else None)
                # else: still waiting on other connected voters — the vote's
                # own timeout/remaining-voter path will resolve it; don't
                # also force-advance the turn out from under it.
            else:
                await handle_disconnect_during_turn(room, user_id)
        elif room.status == "voting":
            from app.database import AsyncSessionLocal
            async with AsyncSessionLocal() as db:
                await check_and_finish_voting(room, db=db)

    async def notify_reconnected(self, room: "MatchRoom", user_id: str, was_pending: bool):
        """Tell the room a player is back. `was_pending` (from
        cancel_pending_disconnect) distinguishes "came back within the
        grace window, nothing ever actually changed" from "came back after
        being fully marked disconnected" — both are worth telling
        teammates about so a connection-status indicator can clear.
        """
        await room.broadcast_all({
            "type": "player_reconnected",
            "userId": user_id,
        })


manager = ConnectionManager()


async def room_cleanup_loop():
    """Runs for the lifetime of the server, freeing memory held by rooms
    that are no longer useful: matches that finished long enough ago that
    no reconnecting straggler still needs their cached results/audio, and
    queue rooms that everyone has walked away from entirely (closed the
    tab rather than refreshing). Without this, _active_rooms / the waiting
    -room lists only ever grow for as long as the process runs — on a
    long-lived deployment that eventually exhausts memory and forces a
    crash or restart, which shows up to players as random, unexplained
    disconnects with no obvious trigger on their end.
    """
    while True:
        await asyncio.sleep(ROOM_CLEANUP_INTERVAL_SECS)
        try:
            now = asyncio.get_event_loop().time()
            to_remove = []
            for match_id, room in list(_active_rooms.items()):
                if room.status == "done":
                    if room.finished_at is not None and (now - room.finished_at) > ROOM_DONE_RETENTION_SECS:
                        to_remove.append(match_id)
                elif room.status == "waiting":
                    if not room.connections:
                        if room.empty_since is None:
                            room.empty_since = now
                        elif (now - room.empty_since) > WAITING_ROOM_ABANDON_SECS:
                            to_remove.append(match_id)
                    else:
                        room.empty_since = None
                # "in_progress" / "voting" rooms are never swept here even if
                # everyone's temporarily disconnected — the grace-period /
                # reconnect machinery owns that lifecycle, not the GC sweep.

            for match_id in to_remove:
                room = _active_rooms.pop(match_id, None)
                if not room:
                    continue
                for task in room.pending_disconnect_tasks.values():
                    if not task.done():
                        task.cancel()
                if room.end_vote_timer_task and not room.end_vote_timer_task.done():
                    room.end_vote_timer_task.cancel()
                for ts in room.team_turns.values():
                    ts.cancel_loop_vote_timer()
                    ts.cancel_turn_timer()
                for rooms in _waiting_rooms.values():
                    if room in rooms:
                        rooms.remove(room)
        except Exception:
            logging.exception("room_cleanup_loop sweep failed")

