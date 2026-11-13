"""Tests for task management and work-session services."""

from collections.abc import Generator
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.modules.work.service import TaskService, WorkSessionService


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    """Provide an isolated in-memory database session for each test."""
    test_engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=test_engine)
    test_session_factory = sessionmaker(bind=test_engine, expire_on_commit=False)
    session = test_session_factory()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=test_engine)
        test_engine.dispose()


def test_task_lifecycle_is_scoped_to_owner(db_session: Session) -> None:
    """Create, prioritize, list, and complete a user's task safely."""
    service = TaskService(db_session)
    due_date = datetime(2026, 10, 12, 12, 0, tzinfo=timezone.utc)
    task = service.create_task(
        1001,
        "  Prepare weekly plan  ",
        priority="high",
        due_date=due_date,
    )

    assert task.title == "Prepare weekly plan"
    assert service.list_tasks(1001) == [task]
    assert service.list_tasks(2002) == []

    completed = service.complete_task(1001, task.id)

    assert completed.status == "completed"
    assert service.list_tasks(1001) == []
    assert service.list_tasks(1001, status="completed") == [completed]
    with pytest.raises(LookupError):
        service.complete_task(2002, task.id)


def test_task_input_validation(db_session: Session) -> None:
    """Reject blank titles and unsupported task priorities."""
    service = TaskService(db_session)

    with pytest.raises(ValueError, match="title"):
        service.create_task(1001, "   ")
    with pytest.raises(ValueError, match="Priority"):
        service.create_task(1001, "Write tests", priority="urgent")


def test_work_session_start_stop_and_summary(db_session: Session) -> None:
    """Track elapsed time, reject duplicate active sessions, and summarize it."""
    task_service = TaskService(db_session)
    task = task_service.create_task(1001, "Write tests")
    service = WorkSessionService(db_session)
    started_at = datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc)
    ended_at = started_at + timedelta(minutes=90)

    session = service.start_session(1001, task_id=task.id, started_at=started_at)
    assert session.task_id == task.id
    with pytest.raises(ValueError, match="already active"):
        service.start_session(1001, started_at=started_at)

    stopped = service.stop_session(
        1001,
        ended_at=ended_at,
        summary="  Focused work  ",
    )
    assert stopped.duration_minutes == 90
    assert stopped.summary == "Focused work"

    summary = service.get_summary(
        1001,
        started_at,
        until=ended_at,
    )
    assert summary.total_minutes == 90
    assert summary.session_count == 1
    assert summary.active_session_count == 0
    assert summary.pending_task_count == 1


def test_active_session_is_included_in_summary(db_session: Session) -> None:
    """Include the elapsed portion of an active session in a time report."""
    service = WorkSessionService(db_session)
    started_at = datetime(2026, 10, 10, 10, 0, tzinfo=timezone.utc)
    until = started_at + timedelta(minutes=45)
    service.start_session(1001, started_at=started_at)

    summary = service.get_summary(1001, started_at, until=until)

    assert summary.total_minutes == 45
    assert summary.session_count == 1
    assert summary.active_session_count == 1


def test_work_session_rejects_invalid_end_time(db_session: Session) -> None:
    """Keep a work session active when its requested end precedes its start."""
    service = WorkSessionService(db_session)
    started_at = datetime(2026, 10, 10, 10, 0, tzinfo=timezone.utc)
    service.start_session(1001, started_at=started_at)

    with pytest.raises(ValueError, match="after"):
        service.stop_session(1001, ended_at=started_at)

    assert service.get_active_session(1001) is not None
