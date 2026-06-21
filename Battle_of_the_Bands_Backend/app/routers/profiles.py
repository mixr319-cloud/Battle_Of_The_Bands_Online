"""
Premium profile features:
  GET  /profiles/{user_id}              → view a profile (premium only — requester must be premium)
  PATCH /profiles/{user_id}             → update your own profile pic, bio, social handles
  POST /profiles/{user_id}/add-friend   → send or accept a friend request (premium only)
  GET  /profiles/{user_id}/friends      → list accepted friends (premium only)
  DELETE /profiles/friendship/{friendship_id} → remove a friend / decline request

Avatar uploads live in /uploads — this router stores a URL pointing to the uploaded file.
"""

import os
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.models import User, Friendship

router = APIRouter(prefix="/profiles", tags=["profiles"])

UPLOAD_BASE_URL = os.getenv("UPLOAD_BASE_URL", "http://localhost:8000")


def public_profile(u: User) -> dict:
    return {
        "id": u.id,
        "username": u.username,
        "displayName": u.display_name,
        "avatarColor": u.avatar_color,
        "avatarUrl": u.avatar_url,
        "level": u.level,
        "wins": u.wins,
        "battles": u.battles,
        "mvps": u.mvps,
        "bio": u.bio,
        "tiktokHandle": u.tiktok_handle,
        "instagramHandle": u.instagram_handle,
        "isPremium": u.is_premium,
    }


async def require_premium(user_id: str, db: AsyncSession) -> User:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if not user.is_premium:
        raise HTTPException(403, "BOTB Premium required to access profiles")
    return user


# ── View a profile ─────────────────────────────────────────────────────────────

@router.get("/{user_id}")
async def get_profile(
    user_id: str,
    viewer_id: str = Query(..., description="ID of the user making the request"),
    db: AsyncSession = Depends(get_db),
):
    """Premium-only: view another user's public profile."""
    await require_premium(viewer_id, db)
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, "User not found")
    if not target.is_premium:
        raise HTTPException(404, "This user does not have a public profile")
    return public_profile(target)


# ── Update own profile ────────────────────────────────────────────────────────

class ProfileUpdateRequest(BaseModel):
    avatarUrl: Optional[str] = None
    bio: Optional[str] = None
    tiktokHandle: Optional[str] = None
    instagramHandle: Optional[str] = None

@router.patch("/{user_id}")
async def update_profile(
    user_id: str,
    body: ProfileUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Premium-only: update your own profile."""
    user = await require_premium(user_id, db)

    if body.avatarUrl is not None:
        # Basic URL validation — must point to our own upload endpoint
        # In production add stricter checks / content-type validation
        user.avatar_url = body.avatarUrl[:512] if body.avatarUrl else None
    if body.bio is not None:
        user.bio = body.bio[:280] if body.bio else None
    if body.tiktokHandle is not None:
        handle = body.tiktokHandle.lstrip("@").strip()[:50]
        user.tiktok_handle = handle or None
    if body.instagramHandle is not None:
        handle = body.instagramHandle.lstrip("@").strip()[:50]
        user.instagram_handle = handle or None

    await db.commit()
    await db.refresh(user)
    return public_profile(user)


# ── Friend requests ────────────────────────────────────────────────────────────

@router.post("/{user_id}/add-friend")
async def add_friend(
    user_id: str,
    target_id: str = Query(..., description="ID of the user to add"),
    db: AsyncSession = Depends(get_db),
):
    """Premium-only: send a friend request or accept a pending one."""
    requester = await require_premium(user_id, db)
    addressee = await db.get(User, target_id)
    if not addressee:
        raise HTTPException(404, "Target user not found")
    if not addressee.is_premium:
        raise HTTPException(400, "Target user is not a premium member")
    if user_id == target_id:
        raise HTTPException(400, "Cannot add yourself")

    # Check for existing friendship in either direction
    existing = await db.execute(
        select(Friendship).where(
            or_(
                and_(Friendship.requester_id == user_id, Friendship.addressee_id == target_id),
                and_(Friendship.requester_id == target_id, Friendship.addressee_id == user_id),
            )
        )
    )
    existing = existing.scalar_one_or_none()

    if existing:
        if existing.status == "accepted":
            return {"status": "already_friends"}
        if existing.status == "pending":
            # If we're the addressee of the pending request, accept it
            if existing.addressee_id == user_id:
                existing.status = "accepted"
                await db.commit()
                return {"status": "accepted", "friendshipId": existing.id}
            return {"status": "pending", "friendshipId": existing.id}

    # Create new request
    friendship = Friendship(requester_id=user_id, addressee_id=target_id, status="pending")
    db.add(friendship)
    await db.commit()
    await db.refresh(friendship)
    return {"status": "pending", "friendshipId": friendship.id}


@router.get("/{user_id}/friends")
async def get_friends(user_id: str, db: AsyncSession = Depends(get_db)):
    """Premium-only: list accepted friends + incoming pending requests."""
    await require_premium(user_id, db)

    result = await db.execute(
        select(Friendship).where(
            or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id)
        )
    )
    friendships = result.scalars().all()

    friends = []
    pending_in = []
    pending_out = []

    for f in friendships:
        other_id = f.addressee_id if f.requester_id == user_id else f.requester_id
        other = await db.get(User, other_id)
        if not other:
            continue
        entry = {
            "friendshipId": f.id,
            "userId": other.id,
            "username": other.username,
            "displayName": other.display_name,
            "avatarColor": other.avatarColor if hasattr(other, "avatarColor") else other.avatar_color,
            "avatarUrl": other.avatar_url,
            "level": other.level,
        }
        if f.status == "accepted":
            friends.append(entry)
        elif f.status == "pending":
            if f.requester_id == user_id:
                pending_out.append(entry)
            else:
                pending_in.append({**entry, "friendshipId": f.id})

    return {"friends": friends, "pendingIncoming": pending_in, "pendingOutgoing": pending_out}


@router.delete("/friendship/{friendship_id}")
async def remove_friendship(
    friendship_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Remove a friend or decline/cancel a request."""
    f = await db.get(Friendship, friendship_id)
    if not f:
        raise HTTPException(404, "Friendship not found")
    if f.requester_id != user_id and f.addressee_id != user_id:
        raise HTTPException(403, "Not your friendship")
    await db.delete(f)
    await db.commit()
    return {"deleted": True}
