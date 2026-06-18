
#ts assssssss


# Battle of the Bands — Online Multiplayer Setup Guide

## What was changed

### Backend (Battle_of_the_Bands_Backend/)
- **database.py** — SQLite (dev) / PostgreSQL (prod) with SQLAlchemy async
- **models.py** — User, Match, MatchPlayer, AudioRecording tables
- **routers/users.py** — Guest + OAuth user registration/lookup
- **routers/oauth.py** — Real Discord & Google OAuth2 flows
- **routers/matches.py** — WebSocket endpoint for real-time matchmaking & gameplay
- **routers/uploads.py** — Audio file upload/serve
- **routers/ratings.py** — Vote submission + XP award
- **services/matchmaking.py** — In-memory match rooms, turn management, NPC auto-play
- **services/xp_system.py** — XP/level math

### Frontend (src/)
- **hooks/useGameSocket.ts** — WebSocket client + HTTP API helpers
- **hooks/useProfile.ts** — Profile now backed by real database
- **components/AuthModal.tsx** — Discord/Google buttons now do real OAuth redirects
- **components/FindingScreen.tsx** — Joins real matchmaking queue via WebSocket
- **App.tsx** — Fully driven by server WebSocket messages; only the local player sees the recording modal on their turn

---

## Step 1: Backend Setup

```bash
cd Battle_of_the_Bands_Backend

# Install dependencies
pip install -r requirements.txt

# Copy and fill in your .env
cp .env.example .env

# Run the server (creates botb.db automatically)
uvicorn app.main:app --reload --port 8000
```

---

## Step 2: Discord OAuth (to make the Discord button work)

1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it "Battle of the Bands"
3. Go to **OAuth2** tab → **Redirects** → Add: `http://localhost:8000/auth/discord/callback`
4. Copy **Client ID** and **Client Secret**
5. In your `Battle_of_the_Bands_Backend/.env`:
   ```
   DISCORD_CLIENT_ID=your_client_id_here
   DISCORD_CLIENT_SECRET=your_client_secret_here
   DISCORD_REDIRECT_URI=http://localhost:8000/auth/discord/callback
   ```

---

## Step 3: Google OAuth (to make the Google button work)

1. Go to https://console.cloud.google.com
2. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Authorized redirect URIs: `http://localhost:8000/auth/google/callback`
5. Copy **Client ID** and **Client Secret**
6. In your `Battle_of_the_Bands_Backend/.env`:
   ```
   GOOGLE_CLIENT_ID=your_client_id_here
   GOOGLE_CLIENT_SECRET=your_client_secret_here
   GOOGLE_REDIRECT_URI=http://localhost:8000/auth/google/callback
   ```

---

## Step 4: Frontend Setup

```bash
# In the project root (where package.json is)
cp .env.example .env
# .env already has the right localhost URLs for dev

pnpm install
pnpm dev
```

Open http://localhost:5173 — the app now talks to your backend.

---

## Step 5: Test Online Multiplayer

Open **two browser tabs** (or two different browsers/devices on the same network):
- Both tabs log in (guest is fine)
- Both click **Find Match** with the same team size and genre
- They'll be matched together in real time!
- When it's your turn, only your tab shows the recording modal
- Other players see "X is recording..."

For cross-network play, you need to deploy the backend (see below).

---

## Deploying for Real Online Play

### Option A: Railway (easiest)
1. Push your repo to GitHub
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Select the `Battle_of_the_Bands_Backend` folder as the root
4. Add your env vars in Railway's dashboard
5. Update `VITE_API_URL` and `VITE_WS_URL` in your frontend `.env` to the Railway URL
6. Change `ws://` to `wss://` and `http://` to `https://` for production

### Option B: Render
1. New Web Service → connect your repo
2. Root Directory: `Battle_of_the_Bands_Backend`
3. Build Command: `pip install -r requirements.txt`
4. Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Add env vars, update frontend URLs

### For production: use PostgreSQL
Change your `DATABASE_URL` in .env:
```
DATABASE_URL=postgresql+asyncpg://user:password@host/dbname
```
Both Railway and Render offer free PostgreSQL add-ons.

---

## How the multiplayer works

```
Player A browser          Backend WebSocket Server         Player B browser
     |                           |                               |
     |--- join_queue ----------->|<---------- join_queue --------|
     |                           |                               |
     |<-- queued (1/8) ----------|------------ queued (2/8) --->|
     |                           |  (after timeout, fills NPCs)  |
     |<====== game_start ========|========= game_start =========|
     |                           |                               |
     | [Turn: Player A]          |                               |
     | shows RecordingModal      |      shows "A is recording"   |
     |--- recording_done ------->|                               |
     |<===== turn_advance =======|======== turn_advance ========|
     |                           |                               |
     | [Turn: Player B]          |                               |
     | shows "B is recording"    |      shows RecordingModal     |
     |                           |<-------- recording_done ------|
     |<====== turn_advance =======|======= turn_advance ========|
     |          ...              |              ...              |
     |<====== voting_start =======|====== voting_start =========|
     |<====== results =============|====== results =============|
```
