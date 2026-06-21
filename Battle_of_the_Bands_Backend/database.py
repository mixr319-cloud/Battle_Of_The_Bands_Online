from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import DeclarativeBase, sessionmaker
import os

# Anchor the default SQLite file to this file's directory (the backend root),
# not the process's current working directory. If the server is launched
# from a different cwd (Docker WORKDIR, systemd unit, process manager, a
# different terminal tab, etc.), "./botb.db" silently resolves to a NEW,
# empty database file in that directory — every existing user row (and all
# their XP) appears to vanish even though nothing was actually deleted.
# Set DATABASE_URL explicitly in production (e.g. Postgres) to override this.
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DEFAULT_SQLITE_PATH = os.path.join(_BACKEND_ROOT, "botb.db")
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite+aiosqlite:///{_DEFAULT_SQLITE_PATH}")

engine = create_async_engine(DATABASE_URL, echo=False, pool_pre_ping=True)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
