"""Database models for the AI onboarding flow."""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, User


class OnboardingSession(Base):
    """Tracks the state of a user's AI-driven onboarding conversation."""

    __tablename__ = "onboarding_sessions"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String(32),
        default="active",
        nullable=False,
    )
    current_stage: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
    )
    last_topic: Mapped[Optional[str]] = mapped_column(
        String(128),
        nullable=True,
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    messages: Mapped[list["OnboardingMessage"]] = relationship(
        "OnboardingMessage",
        back_populates="session",
        cascade="all, delete-orphan",
    )
    user: Mapped["User"] = relationship(
        "User",
    )


class OnboardingMessage(Base):
    """Stores individual messages exchanged during onboarding."""

    __tablename__ = "onboarding_messages"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    session_id: Mapped[int] = mapped_column(
        ForeignKey("onboarding_sessions.id"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
    )
    content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    session: Mapped["OnboardingSession"] = relationship(
        "OnboardingSession",
        back_populates="messages",
    )
