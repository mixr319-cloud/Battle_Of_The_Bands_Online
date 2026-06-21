"""add premium fields to users + friendships/chat_messages tables

This is the migration that matters for already-deployed databases: it adds
the new premium and social-profile columns to the existing `users` table via
ALTER TABLE (create_all() never touches existing tables, so without this,
old rows would 500 on any code path that reads is_premium / avatar_url /
etc.), and creates the two brand-new tables (`friendships`, `chat_messages`)
that create_all() *would* pick up on its own.

Revision ID: 0002_add_premium_and_social
Revises: 0001_baseline
Create Date: 2026-06-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0002_add_premium_and_social"
down_revision: Union[str, None] = "0001_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- New columns on the existing users table -----------------------
    # Added as nullable / with a server_default so the ALTER TABLE is safe
    # against rows that already exist (SQLite and Postgres both handle a
    # plain ADD COLUMN like this without a table rewrite or downtime).
    op.add_column("users", sa.Column("is_premium", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("stripe_customer_id", sa.String(), nullable=True))
    op.add_column("users", sa.Column("stripe_subscription_id", sa.String(), nullable=True))
    op.add_column("users", sa.Column("premium_expires_at", sa.DateTime(timezone=True), nullable=True))

    op.add_column("users", sa.Column("avatar_url", sa.String(), nullable=True))
    op.add_column("users", sa.Column("tiktok_handle", sa.String(), nullable=True))
    op.add_column("users", sa.Column("instagram_handle", sa.String(), nullable=True))
    op.add_column("users", sa.Column("bio", sa.String(length=280), nullable=True))

    # Unique constraints are added as separate indexes rather than inline on
    # add_column: SQLite can't add a UNIQUE constraint via ALTER TABLE ADD
    # COLUMN, but CREATE UNIQUE INDEX works fine afterward, and on a column
    # full of NULLs (every pre-existing row) that's a no-op until populated.
    op.create_index("ix_users_stripe_customer_id", "users", ["stripe_customer_id"], unique=True)
    op.create_index("ix_users_stripe_subscription_id", "users", ["stripe_subscription_id"], unique=True)

    # --- New tables ------------------------------------------------------
    op.create_table(
        "friendships",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("requester_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("addressee_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_friendships_requester_id", "friendships", ["requester_id"])
    op.create_index("ix_friendships_addressee_id", "friendships", ["addressee_id"])

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("match_id", sa.String(), sa.ForeignKey("matches.id"), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_chat_messages_match_id", "chat_messages", ["match_id"])


def downgrade() -> None:
    op.drop_table("chat_messages")
    op.drop_table("friendships")

    op.drop_index("ix_users_stripe_subscription_id", table_name="users")
    op.drop_index("ix_users_stripe_customer_id", table_name="users")

    op.drop_column("users", "bio")
    op.drop_column("users", "instagram_handle")
    op.drop_column("users", "tiktok_handle")
    op.drop_column("users", "avatar_url")

    op.drop_column("users", "premium_expires_at")
    op.drop_column("users", "stripe_subscription_id")
    op.drop_column("users", "stripe_customer_id")
    op.drop_column("users", "is_premium")
