"""Domain models for Work and Productivity."""

from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.db.session import Base


class Task(Base):
    """Represents a work or study task."""

    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(50), default="pending", nullable=False)  # pending, in_progress, completed
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    work_sessions = relationship("WorkSession", back_populates="task", cascade="all, delete-orphan")


class WorkSession(Base):
    """Represents a focused work or study session (Time Tracking)."""

    __tablename__ = "work_sessions"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    category = Column(String(100), default="general", nullable=False)  # work, konkoor, coding
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=True)
    summary = Column(Text, nullable=True)

    task = relationship("Task", back_populates="work_sessions")
