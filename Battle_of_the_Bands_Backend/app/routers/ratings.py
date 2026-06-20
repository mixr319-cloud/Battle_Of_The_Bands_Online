from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from app.database import get_db
from app.models import Match, MatchPlayer, User
from app.services.xp_system import apply_xp
from sqlalchemy import select

router = APIRouter(prefix="/ratings", tags=["ratings"])

class RatingSubmit(BaseModel):
    match_id: str
    winner_team: str
    votes_a: int
    votes_b: int
    mvp_a_user_id: str
    mvp_b_user_id: str

@router.post("/submit")
async def submit_rating(body: RatingSubmit, db: AsyncSession = Depends(get_db)):
    match = await db.get(Match, body.match_id)
    if not match:
        raise HTTPException(404, "Match not found")

    match.winner_team = body.winner_team
    match.status = "done"

    # Award XP to all players
    result = await db.execute(
        select(MatchPlayer).where(MatchPlayer.match_id == body.match_id)
    )
    players = result.scalars().all()
    mvp_ids = {body.mvp_a_user_id, body.mvp_b_user_id}

    for mp in players:
        user = await db.get(User, mp.user_id)
        if not user:
            continue
        is_winner = mp.team_id == body.winner_team
        is_mvp = mp.user_id in mvp_ids
        base_xp = 180 if is_winner else 60
        bonus_xp = 120 if is_mvp else 0
        total_xp = base_xp + bonus_xp

        mp.xp_earned = total_xp
        mp.is_mvp = is_mvp
        new_xp, new_level, new_xp_to_next = apply_xp(user.xp, user.level, total_xp)
        user.xp = new_xp
        user.level = new_level
        user.xp_to_next = new_xp_to_next
        user.battles += 1
        if is_winner:
            user.wins += 1
        if is_mvp:
            user.mvps += 1

    await db.commit()
    return {"status": "ok", "winner": body.winner_team}
