"""Persistent models for each user's private life-planning workspace."""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index
from sqlalchemy import Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class UserConsent(Base):
    """Explicit acceptance of AI personalization and data-use terms."""

    __tablename__ = "user_consents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True
    )
    accepted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    terms_version: Mapped[str] = mapped_column(String(32), nullable=False)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class TelegramWorkspace(Base):
    """Per-user Telegram supergroup created by the service account."""

    __tablename__ = "telegram_workspaces"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True
    )
    chat_id: Mapped[Optional[int]] = mapped_column(BigInteger, unique=True)
    invite_link: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="creating")
    bot_added: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    user_joined: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    activated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class LifeArea(Base):
    """A detected domain such as work, university, or exercise."""

    __tablename__ = "life_areas"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_life_area_user_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    topic_id: Mapped[Optional[int]] = mapped_column(Integer)
    details: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    intake_status: Mapped[str] = mapped_column(String(32), nullable=False, default="new")
    is_project: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )


class Goal(Base):
    """A goal with a user-defined deadline and area-specific task plan."""

    __tablename__ = "planning_goals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    life_area_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("life_areas.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    deadline: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    tasks: Mapped[list["PlannedTask"]] = relationship(
        "PlannedTask", back_populates="goal", cascade="all, delete-orphan"
    )


class PlannedTask(Base):
    """A schedulable task created from user input or AI goal breakdown."""

    __tablename__ = "planned_tasks"
    __table_args__ = (
        Index("ix_planned_tasks_user_status_schedule", "user_id", "status", "scheduled_start"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    life_area_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("life_areas.id", ondelete="SET NULL"), index=True
    )
    goal_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("planning_goals.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    estimated_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    scheduled_start: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    scheduled_end: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    reminder_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    start_notified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    completion_message_id: Mapped[Optional[int]] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )
    goal: Mapped[Optional[Goal]] = relationship("Goal", back_populates="tasks")
    time_logs: Mapped[list["TaskTimeLog"]] = relationship(
        "TaskTimeLog", back_populates="task", cascade="all, delete-orphan"
    )


class TaskTimeLog(Base):
    """Actual work intervals used to personalize future duration estimates."""

    __tablename__ = "task_time_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    task_id: Mapped[int] = mapped_column(
        ForeignKey("planned_tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    duration_minutes: Mapped[Optional[int]] = mapped_column(Integer)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    task: Mapped[PlannedTask] = relationship("PlannedTask", back_populates="time_logs")


class UserMemory(Base):
    """Consent-gated planning facts and per-user time-estimation patterns."""

    __tablename__ = "user_memories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True
    )
    facts: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )


class ConversationState(Base):
    """Durable state for onboarding and multi-step bot menu conversations."""

    __tablename__ = "conversation_states"
    __table_args__ = (UniqueConstraint("user_id", "scope", name="uq_conversation_user_scope"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scope: Mapped[str] = mapped_column(String(96), nullable=False)
    flow: Mapped[str] = mapped_column(String(32), nullable=False)
    payload: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )
