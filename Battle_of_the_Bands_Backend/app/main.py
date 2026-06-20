from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import init_db
from app.routers import matches, ratings, uploads, users, oauth
import os

app = FastAPI(title="Battle of the Bands API")

# allow_credentials=True cannot be combined with a wildcard origin ("*") per
# the CORS spec — browsers will reject the response. List explicit origins
# instead; add FRONTEND_URL (used for OAuth redirects too) and your deployed
# domain via env vars as needed.
_default_origins = "http://localhost:5173,http://127.0.0.1:5173"
ALLOWED_ORIGINS = os.getenv("CORS_ALLOWED_ORIGINS", _default_origins).split(",")

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

@app.on_event("startup")
async def startup():
    await init_db()

@app.get("/")
def root():
    return {"message": "Battle of the Bands API is running"}
