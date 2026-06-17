from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import init_db
from app.routers import matches, ratings, uploads, users, oauth

app = FastAPI(title="Battle of the Bands API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten to your frontend domain in production
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
