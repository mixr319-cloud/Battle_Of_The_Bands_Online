import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
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


@router.websocket("/ws/{user_id}")
async def matchmaking_ws(websocket: WebSocket, user_id: str):
    """
    Single WebSocket endpoint for the entire game lifecycle.

    Messages the CLIENT sends:
      { type: "join_queue", teamSize, genre, displayName, color, level, xp, xpToNext }
      { type: "loop_vote_request", matchId, recording, teamId }
          — sent by the recorder after uploading; server fans out to their teammates only
      { type: "loop_vote_cast", matchId, vote: "keep"|"drop", teamId }
          — sent by each teammate in response to loop_vote_request
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
      { type: "queue_counts", counts }
      { type: "error", message }
    """
    await websocket.accept()
    current_match_id: str | None = None

    # Reconnect mid-game
    for room_candidate in _active_rooms.values():
        if room_candidate.already_has_player(user_id) and room_candidate.status in ("in_progress", "voting", "done"):
            current_match_id = room_candidate.match_id
            room_candidate.connections[user_id] = websocket
            room_candidate.disconnected.discard(user_id)

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
                await websocket.send_json({
                    "type": "game_start",
                    **room_candidate.state_snapshot(include_audio=True),
                })
            break

    try:
        async for raw in websocket.iter_json():
            msg_type = raw.get("type")

            # ── GET QUEUE COUNTS ────────────────────────────────────
            if msg_type == "get_queue_counts":
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
                            and room_candidate.already_has_player(user_id)):
                        existing_room = room_candidate
                        break

                if existing_room:
                    room = existing_room
                    current_match_id = room.match_id
                    room.connections[user_id] = websocket
                    room.disconnected.discard(user_id)

                    if room.status == "voting":
                        await websocket.send_json({
                            "type": "voting_start",
                            **room.state_snapshot(include_audio=True),
                            "timeoutSecs": room.remaining_vote_secs(END_VOTE_PHASE_TIMEOUT_SECS),
                        })
                    else:
                        await websocket.send_json({
                            "type": "game_start",
                            **room.state_snapshot(include_audio=True),
                        })
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

                room.add_player(user_id, display_name, color, level, xp, xp_to_next)

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

    except WebSocketDisconnect:
        if current_match_id:
            await manager.disconnect(current_match_id, user_id)
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
        if current_match_id:
            await manager.disconnect(current_match_id, user_id)
