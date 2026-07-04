"""
Team-related SQLAlchemy models — aligned with actual DB schema.

Team.logo_url is used for an optional custom team picture.
If logo_url is NULL, the frontend shows the default static team picture.
"""

from sqlalchemy import Column, Integer, String, ForeignKey, Text
from database import Base


class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    description = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)
    created_by = Column(String, nullable=True)   # Supabase user UUID stored as text
    created_at = Column(String, nullable=True)
    updated_at = Column(String, nullable=True)


class TeamMember(Base):
    __tablename__ = "team_members"

    id = Column(Integer, primary_key=True, autoincrement=True)
    team_id = Column(Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, nullable=False)     # Supabase UUID → user_profiles.user_id
    role = Column(String(20), default="member")  # "leader" | "admin" | "member"
    joined_at = Column(String, nullable=True)


class TeamInvitation(Base):
    __tablename__ = "team_invitations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    team_id = Column(Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False)
    sender_id = Column(String, nullable=False)    # Supabase UUID
    receiver_id = Column(String, nullable=False)  # Supabase UUID
    role = Column(String, default="member")
    status = Column(String, default="pending")    # "pending" | "accepted" | "declined"
    created_at = Column(String, nullable=True)
    updated_at = Column(String, nullable=True)


class TeamJoinRequest(Base):
    __tablename__ = "team_join_requests"

    id = Column(Integer, primary_key=True, autoincrement=True)
    team_id = Column(Integer, nullable=False)
    user_id = Column(String, nullable=False)
    message = Column(Text, nullable=True)
    status = Column(String, default="pending")    # "pending" | "accepted" | "declined"
    created_at = Column(String, nullable=True)
    updated_at = Column(String, nullable=True)
