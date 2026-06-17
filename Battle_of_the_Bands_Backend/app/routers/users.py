from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_db
from app.models import User
from app.services.xp_system import xp_to_next_level, COLORS
import uuid, random

router = APIRouter(prefix="/users", tags=["users"])

class GuestRegisterRequest(BaseModel):
    username: str
    avatar_color: str | None = None

class OAuthRegisterRequest(BaseModel):
    oauth_id: str
    auth_type: str   # "discord" | "google"
    display_name: str
    username: str
    avatar_color: str | None = None

def user_to_dict(u: User):
    return {
        "id": u.id,
        "username": u.username,
        "displayName": u.display_name,
        "authType": u.auth_type,
        "avatarColor": u.avatar_color,
        "level": u.level,
        "xp": u.xp,
        "xpToNext": u.xp_to_next,
        "wins": u.wins,
        "battles": u.battles,
        "mvps": u.mvps,
    }

@router.post("/register/guest")
async def register_guest(body: GuestRegisterRequest, db: AsyncSession = Depends(get_db)):
    # Check if username taken
    existing = await db.execute(select(User).where(User.username == body.username))
    existing = existing.scalar_one_or_none()
    if existing:
        # If it's the same guest returning (same username, guest auth), return their profile
        if existing.auth_type == "guest":
            return user_to_dict(existing)
        raise HTTPException(400, "Username already taken")

    color = body.avatar_color or random.choice(COLORS)
    user = User(
        id=str(uuid.uuid4()),
        username=body.username,
        display_name=body.username,
        auth_type="guest",
        avatar_color=color,
        xp_to_next=xp_to_next_level(1),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user_to_dict(user)

@router.post("/register/oauth")
async def register_oauth(body: OAuthRegisterRequest, db: AsyncSession = Depends(get_db)):
    # Check if oauth_id already registered
    existing = await db.execute(
        select(User).where(User.oauth_id == body.oauth_id, User.auth_type == body.auth_type)
    )
    existing = existing.scalar_one_or_none()
    if existing:
        return user_to_dict(existing)

    # Check username availability
    name_check = await db.execute(select(User).where(User.username == body.username))
    if name_check.scalar_one_or_none():
        raise HTTPException(400, "Username already taken. Please choose another.")

    color = body.avatar_color or random.choice(COLORS)
    user = User(
        id=str(uuid.uuid4()),
        username=body.username,
        display_name=body.display_name,
        auth_type=body.auth_type,
        oauth_id=body.oauth_id,
        avatar_color=color,
        xp_to_next=xp_to_next_level(1),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user_to_dict(user)

@router.get("/{user_id}")
async def get_user(user_id: str, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return user_to_dict(user)

@router.get("/by-username/{username}")
async def get_by_username(username: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    return user_to_dict(user)
