from sqlalchemy import Column, String, Integer, Float, DateTime, ForeignKey, Boolean, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import uuid

def new_uuid():
    return str(uuid.uuid4())

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=new_uuid)
    username = Column(String, unique=True, nullable=False, index=True)
    display_name = Column(String, nullable=False)
    auth_type = Column(String, nullable=False, default="guest")  # guest | discord | google
    oauth_id = Column(String, nullable=True, index=True)         # Discord/Google sub ID
    avatar_color = Column(String, nullable=False, default="#a855f7")

    # Premium fields
    is_premium = Column(Boolean, nullable=False, default=False)
    stripe_customer_id = Column(String, nullable=True, unique=True)
    stripe_subscription_id = Column(String, nullable=True, unique=True)
    premium_expires_at = Column(DateTime(timezone=True), nullable=True)

    # Premium profile fields
    avatar_url = Column(String, nullable=True)          # custom profile pic URL
    tiktok_handle = Column(String, nullable=True)       # @handle without @
    instagram_handle = Column(String, nullable=True)    # @handle without @
    bio = Column(String(280), nullable=True)

    level = Column(Integer, nullable=False, default=1)
    xp = Column(Integer, nullable=False, default=0)
    xp_to_next = Column(Integer, nullable=False, default=650)
    wins = Column(Integer, nullable=False, default=0)
    battles = Column(Integer, nullable=False, default=0)
    mvps = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    match_players = relationship("MatchPlayer", back_populates="user")
    friends_sent = relationship("Friendship", foreign_keys="Friendship.requester_id", back_populates="requester")
    friends_received = relationship("Friendship", foreign_keys="Friendship.addressee_id", back_populates="addressee")
    chat_messages = relationship("ChatMessage", back_populates="user")


class Friendship(Base):
    """Premium-only friend connections between users."""
    __tablename__ = "friendships"

    id = Column(String, primary_key=True, default=new_uuid)
    requester_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    addressee_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    status = Column(String, nullable=False, default="pending")  # pending | accepted | blocked
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    requester = relationship("User", foreign_keys=[requester_id], back_populates="friends_sent")
    addressee = relationship("User", foreign_keys=[addressee_id], back_populates="friends_received")


class ChatMessage(Base):
    """In-game chat messages — premium only."""
    __tablename__ = "chat_messages"

    id = Column(String, primary_key=True, default=new_uuid)
    match_id = Column(String, ForeignKey("matches.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="chat_messages")
    match = relationship("Match", back_populates="chat_messages")


class Match(Base):
    __tablename__ = "matches"

    id = Column(String, primary_key=True, default=new_uuid)
    status = Column(String, nullable=False, default="waiting")  # waiting | in_progress | voting | done
    team_size = Column(Integer, nullable=False, default=4)
    genre = Column(String, nullable=False, default="Hip-Hop")
    battle_key_root = Column(String, nullable=True)
    battle_key_mode = Column(String, nullable=True)
    bpm = Column(Integer, nullable=True, default=90)
    winner_team = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    players = relationship("MatchPlayer", back_populates="match")
    recordings = relationship("AudioRecording", back_populates="match")
    chat_messages = relationship("ChatMessage", back_populates="match")


class MatchPlayer(Base):
    __tablename__ = "match_players"

    id = Column(String, primary_key=True, default=new_uuid)
    match_id = Column(String, ForeignKey("matches.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    team_id = Column(String, nullable=False)   # "A" or "B"
    player_idx = Column(Integer, nullable=False)
    has_recorded = Column(Boolean, default=False)
    is_mvp = Column(Boolean, default=False)
    xp_earned = Column(Integer, default=0)

    match = relationship("Match", back_populates="players")
    user = relationship("User", back_populates="match_players")


class AudioRecording(Base):
    __tablename__ = "audio_recordings"

    id = Column(String, primary_key=True, default=new_uuid)
    match_id = Column(String, ForeignKey("matches.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    team_id = Column(String, nullable=False)
    player_name = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    waveform_json = Column(String, nullable=True)
    kept = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    match = relationship("Match", back_populates="recordings")
