"""Tests for sleep, nutrition, workout, and recovery services."""

from collections.abc import Generator
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.modules.lifestyle.service import LifestyleService


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


def test_lifestyle_records_are_saved_for_the_owner(db_session: Session) -> None:
    """Persist all lifestyle record types and aggregate them by time range."""
    service = LifestyleService(db_session)
    logged_at = datetime(2026, 10, 10, 7, 0, tzinfo=timezone.utc)

    sleep = service.record_sleep(
        1001,
        8,
        quality_score=8,
        logged_at=logged_at,
        notes="Rested well",
    )
    meal = service.record_meal(
        1001,
        "breakfast",
        "Oatmeal and fruit",
        calories=550,
        logged_at=logged_at,
    )
    workout = service.record_workout(
        1001,
        "run",
        30,
        intensity="MODERATE",
        logged_at=logged_at,
    )
    recovery = service.record_recovery(
        1001,
        "stretching",
        duration_minutes=15,
        quality_score=7,
        logged_at=logged_at,
    )

    assert sleep.duration_hours == 8
    assert meal.calories == 550
    assert workout.intensity == "moderate"
    assert recovery.duration_minutes == 15

    summary = service.get_summary(
        1001,
        datetime(2026, 10, 9, 22, 0, tzinfo=timezone.utc),
        until=datetime(2026, 10, 10, 8, 0, tzinfo=timezone.utc),
    )
    assert summary.sleep_hours == 8
    assert summary.meal_count == 1
    assert summary.calorie_total == 550
    assert summary.workout_count == 1
    assert summary.workout_minutes == 30
    assert summary.recovery_count == 1
    assert summary.recovery_minutes == 15

    other_user_summary = service.get_summary(
        2002,
        datetime(2026, 10, 9, 22, 0, tzinfo=timezone.utc),
        until=datetime(2026, 10, 10, 8, 0, tzinfo=timezone.utc),
    )
    assert other_user_summary.meal_count == 0
    assert other_user_summary.calorie_total is None


@pytest.mark.parametrize("duration_hours", [0, -1, 24.1])
def test_sleep_duration_is_validated(
    db_session: Session,
    duration_hours: float,
) -> None:
    """Reject zero, negative, and overlong sleep durations."""
    with pytest.raises(ValueError, match="Sleep duration"):
        LifestyleService(db_session).record_sleep(1001, duration_hours)


def test_lifestyle_quality_and_duration_ranges_are_validated(
    db_session: Session,
) -> None:
    """Reject invalid quality scores, calories, intensities, and durations."""
    service = LifestyleService(db_session)

    with pytest.raises(ValueError, match="Quality score"):
        service.record_sleep(1001, 7, quality_score=11)
    with pytest.raises(ValueError, match="Calories"):
        service.record_meal(1001, "lunch", "Soup", calories=-1)
    with pytest.raises(ValueError, match="Intensity"):
        service.record_workout(1001, "run", 30, intensity="extreme")
    with pytest.raises(ValueError, match="Recovery duration"):
        service.record_recovery(1001, "sauna", duration_minutes=0)
