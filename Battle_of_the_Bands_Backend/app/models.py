from sqlalchemy import Column, String, Integer, Float, DateTime, ForeignKey, Boolean
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

    level = Column(Integer, nullable=False, default=1)
    xp = Column(Integer, nullable=False, default=0)
    xp_to_next = Column(Integer, nullable=False, default=650)
    wins = Column(Integer, nullable=False, default=0)
    battles = Column(Integer, nullable=False, default=0)
    mvps = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    match_players = relationship("MatchPlayer", back_populates="user")


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
