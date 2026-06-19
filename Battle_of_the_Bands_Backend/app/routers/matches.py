import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.database import AsyncSessionLocal
from app.services.matchmaking import (
    get_or_create_room, get_room, manager,
    start_match, advance_turn, handle_vote_complete,
    start_loop_vote, receive_loop_vote,
    receive_song_vote, receive_mvp_vote,
    get_queue_counts, _active_rooms
)

router = APIRouter(prefix="/matches", tags=["matches"])


@router.websocket("/ws/{user_id}")
async def matchmaking_ws(websocket: WebSocket, user_id: str):
    """
    Single WebSocket endpoint for the entire game lifecycle.

    Messages the CLIENT sends:
      { type: "join_queue", teamSize, genre, displayName, color, level, xp, xpToNext }
      { type: "loop_vote_request", matchId, recording }
          — sent by the recorder after uploading; server fans out to teammates
      { type: "loop_vote_cast", matchId, vote: "keep"|"drop" }
          — sent by each teammate in response to loop_vote_request
      { type: "song_vote", matchId, ratingA, ratingB }
          — end-of-game: each player rates both teams 1-4 stars
      { type: "mvp_vote", matchId, pickA, pickB }
          — end-of-game: each player picks an MVP per team
      { type: "bpm_change", matchId, bpm }
      { type: "get_queue_counts" }

    Messages the SERVER sends:
      { type: "queued", matchId, playersJoined, playersNeeded }
      { type: "player_joined", playersJoined, playersNeeded, displayName }
      { type: "game_start", matchId, teams, battleKey, bpm, currentTurn, ... }
      { type: "turn_advance", matchId, currentTurn, teams, recordings, ... }
      { type: "loop_vote_request", matchId, recording, recorderName }
          — server → teammates only
      { type: "loop_vote_result", matchId, kept, keepCount, dropCount, recorderName }
          — server → everyone
      { type: "voting_start", ... }
      { type: "results", winner, votes, mvp, recordings }
      { type: "player_disconnected", userId }
      { type: "queue_counts", counts }
      { type: "error", message }
    """
    await websocket.accept()
    current_match_id: str | None = None

    # If this user is already a player in an in-progress room (e.g. their
    # socket dropped and reconnected mid-game), reattach them immediately —
    # the client never re-sends "join_queue" after the match has started,
    # so without this a transient disconnect would leave them permanently
    # marked disconnected for the rest of the match.
    for room_candidate in _active_rooms.values():
        if room_candidate.status in ("in_progress", "voting") and room_candidate.already_has_player(user_id):
            current_match_id = room_candidate.match_id
            room_candidate.connections[user_id] = websocket
            room_candidate.disconnected.discard(user_id)
            
            if room_candidate.status == "voting":
                await websocket.send_json({
                    "type": "voting_start",
                    **room_candidate.state_snapshot(include_audio=True),
                })
            else:
                await websocket.send_json({
                    "type": "game_start",
                    **room_candidate.state_snapshot(),
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
                # Prefer the userId sent in the message payload; fall back to the
                # URL path param.  This ensures p["id"] always matches the DB row
                # so XP can be saved correctly after the match.
                msg_user_id = raw.get("userId", "").strip()
                if msg_user_id:
                    user_id = msg_user_id

                # Check if this user is already in an IN-PROGRESS room (reconnect mid-game)
                # Only reattach if the game has already started — not while still in the
                # waiting queue, otherwise multiple tabs from the same user fill slots.
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
                        })
                    else:
                        await websocket.send_json({
                            "type": "game_start",
                            **room.state_snapshot(),
                        })
                    continue

                room = get_or_create_room(team_size, genre)
                current_match_id = room.match_id
                room.connections[user_id] = websocket

                room.add_player(user_id, display_name, color, level, xp, xp_to_next)

                await websocket.send_json({
                    "type": "queued",
                    "matchId": room.match_id,
                    "playersJoined": room.human_count,
                    "playersNeeded": room.total_slots,
                })

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
                audio_b64 = raw.get("audiob64")  # base64 audio for instant teammate playback
                await start_loop_vote(room, recorder_id=user_id, recording=recording, audio_b64=audio_b64)

            # ── LOOP VOTE CAST (from a teammate) ────────────────────
            elif msg_type == "loop_vote_cast":
                match_id = raw.get("matchId", current_match_id)
                room = get_room(match_id)
                if not room:
                    continue
                vote = raw.get("vote", "keep")
                await receive_loop_vote(room, voter_id=user_id, vote=vote)

            # ── SONG VOTE (end-of-game, one per player) ─────────────
            elif msg_type == "song_vote":
                match_id = raw.get("matchId", current_match_id)
                room = get_room(match_id)
                if not room:
                    continue
                await receive_song_vote(
                    room,
                    voter_id=user_id,
                    rating_a=int(raw.get("ratingA", 1)),
                    rating_b=int(raw.get("ratingB", 1)),
                )
                # Acknowledge so the client can move to MVP phase
                await websocket.send_json({"type": "song_vote_ack", "matchId": match_id})

            # ── MVP VOTE (end-of-game, one per player) ───────────────
            elif msg_type == "mvp_vote":
                match_id = raw.get("matchId", current_match_id)
                room = get_room(match_id)
                if not room:
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
