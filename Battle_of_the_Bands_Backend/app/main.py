from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import init_db
from app.routers import matches, ratings, uploads, users, oauth, premium, profiles
from app.services.matchmaking import room_cleanup_loop
import asyncio
import os

app = FastAPI(title="Battle of the Bands API")

_default_origins = "http://localhost:5173,http://127.0.0.1:5173"
ALLOWED_ORIGINS = os.getenv("CORS_ALLOWED_ORIGINS", _default_origins).split(",")
print(f"[startup] CORS_ALLOWED_ORIGINS env var = {os.getenv('CORS_ALLOWED_ORIGINS')!r}")
print(f"[startup] Resolved ALLOWED_ORIGINS = {ALLOWED_ORIGINS!r}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router)
app.include_router(matches.router)
app.include_router(uploads.router)
app.include_router(ratings.router)
app.include_router(oauth.router)
app.include_router(premium.router)
app.include_router(profiles.router)

@app.on_event("startup")
async def startup():
    await init_db()
    asyncio.create_task(room_cleanup_loop())

@app.get("/")
def root():
    return {"message": "Battle of the Bands API is running"}
