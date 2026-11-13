"""Database models for Mehr Life Time."""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey
from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy declarative models."""


class User(Base):
    """Registered Telegram users and authorization status."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    telegram_id: Mapped[int] = mapped_column(
        BigInteger,
        unique=True,
        index=True,
        nullable=False,
    )
    username: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
    )
    full_name: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )
    role: Mapped[str] = mapped_column(
        String(50),
        default="user",
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    profile: Mapped[Optional["UserProfile"]] = relationship(
        "UserProfile",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )


class UserProfile(Base):
    """Stores the personal profile collected during AI onboarding."""

    __tablename__ = "user_profiles"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        unique=True,
        nullable=False,
        index=True,
    )
    occupation: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )
    education: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )
    work_schedule: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )
    sleep_schedule: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )
    lifestyle_summary: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    preferences: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    constraints: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    user: Mapped["User"] = relationship(
        "User",
        back_populates="profile",
    )


class SleepLog(Base):
    """Sleep records containing duration and recovery quality."""

    __tablename__ = "sleep_logs"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    telegram_id: Mapped[int] = mapped_column(
        BigInteger,
        index=True,
        nullable=False,
    )
    start_time: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
    )
    end_time: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
    )
    duration_hours: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
    )
    quality_score: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )
    notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class NutritionLog(Base):
    """Meal and nutrition records."""

    __tablename__ = "nutrition_logs"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    telegram_id: Mapped[int] = mapped_column(
        BigInteger,
        index=True,
        nullable=False,
    )
    meal_type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
    )
    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    calories: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )
    logged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class WorkoutLog(Base):
    """Physical exercise and workout records."""

    __tablename__ = "workout_logs"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    telegram_id: Mapped[int] = mapped_column(
        BigInteger,
        index=True,
        nullable=False,
    )
    workout_type: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )
    duration_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    intensity: Mapped[Optional[str]] = mapped_column(
        String(32),
        nullable=True,
    )
    notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    logged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class RecoveryLog(Base):
    """Recovery practices and quality records."""

    __tablename__ = "recovery_logs"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    telegram_id: Mapped[int] = mapped_column(
        BigInteger,
        index=True,
        nullable=False,
    )
    recovery_type: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )
    duration_minutes: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )
    quality_score: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )
    notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    logged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class Task(Base):
    """Individual work, study, or personal tasks."""

    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    telegram_id: Mapped[int] = mapped_column(
        BigInteger,
        index=True,
        nullable=False,
    )
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String(32),
        default="pending",
        nullable=False,
    )
    priority: Mapped[str] = mapped_column(
        String(16),
        default="medium",
        nullable=False,
    )
    due_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    work_sessions: Mapped[list["WorkSession"]] = relationship(
        "WorkSession",
        back_populates="task",
        cascade="all, delete-orphan",
    )


class WorkSession(Base):
    """Focused execution and time-tracking sessions."""

    __tablename__ = "work_sessions"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    telegram_id: Mapped[int] = mapped_column(
        BigInteger,
        index=True,
        nullable=False,
    )
    task_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("tasks.id"),
        nullable=True,
    )
    start_time: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
    )
    end_time: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
    )
    duration_minutes: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )
    summary: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    task: Mapped[Optional["Task"]] = relationship(
        "Task",
        back_populates="work_sessions",
    )
