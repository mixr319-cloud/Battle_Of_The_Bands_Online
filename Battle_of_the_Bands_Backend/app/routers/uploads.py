import os, uuid, json
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models import AudioRecording
import aiofiles

router = APIRouter(prefix="/uploads", tags=["uploads"])

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./audio_uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/audio")
async def upload_audio(
    file: UploadFile = File(...),
    match_id: str = Form(...),
    user_id: str = Form(...),
    team_id: str = Form(...),
    player_name: str = Form(...),
    waveform: str = Form("[]"),
    db: AsyncSession = Depends(get_db),
):
    ext = file.filename.split(".")[-1] if file.filename and "." in file.filename else "webm"
    filename = f"{uuid.uuid4()}.{ext}"
    file_path = os.path.join(UPLOAD_DIR, filename)

    contents = await file.read()
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(contents)

    rec = AudioRecording(
        match_id=match_id,
        user_id=user_id,
        team_id=team_id,
        player_name=player_name,
        file_path=file_path,
        waveform_json=waveform,
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    return {"id": rec.id, "url": f"/uploads/audio/{rec.id}"}

@router.get("/audio/{recording_id}")
async def get_audio(recording_id: str, db: AsyncSession = Depends(get_db)):
    rec = await db.get(AudioRecording, recording_id)
    if not rec or not os.path.exists(rec.file_path):
        raise HTTPException(404, "Recording not found")
    from fastapi.responses import FileResponse
    return FileResponse(rec.file_path, media_type="audio/webm")

@router.get("/match/{match_id}/recordings")
async def get_match_recordings(match_id: str, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select
    result = await db.execute(
        select(AudioRecording).where(AudioRecording.match_id == match_id, AudioRecording.kept == True)
    )
    recs = result.scalars().all()
    return [
        {
            "id": r.id,
            "teamId": r.team_id,
            "playerName": r.player_name,
            "waveform": json.loads(r.waveform_json or "[]"),
            "url": f"/uploads/audio/{r.id}",
        }
        for r in recs
    ]
