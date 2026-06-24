import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from websockets.exceptions import ConnectionClosed
from app.database import AsyncSessionLocal
from app.services.matchmaking import (
    get_or_create_room, get_room, manager,
    start_match, handle_vote_complete,
    start_loop_vote, receive_loop_vote,
    receive_song_vote, receive_mvp_vote,
    get_queue_counts, _active_rooms,
    END_VOTE_PHASE_TIMEOUT_SECS,
)

router = APIRouter(prefix="/matches", tags=["matches"])

# The client pings every 8s and force-reconnects itself if no pong arrives
# within 20s (see useGameSocket.ts) — but that's purely client-side: it only
# protects a client whose own JS event loop is still running. If the
# underlying machine sleeps, loses network without a clean TCP close, or
# sits behind a NAT/proxy that silently drops an idle connection, the
# SERVER's `websocket.iter_json()` await just hangs forever waiting for a
# frame that's never coming — there's no WebSocketDisconnect to catch, so
# manager.disconnect() (and therefore the whole grace-period / turn-skip /
# vote-finish / room-cleanup pipeline) never runs. The room sits in
# `_active_rooms` as "in_progress"/"voting" indefinitely (the GC sweep
# intentionally never touches those statuses — see room_cleanup_loop), so
# reopening the app hours or days later just reconnects into the same dead
# match. Bounding the server's own wait with WS_IDLE_TIMEOUT_SECS (comfortably
# longer than the client's ping cadence, so a couple of missed/delayed pings
# don't false-positive) turns that silent, unbounded hang into a normal,
# timely disconnect.
WS_IDLE_TIMEOUT_SECS = 45


