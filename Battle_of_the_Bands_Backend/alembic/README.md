# Database migrations

This backend now has Alembic wired up alongside the existing `init_db()` /
`create_all()` startup hook. They serve different cases:

- **`create_all()` (runs automatically on startup, unchanged)** — picks up
  brand-new tables (e.g. a future model you add) automatically. It never
  touches a table that already exists, so it will **not** add new columns
  to `users` if that table is already in the database.
- **Alembic (`alembic/`, new)** — handles the case `create_all()` can't:
  altering an existing table. Use it any time you add/rename/drop a column
  on a table that may already have rows in production.

## Fresh database (new dev machine, new deploy, CI)

Nothing to do — just run the app as before. `create_all()` builds every
table from the current models, including `is_premium`, `avatar_url`,
`friendships`, `chat_messages`, etc. Alembic isn't required in this path.

If you'd rather provision the schema through Alembic instead (e.g. you want
the DB to carry an Alembic version stamp from day one):

```bash
cd Battle_of_the_Bands_Backend
alembic upgrade head
```

## Existing database (already deployed before the premium/social features)

This is the case the task description calls out: `users` already exists
with rows in it, so the new premium/profile columns need a real
`ALTER TABLE`, not `create_all()`. Steps:

```bash
cd Battle_of_the_Bands_Backend

# Tell Alembic "this DB already matches the pre-premium schema" without
# touching any data:
alembic stamp 0001_baseline

# Now apply the real migration: adds the new users columns
# (is_premium, stripe_*, premium_expires_at, avatar_url, tiktok_handle,
# instagram_handle, bio) and creates the friendships / chat_messages tables.
alembic upgrade head
```

After this, `is_premium` defaults to `false` and the rest of the new columns
are `NULL` for every pre-existing user — no data loss, no downtime.

## Day-to-day usage going forward

Once a DB is stamped/migrated to `head`, treat Alembic as the source of
truth for schema changes:

```bash
# after editing app/models.py
alembic revision --autogenerate -m "short description"
# review the generated file in alembic/versions/, then
alembic upgrade head
```

`DATABASE_URL` (same env var `app/database.py` reads) controls which
database Alembic targets — it falls back to the same backend-root-anchored
`botb.db` SQLite file used by the app, so `alembic upgrade head` always
points at the same DB the server will read from.
