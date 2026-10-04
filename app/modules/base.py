"""Database models for Mehr Life Time system."""

from datetime import datetime
from typing import Optional
from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy declarative models."""
    pass


class User(Base):
    """Registered bot users and authorization status."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True, nullable=False)
    username: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    first_name: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    is_approved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class SleepLog(Base):
    """Sleep records containing duration and recovery quality metrics."""

    __tablename__ = "sleep_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    quality_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class NutritionLog(Base):
    """Meal tracking and caloric/macronutrient distribution."""

    __tablename__ = "nutrition_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    meal_type: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    calories: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    logged_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class WorkoutLog(Base):
    """Physical exercise, routines, and perceived exertion."""

    __tablename__ = "workout_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    workout_type: Mapped[str] = mapped_column(String(64), nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    intensity: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    logged_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class Task(Base):
    """Individual work tasks and commitments."""

    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    priority: Mapped[str] = mapped_column(String(16), default="medium", nullable=False)
    due_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    work_sessions: Mapped[list["WorkSession"]] = relationship("WorkSession", back_populates="task")


class WorkSession(Base):
    """Deep work and focused execution intervals."""

    __tablename__ = "work_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id"), nullable=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    duration_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    task: Mapped[Optional[Task]] = relationship("Task", back_populates="work_sessions")
