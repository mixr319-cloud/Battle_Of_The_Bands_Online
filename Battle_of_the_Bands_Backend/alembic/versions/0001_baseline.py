"""baseline schema (pre-premium): users, matches, match_players, audio_recordings

This revision documents the schema as it existed before the premium/social
feature set (Friendships, ChatMessage, and the premium/profile columns on
users). It is NOT meant to be `upgrade`d against a database that already has
these tables — that DB already matches this state. Instead:

    alembic stamp 0001_baseline

tells Alembic "this DB is already at 0001", without touching any data, so
that the next `alembic upgrade head` only applies 0002 (the actual ALTER
TABLE / CREATE TABLE work for the new premium/social additions).

A brand-new, empty database can instead just run `alembic upgrade head`
from scratch — it will create this baseline and then 0002 on top of it,
ending up at the same place.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-06-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0001_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("username", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("auth_type", sa.String(), nullable=False, server_default="guest"),
        sa.Column("oauth_id", sa.String(), nullable=True),
        sa.Column("avatar_color", sa.String(), nullable=False, server_default="#a855f7"),
        sa.Column("level", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("xp", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("xp_to_next", sa.Integer(), nullable=False, server_default="650"),
        sa.Column("wins", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("battles", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("mvps", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_index("ix_users_oauth_id", "users", ["oauth_id"], unique=False)

    op.create_table(
        "matches",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("status", sa.String(), nullable=False, server_default="waiting"),
        sa.Column("team_size", sa.Integer(), nullable=False, server_default="4"),
        sa.Column("genre", sa.String(), nullable=False, server_default="Hip-Hop"),
        sa.Column("battle_key_root", sa.String(), nullable=True),
        sa.Column("battle_key_mode", sa.String(), nullable=True),
        sa.Column("bpm", sa.Integer(), nullable=True, server_default="90"),
        sa.Column("winner_team", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "match_players",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("match_id", sa.String(), sa.ForeignKey("matches.id"), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("team_id", sa.String(), nullable=False),
        sa.Column("player_idx", sa.Integer(), nullable=False),
        sa.Column("has_recorded", sa.Boolean(), server_default=sa.false()),
        sa.Column("is_mvp", sa.Boolean(), server_default=sa.false()),
        sa.Column("xp_earned", sa.Integer(), server_default="0"),
    )
    op.create_index("ix_match_players_match_id", "match_players", ["match_id"])

    op.create_table(
        "audio_recordings",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("match_id", sa.String(), sa.ForeignKey("matches.id"), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("team_id", sa.String(), nullable=False),
        sa.Column("player_name", sa.String(), nullable=False),
        sa.Column("file_path", sa.String(), nullable=False),
        sa.Column("waveform_json", sa.String(), nullable=True),
        sa.Column("kept", sa.Boolean(), server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_audio_recordings_match_id", "audio_recordings", ["match_id"])


def downgrade() -> None:
    op.drop_table("audio_recordings")
    op.drop_table("match_players")
    op.drop_table("matches")
    op.drop_index("ix_users_oauth_id", table_name="users")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")
