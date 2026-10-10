"""Business services for tasks and work-time tracking."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import case, func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.base import Task, WorkSession
from app.core.time_utils import as_utc, to_database_datetime


TASK_STATUSES = frozenset({"pending", "completed", "cancelled"})
TASK_PRIORITIES = frozenset({"low", "medium", "high"})


def _commit(db: Session) -> None:
    """Commit a unit of work and restore the session after database errors."""
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise


class TaskService:
    """Create, list, and complete tasks belonging to a Telegram user."""

    def __init__(self, db: Session) -> None:
        """Initialize the service with a database session."""
        self._db = db

    def create_task(
        self,
        telegram_id: int,
        title: str,
        *,
        description: str | None = None,
        priority: str = "medium",
        due_date: datetime | None = None,
    ) -> Task:
        """Create and persist a validated task for a Telegram user."""
        normalized_title = title.strip()
        if not normalized_title:
            raise ValueError("Task title cannot be empty.")
        if len(normalized_title) > 255:
            raise ValueError("Task title cannot exceed 255 characters.")
        if priority not in TASK_PRIORITIES:
            raise ValueError("Priority must be low, medium, or high.")

        task = Task(
            telegram_id=telegram_id,
            title=normalized_title,
            description=description.strip() if description else None,
            priority=priority,
            due_date=to_database_datetime(due_date) if due_date else None,
        )
        self._db.add(task)
        _commit(self._db)
        self._db.refresh(task)
        return task

    def list_tasks(
        self,
        telegram_id: int,
        *,
        status: str | None = "pending",
    ) -> list[Task]:
        """List a user's tasks, ordered by priority and due date."""
        if status is not None and status not in TASK_STATUSES:
            raise ValueError("Status must be pending, completed, or cancelled.")

        priority_order = case(
            (Task.priority == "high", 0),
            (Task.priority == "medium", 1),
            else_=2,
        )
        due_date_order = case((Task.due_date.is_(None), 1), else_=0)
        query = self._db.query(Task).filter(Task.telegram_id == telegram_id)
        if status is not None:
            query = query.filter(Task.status == status)
        return query.order_by(
            priority_order,
            due_date_order,
            Task.due_date.asc(),
            Task.created_at.asc(),
        ).all()

    def complete_task(self, telegram_id: int, task_id: int) -> Task:
        """Mark one of the user's pending tasks as completed."""
        task = (
            self._db.query(Task)
            .filter(Task.id == task_id, Task.telegram_id == telegram_id)
            .first()
        )
        if task is None:
            raise LookupError("Task was not found for this user.")
        if task.status != "pending":
            raise ValueError("Only pending tasks can be completed.")

        task.status = "completed"
        _commit(self._db)
        self._db.refresh(task)
        return task


@dataclass(frozen=True, slots=True)
class WorkSummary:
    """Work-time totals and task counts for a requested UTC interval."""

    since: datetime
    until: datetime
    total_minutes: int
    session_count: int
    active_session_count: int
    pending_task_count: int


class WorkSessionService:
    """Start, stop, and summarize a user's focused work sessions."""

    def __init__(self, db: Session) -> None:
        """Initialize the service with a database session."""
        self._db = db

    def get_active_session(self, telegram_id: int) -> WorkSession | None:
        """Return the user's active session, if one exists."""
        return (
            self._db.query(WorkSession)
            .filter(
                WorkSession.telegram_id == telegram_id,
                WorkSession.end_time.is_(None),
            )
            .order_by(WorkSession.start_time.desc())
            .first()
        )

    def start_session(
        self,
        telegram_id: int,
        *,
        task_id: int | None = None,
        started_at: datetime | None = None,
    ) -> WorkSession:
        """Start a work session if the user has no active session."""
        if self.get_active_session(telegram_id) is not None:
            raise ValueError("A work session is already active.")

        task: Task | None = None
        if task_id is not None:
            task = (
                self._db.query(Task)
                .filter(Task.id == task_id, Task.telegram_id == telegram_id)
                .first()
            )
            if task is None:
                raise LookupError("Task was not found for this user.")
            if task.status != "pending":
                raise ValueError("A session can only be linked to a pending task.")

        session = WorkSession(
            telegram_id=telegram_id,
            task_id=task.id if task else None,
            start_time=to_database_datetime(started_at or datetime.now(timezone.utc)),
        )
        self._db.add(session)
        _commit(self._db)
        self._db.refresh(session)
        return session

    def stop_session(
        self,
        telegram_id: int,
        *,
        ended_at: datetime | None = None,
        summary: str | None = None,
    ) -> WorkSession:
        """Stop the user's active session and store its elapsed minutes."""
        session = self.get_active_session(telegram_id)
        if session is None:
            raise LookupError("No active work session was found.")

        end_time = as_utc(ended_at or datetime.now(timezone.utc))
        start_time = as_utc(session.start_time)
        elapsed_seconds = (end_time - start_time).total_seconds()
        if elapsed_seconds <= 0:
            raise ValueError("End time must be after the session start time.")

        session.end_time = end_time.replace(tzinfo=None)
        session.duration_minutes = max(1, round(elapsed_seconds / 60))
        if summary is not None:
            normalized_summary = summary.strip()
            session.summary = normalized_summary or None

        _commit(self._db)
        self._db.refresh(session)
        return session

    def get_summary(
        self,
        telegram_id: int,
        since: datetime,
        *,
        until: datetime | None = None,
    ) -> WorkSummary:
        """Calculate overlapping work time and current task counts."""
        start = as_utc(since)
        end = as_utc(until or datetime.now(timezone.utc))
        if end <= start:
            raise ValueError("The summary end time must be after its start time.")

        start_db = start.replace(tzinfo=None)
        end_db = end.replace(tzinfo=None)
        sessions = (
            self._db.query(WorkSession)
            .filter(
                WorkSession.telegram_id == telegram_id,
                WorkSession.start_time < end_db,
                (WorkSession.end_time.is_(None) | (WorkSession.end_time > start_db)),
            )
            .all()
        )

        total_seconds = 0.0
        active_session_count = 0
        for session in sessions:
            session_start = max(as_utc(session.start_time), start)
            if session.end_time is None:
                active_session_count += 1
                session_end = end
            else:
                session_end = min(as_utc(session.end_time), end)
            total_seconds += max(0.0, (session_end - session_start).total_seconds())

        pending_task_count = (
            self._db.query(func.count(Task.id))
            .filter(Task.telegram_id == telegram_id, Task.status == "pending")
            .scalar()
            or 0
        )
        return WorkSummary(
            since=start,
            until=end,
            total_minutes=round(total_seconds / 60),
            session_count=len(sessions),
            active_session_count=active_session_count,
            pending_task_count=int(pending_task_count),
        )