@router.websocket("/ws/{user_id}")
async def matchmaking_ws(websocket: WebSocket, user_id: str):
    """
    Single WebSocket endpoint for the entire game lifecycle.

    Messages the CLIENT sends:
      { type: "join_queue", teamSize, genre, displayName, color, level, xp, xpToNext }
      { type: "ping" }
          — heartbeat; server replies with { type: "pong" }
      { type: "loop_vote_request", matchId, recording, teamId }
          — sent by the recorder after uploading; server fans out to their teammates only
      { type: "loop_vote_cast", matchId, vote: "keep"|"drop", teamId }
          — sent by each teammate in response to loop_vote_request
      { type: "leave_match", matchId }
          — sent when the client is done with a finished match (e.g. "Play
            Again") so the room stops treating it as a member
      { type: "song_vote", matchId, ratingA, ratingB }
      { type: "mvp_vote", matchId, pickA, pickB }
      { type: "bpm_change", matchId, bpm }
      { type: "get_queue_counts" }

    Messages the SERVER sends:
      { type: "queued", matchId, playersJoined, playersNeeded }
      { type: "player_joined", playersJoined, playersNeeded, displayName }
      { type: "game_start", matchId, teams, battleKey, bpm, currentTurns, ... }
      { type: "team_turn_advance", teamId, matchId, currentTurns, teams, recordings, ... }
          — sent to one team only when their turn advances
      { type: "team_recording_done", teamId, matchId }
          — sent to one team when all their members have recorded
      { type: "loop_vote_request", matchId, teamId, recording, recorderName }
          — server → teammates only (same team as recorder)
      { type: "loop_vote_result", matchId, teamId, kept, keepCount, dropCount, recorderName }
          — server → that team only
      { type: "voting_start", ... }
          — broadcast to all when BOTH teams finish recording
      { type: "results", winner, votes, mvp, recordings }
      { type: "player_disconnected", userId }
      { type: "player_reconnected", userId }
      { type: "removed_from_match", matchId, reason }
          — sent instead of a normal reconnect when this player's
            DISCONNECT_GRACE_SECS window already expired before they came
            back — their turn/votes were already finalized without them, so
            they're cut loose from the room rather than dropped back into a
            match they're no longer part of. Client should return to the lobby.
      { type: "queue_counts", counts }
      { type: "error", message }
    """
    await websocket.accept()
    current_match_id: str | None = None

    # Reconnect mid-game
    for room_candidate in _active_rooms.values():
        if not room_candidate.is_active_member(user_id):
            continue

        # The grace-period clock (DISCONNECT_GRACE_SECS) already ran out
        # while this player was gone — meaning their turn was auto-skipped
        # and/or their votes were excluded without them — so this socket is
        # coming back too late to resume THIS match. Cut them loose from it
        # (so the next scan/join_queue doesn't keep pulling them back into a
        # match that already moved on without them) and tell the client to
        # head back to the lobby instead of resuming. A "done" room is
        # explicitly excluded from this: the match is already fully over
        # either way, so there's nothing left to have missed — still worth
        # resending them their results below.
        if room_candidate.status in ("in_progress", "voting") and user_id in room_candidate.disconnected:
            room_candidate.left.add(user_id)
            await websocket.send_json({
                "type": "removed_from_match",
                "matchId": room_candidate.match_id,
                "reason": "disconnect_timeout",
            })
            break

        if room_candidate.status in ("in_progress", "voting", "done"):
            current_match_id = room_candidate.match_id
            room_candidate.connections[user_id] = websocket
            was_disconnected = user_id in room_candidate.disconnected
            room_candidate.disconnected.discard(user_id)
            had_pending_grace = room_candidate.cancel_pending_disconnect(user_id)
            if was_disconnected or had_pending_grace:
                await manager.notify_reconnected(room_candidate, user_id, was_pending=had_pending_grace)

            if room_candidate.status == "voting":
                await websocket.send_json({
                    "type": "voting_start",
                    **room_candidate.state_snapshot(include_audio=True),
                    "timeoutSecs": room_candidate.remaining_vote_secs(END_VOTE_PHASE_TIMEOUT_SECS),
                })
            elif room_candidate.status == "done":
                # The match already finished while this player was
                # disconnected — resend their results instead of leaving
                # them stuck waiting on a screen for a message that already
                # went out before they reconnected.
                await websocket.send_json({
                    "type": "results",
                    "matchId": room_candidate.match_id,
                    "winner": room_candidate.last_result_winner,
                    "votes": room_candidate.last_result_votes,
                    "mvp": room_candidate.last_result_mvp,
                    "recordings": room_candidate.state_snapshot(include_audio=True)["recordings"],
                    "teams": room_candidate.get_teams(),
                    "xpSaveError": False,
                })
            else:
                payload = {
                    "type": "game_start",
                    **room_candidate.state_snapshot(include_audio=True),
                }
                pending_loop_vote = room_candidate.pending_loop_vote_for(user_id)
                if pending_loop_vote:
                    payload["pendingLoopVote"] = pending_loop_vote
                await websocket.send_json(payload)
            break

    try:
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_json(), timeout=WS_IDLE_TIMEOUT_SECS)
            except asyncio.TimeoutError:
                # No frame at all — not even a ping — for WS_IDLE_TIMEOUT_SECS.
                # A live client pings every 8s, so this means the connection
                # is dead even though no close frame ever arrived. Close it
                # ourselves and fall through to the same cleanup path a
                # normal WebSocketDisconnect would take.
                try:
                    await websocket.close(code=1001)
                except Exception:
                    pass
                if current_match_id:
                    await manager.disconnect(current_match_id, user_id, websocket)
                return

            msg_type = raw.get("type")

            # ── HEARTBEAT ────────────────────────────────────────────
            # The client pings periodically and expects a pong back. If a
            # socket goes silently stale (no clean close, just stops
            # delivering — common on mobile networks going idle or a tab
            # being backgrounded) this is how the client notices and forces
            # a reconnect, instead of the only recovery path being "the
            # player manually refreshes the page".
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})

            # ── GET QUEUE COUNTS ────────────────────────────────────
            elif msg_type == "get_queue_counts":
                counts = get_queue_counts()
                await websocket.send_json({
                    "type": "queue_counts",
                    "counts": counts,
                })

            # ── JOIN QUEUE ──────────────────────────────────────────
            elif msg_type == "join_queue":
                team_size = int(raw.get("teamSize", 4))
                genre = raw.get("genre", "Hip-Hop")
                display_name = raw.get("displayName", "Player")
                color = raw.get("color", "#a855f7")
                level = int(raw.get("level", 1))
                xp = int(raw.get("xp", 0))
                xp_to_next = int(raw.get("xpToNext", 650))
                msg_user_id = raw.get("userId", "").strip()
                if msg_user_id:
                    user_id = msg_user_id

                existing_room = None
                for room_candidate in _active_rooms.values():
                    if (room_candidate.status in ("in_progress", "voting")
                            and room_candidate.is_active_member(user_id)):
                        existing_room = room_candidate
                        break

                if existing_room:
                    room = existing_room
                    current_match_id = room.match_id
                    room.connections[user_id] = websocket
                    was_disconnected = user_id in room.disconnected
                    room.disconnected.discard(user_id)
                    had_pending_grace = room.cancel_pending_disconnect(user_id)
                    if was_disconnected or had_pending_grace:
                        await manager.notify_reconnected(room, user_id, was_pending=had_pending_grace)

                    if room.status == "voting":
                        await websocket.send_json({
                            "type": "voting_start",
                            **room.state_snapshot(include_audio=True),
                            "timeoutSecs": room.remaining_vote_secs(END_VOTE_PHASE_TIMEOUT_SECS),
                        })
                    else:
                        payload = {
                            "type": "game_start",
                            **room.state_snapshot(include_audio=True),
                        }
                        pending_loop_vote = room.pending_loop_vote_for(user_id)
                        if pending_loop_vote:
                            payload["pendingLoopVote"] = pending_loop_vote
                        await websocket.send_json(payload)
                    continue

                room = get_or_create_room(team_size, genre)
                current_match_id = room.match_id

                # A player can land back here via join_queue while their room is
                # still "waiting" (e.g. they refreshed before the room filled up).
                # In that case room.already_has_player() is already True and
                # add_player() below is a no-op that just returns the existing
                # entry — but we still need to mark them as connected again,
                # otherwise they stay flagged in room.disconnected forever even
                # though their socket is live. Previously this discard only
                # happened in the existing_room branch above (for in_progress /
                # voting rooms), never here, which is what left rejoining
                # players permanently treated as "gone": their turns got
                # auto-skipped and their votes excluded from tallies even
                # though they were actively playing.
                is_rejoin = room.already_has_player(user_id)
                room.connections[user_id] = websocket
                room.disconnected.discard(user_id)
                room.cancel_pending_disconnect(user_id)

                is_premium = False
                async with AsyncSessionLocal() as db:
                    from app.models import User as UserModel
                    db_user = await db.get(UserModel, user_id)
                    if db_user:
                        is_premium = bool(db_user.is_premium)

                room.add_player(user_id, display_name, color, level, xp, xp_to_next, is_premium)

                await websocket.send_json({
                    "type": "queued",
                    "matchId": room.match_id,
                    "playersJoined": room.human_count,
                    "playersNeeded": room.total_slots,
                })

                # Only announce a "player_joined" to the rest of the room when
                # this is an actual new player — not when an already-counted
                # player is simply reconnecting after a refresh.
                if not is_rejoin:
                    await room.broadcast({
                        "type": "player_joined",
                        "playersJoined": room.human_count,
                        "playersNeeded": room.total_slots,
                        "displayName": display_name,
                    }, exclude=user_id)

                if room.is_full():
                    async with AsyncSessionLocal() as db:
                        await start_match(room, db=db)

            # ── LEAVE MATCH (explicit — e.g. "Play Again" on the results
            # screen) ────────────────────────────────────────────────
            # Distinct from a disconnect: this is the client telling us on
            # purpose that it's done with this room, not its socket dying.
            # Drops them from connections (so the room stops broadcasting
            # things like a former teammate's reconnect to them) and marks
            # them `left` (so the reconnect-scans above stop pulling them
            # back into this room on their next page refresh).
            elif msg_type == "leave_match":
                match_id = raw.get("matchId", current_match_id)
                room = get_room(match_id)
                if room:
                    room.connections.pop(user_id, None)
                    room.disconnected.discard(user_id)
                    room.cancel_pending_disconnect(user_id)
                    room.left.add(user_id)
                if current_match_id == match_id:
                    current_match_id = None

            # ── LOOP VOTE REQUEST (from recorder, after upload) ─────
            elif msg_type == "loop_vote_request":
                match_id = raw.get("matchId", current_match_id)
                room = get_room(match_id)
                if not room:
                    continue
                recording = raw.get("recording")
                audio_b64 = raw.get("audiob64")
                # Determine the team from the message or from the player's team
                team_id = raw.get("teamId")
                if not team_id:
                    player = room.get_player(user_id)
                    team_id = player.get("teamId") if player else None
                if team_id:
                    await start_loop_vote(room, team_id=team_id, recorder_id=user_id,
                                          recording=recording, audio_b64=audio_b64)

            # ── LOOP VOTE CAST (from a teammate) ────────────────────
            elif msg_type == "loop_vote_cast":
                match_id = raw.get("matchId", current_match_id)
                room = get_room(match_id)
                if not room:
                    continue
                vote = raw.get("vote", "keep")
                team_id = raw.get("teamId")
                if not team_id:
                    player = room.get_player(user_id)
                    team_id = player.get("teamId") if player else None
                if team_id:
                    await receive_loop_vote(room, voter_id=user_id, vote=vote, team_id=team_id)

            # ── SONG VOTE ────────────────────────────────────────────
            elif msg_type == "song_vote":
                match_id = raw.get("matchId", current_match_id)
                room = get_room(match_id)
                # If the room is gone, or the match has already been tallied
                # (e.g. the 30s end-vote timeout already fired), don't process
                # the vote and — critically — don't send an ack. A late ack
                # here is what previously pushed the client into the MVP
                # phase after the server had already moved on, leaving the
                # player stuck waiting for results that already happened.
                if not room or room.status == "done":
                    continue
                await receive_song_vote(
                    room,
                    voter_id=user_id,
                    rating_a=int(raw.get("ratingA", 1)),
                    rating_b=int(raw.get("ratingB", 1)),
                )
                await websocket.send_json({"type": "song_vote_ack", "matchId": match_id})

            # ── MVP VOTE ─────────────────────────────────────────────
            elif msg_type == "mvp_vote":
                match_id = raw.get("matchId", current_match_id)
                room = get_room(match_id)
                if not room or room.status == "done":
                    continue
                async with AsyncSessionLocal() as db:
                    await receive_mvp_vote(
                        room,
                        voter_id=user_id,
                        pick_a=raw.get("pickA", ""),
                        pick_b=raw.get("pickB", ""),
                        db=db,
                    )

            # ── BPM CHANGE ───────────────────────────────────────────
            elif msg_type == "bpm_change":
                match_id = raw.get("matchId", current_match_id)
                room = get_room(match_id)
                if room:
                    room.bpm = int(raw.get("bpm", 90))
                    await room.broadcast({"type": "bpm_changed", "bpm": room.bpm}, exclude=user_id)

            # ── PREMIUM IN-GAME CHAT ─────────────────────────────────
            elif msg_type == "chat_message":
                match_id = raw.get("matchId", current_match_id)
                room = get_room(match_id)
                if room and room.is_active_member(user_id):
                    # Verify the sender is a premium user before relaying
                    async with AsyncSessionLocal() as db:
                        from app.models import User as UserModel
                        sender = await db.get(UserModel, user_id)
                        if sender and sender.is_premium:
                            content = str(raw.get("content", "")).strip()[:200]
                            if content:
                                import uuid as _uuid, time as _time
                                chat_payload = {
                                    "type": "chat_message",
                                    "id": str(_uuid.uuid4()),
                                    "matchId": match_id,
                                    "userId": user_id,
                                    "displayName": raw.get("displayName", sender.display_name),
                                    "avatarColor": raw.get("avatarColor", sender.avatar_color),
                                    "content": content,
                                    "timestamp": int(_time.time() * 1000),
                                }
                                # Broadcast to everyone else in the match (sender added optimistically on frontend)
                                await room.broadcast(chat_payload, exclude=user_id)

    except (WebSocketDisconnect, ConnectionClosed):
        # WebSocketDisconnect is a clean/expected close. ConnectionClosed
        # (e.g. websockets.exceptions.ConnectionClosedError, code 1011
        # "keepalive ping timeout") is an abnormal closure — most often a
        # proxy or idle network dropping the underlying TCP connection
        # without a close handshake. Both mean the same thing for game
        # state purposes: this socket is gone, so route both through the
        # same cleanup path. Previously only WebSocketDisconnect was
        # caught here explicitly; ConnectionClosed fell into the generic
        # `except Exception` below, which still called manager.disconnect
        # correctly, but also wasted a doomed send_json() attempt on a
        # socket that had already told us it was closed.
        if current_match_id:
            await manager.disconnect(current_match_id, user_id, websocket)
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
        if current_match_id:
            await manager.disconnect(current_match_id, user_id, websocket)
