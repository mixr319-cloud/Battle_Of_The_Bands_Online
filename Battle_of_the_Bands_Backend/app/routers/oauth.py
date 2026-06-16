"""
Real OAuth2 flows for Discord and Google.

Setup required:
  Discord: https://discord.com/developers/applications
    - Add redirect URI: {YOUR_DOMAIN}/auth/discord/callback
    - Copy Client ID + Secret to .env

  Google: https://console.cloud.google.com → APIs & Services → Credentials
    - Add redirect URI: {YOUR_DOMAIN}/auth/google/callback
    - Copy Client ID + Secret to .env
"""
import os, uuid, random
import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends
from app.database import get_db
from app.models import User
from app.services.xp_system import xp_to_next_level, COLORS
from sqlalchemy import select

router = APIRouter(prefix="/auth", tags=["oauth"])

DISCORD_CLIENT_ID = os.getenv("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.getenv("DISCORD_CLIENT_SECRET", "")
DISCORD_REDIRECT_URI = os.getenv("DISCORD_REDIRECT_URI", "http://localhost:8000/auth/discord/callback")

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/auth/google/callback")

# After OAuth we redirect the user back to the frontend with their profile encoded
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")


# ── DISCORD ─────────────────────────────────────────────────────────

@router.get("/discord")
def discord_login():
    if not DISCORD_CLIENT_ID:
        raise HTTPException(500, "Discord OAuth not configured. Set DISCORD_CLIENT_ID in .env")
    url = (
        f"https://discord.com/api/oauth2/authorize"
        f"?client_id={DISCORD_CLIENT_ID}"
        f"&redirect_uri={DISCORD_REDIRECT_URI}"
        f"&response_type=code"
        f"&scope=identify"
    )
    return RedirectResponse(url)

@router.get("/discord/callback")
async def discord_callback(code: str, db: AsyncSession = Depends(get_db)):
    if not DISCORD_CLIENT_ID:
        raise HTTPException(500, "Discord OAuth not configured")

    async with httpx.AsyncClient() as client:
        # Exchange code for token
        token_res = await client.post(
            "https://discord.com/api/oauth2/token",
            data={
                "client_id": DISCORD_CLIENT_ID,
                "client_secret": DISCORD_CLIENT_SECRET,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": DISCORD_REDIRECT_URI,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if token_res.status_code != 200:
            raise HTTPException(400, "Failed to exchange Discord code")
        token_data = token_res.json()
        access_token = token_data["access_token"]

        # Fetch Discord user info
        user_res = await client.get(
            "https://discord.com/api/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if user_res.status_code != 200:
            raise HTTPException(400, "Failed to fetch Discord user")
        discord_user = user_res.json()

    oauth_id = discord_user["id"]
    display_name = discord_user.get("global_name") or discord_user.get("username", "DiscordUser")

    user = await _upsert_oauth_user(db, oauth_id, "discord", display_name)
    return RedirectResponse(
        f"{FRONTEND_URL}?auth=discord"
        f"&userId={user.id}"
        f"&username={user.username}"
        f"&displayName={user.display_name}"
        f"&color={user.avatar_color.replace('#','')}"
        f"&level={user.level}&xp={user.xp}&xpToNext={user.xp_to_next}"
        f"&wins={user.wins}&battles={user.battles}&mvps={user.mvps}"
    )


# ── GOOGLE ──────────────────────────────────────────────────────────

@router.get("/google")
def google_login():
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(500, "Google OAuth not configured. Set GOOGLE_CLIENT_ID in .env")
    url = (
        f"https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={GOOGLE_CLIENT_ID}"
        f"&redirect_uri={GOOGLE_REDIRECT_URI}"
        f"&response_type=code"
        f"&scope=openid%20profile"
        f"&access_type=offline"
    )
    return RedirectResponse(url)

@router.get("/google/callback")
async def google_callback(code: str, db: AsyncSession = Depends(get_db)):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(500, "Google OAuth not configured")

    async with httpx.AsyncClient() as client:
        token_res = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": GOOGLE_REDIRECT_URI,
            },
        )
        if token_res.status_code != 200:
            raise HTTPException(400, "Failed to exchange Google code")
        token_data = token_res.json()
        access_token = token_data["access_token"]

        user_res = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if user_res.status_code != 200:
            raise HTTPException(400, "Failed to fetch Google user")
        google_user = user_res.json()

    oauth_id = google_user["id"]
    display_name = google_user.get("name", "GoogleUser")

    user = await _upsert_oauth_user(db, oauth_id, "google", display_name)
    return RedirectResponse(
        f"{FRONTEND_URL}?auth=google"
        f"&userId={user.id}"
        f"&username={user.username}"
        f"&displayName={user.display_name}"
        f"&color={user.avatar_color.replace('#','')}"
        f"&level={user.level}&xp={user.xp}&xpToNext={user.xp_to_next}"
        f"&wins={user.wins}&battles={user.battles}&mvps={user.mvps}"
    )


# ── HELPERS ─────────────────────────────────────────────────────────

async def _upsert_oauth_user(db: AsyncSession, oauth_id: str, auth_type: str, display_name: str) -> User:
    result = await db.execute(
        select(User).where(User.oauth_id == oauth_id, User.auth_type == auth_type)
    )
    user = result.scalar_one_or_none()
    if user:
        return user

    # Generate unique username from display_name
    base = display_name.replace(" ", "")[:16]
    username = base
    for _ in range(10):
        check = await db.execute(select(User).where(User.username == username))
        if not check.scalar_one_or_none():
            break
        username = f"{base}{random.randint(10, 999)}"

    user = User(
        id=str(uuid.uuid4()),
        username=username,
        display_name=display_name,
        auth_type=auth_type,
        oauth_id=oauth_id,
        avatar_color=random.choice(COLORS),
        xp_to_next=xp_to_next_level(1),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
