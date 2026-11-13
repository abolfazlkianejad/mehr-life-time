"""Database creation and model CRUD unit tests."""

from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

# Import all models to ensure complete SQLAlchemy mapper registry configuration
import app.db.base  # noqa: F401
from app.db.base import Base
from app.modules.lifestyle.models import SleepLog
from app.modules.work.models import Task, WorkSession


@pytest.fixture
def db_session() -> Session:
    """Create an isolated in-memory SQLite database for testing."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    testing_session_local = sessionmaker(
        bind=engine,
        autocommit=False,
        autoflush=False,
    )

    Base.metadata.create_all(bind=engine)
    session = testing_session_local()

    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_create_task_and_work_session(db_session: Session) -> None:
    """Verify task creation and related work-session logging."""
    telegram_id = 123456789

    task = Task(
        telegram_id=telegram_id,
        title="Study AI Konkoor",
        description="Linear Algebra Review",
    )
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)

    now = datetime.now(timezone.utc)
    session_log = WorkSession(
        telegram_id=telegram_id,
        task_id=task.id,
        start_time=now,
        summary="konkoor",
    )
    db_session.add(session_log)
    db_session.commit()

    retrieved = (
        db_session.query(Task)
        .filter_by(title="Study AI Konkoor")
        .first()
    )

    assert retrieved is not None
    assert len(retrieved.work_sessions) == 1
    assert retrieved.work_sessions[0].summary == "konkoor"
    assert retrieved.work_sessions[0].telegram_id == telegram_id


def test_create_sleep_log(db_session: Session) -> None:
    """Verify creation of a sleep-log entry."""
    start = datetime(2026, 10, 1, 23, 0, tzinfo=timezone.utc)
    end = datetime(2026, 10, 2, 7, 0, tzinfo=timezone.utc)

    sleep_entry = SleepLog(
        telegram_id=123456789,
        start_time=start,
        end_time=end,
        duration_hours=8.0,
        quality_score=9,
    )
    db_session.add(sleep_entry)
    db_session.commit()

    saved_entry = db_session.query(SleepLog).first()

    assert saved_entry is not None
    assert saved_entry.telegram_id == 123456789
    assert saved_entry.duration_hours == 8.0
    assert saved_entry.quality_score == 9
