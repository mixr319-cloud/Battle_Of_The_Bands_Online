import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.database import AsyncSessionLocal
from app.services.matchmaking import (
    get_or_create_room, get_room, manager,
    start_match, advance_turn, handle_vote_complete,
    SOLO_TIMEOUT_SECS, get_queue_counts
)

router = APIRouter(prefix="/matches", tags=["matches"])


@router.websocket("/ws/{user_id}")
async def matchmaking_ws(websocket: WebSocket, user_id: str):
    """
    Single WebSocket endpoint for the entire game lifecycle.

    Messages the CLIENT sends:
      { type: "join_queue", teamSize, genre, displayName, color, level, xp, xpToNext }
      { type: "recording_done", matchId, recordingId?, waveform, playerName, teamId }
      { type: "vote_complete", matchId, winner, votesA, votesB, mvpAId, mvpBId }
      { type: "bpm_change", matchId, bpm }
      { type: "get_queue_counts" }

    Messages the SERVER sends:
      { type: "queued", matchId, playersJoined, playersNeeded }
      { type: "game_start", matchId, teams, battleKey, bpm, currentTurn, ... }
      { type: "turn_advance", matchId, currentTurn, teams, recordings, ... }
      { type: "voting_start", ... }
      { type: "results", winner, votes, mvp, recordings }
      { type: "player_disconnected", userId }
      { type: "queue_counts", counts }
      { type: "error", message }
    """
    await websocket.accept()
    current_match_id: str | None = None

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

                # Notify others in room
                await room.broadcast({
                    "type": "player_joined",
                    "playersJoined": room.human_count,
                    "playersNeeded": room.total_slots,
                    "displayName": display_name,
                }, exclude=user_id)

                if room.is_full():
                    # All slots filled with real players — start immediately
                    async with AsyncSessionLocal() as db:
                        await start_match(room, db=db)
                else:
                    # Spawn/reset the countdown. We snapshot timeout_version now;
                    # if another player joins before the sleep ends, version increments
                    # and this task silently exits without starting the match early.
                    async def solo_timeout(r=room, v=room.timeout_version):
                        await asyncio.sleep(SOLO_TIMEOUT_SECS)
                        if r.status == "waiting" and r.timeout_version == v:
                            async with AsyncSessionLocal() as db:
                                await start_match(r, db=db)

                    asyncio.create_task(solo_timeout())

            # ── RECORDING DONE ──────────────────────────────────────
            elif msg_type == "recording_done":
                match_id = raw.get("matchId", current_match_id)
                room = get_room(match_id)
                if not room:
                    continue

                recording_id = raw.get("recordingId")
                waveform = raw.get("waveform", [])
                player_name = raw.get("playerName", "")
                team_id = raw.get("teamId", "A")
                kept = raw.get("kept", True)

                recording = None
                if kept and recording_id:
                    recording = {
                        "id": recording_id,
                        "teamId": team_id,
                        "playerName": player_name,
                        "waveform": waveform,
                        "url": f"/uploads/audio/{recording_id}",
                    }

                # Mark player as recorded
                for p in room.players:
                    if p["id"] == user_id:
                        p["hasRecorded"] = True
                        p["isRecording"] = False

            await advance_turn(room, team_id, recording=recording)

            # ── VOTE COMPLETE ────────────────────────────────────────
            elif msg_type == "vote_complete":
                match_id = raw.get("matchId", current_match_id)
                room = get_room(match_id)
                if not room:
                    continue
                await handle_vote_complete(
                    room,
                    winner=raw["winner"],
                    votes_a=raw["votesA"],
                    votes_b=raw["votesB"],
                    mvp_a_id=raw["mvpAId"],
                    mvp_b_id=raw["mvpBId"],
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
