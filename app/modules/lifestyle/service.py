"""Business services for sleep, nutrition, exercise, and recovery logs."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.time_utils import as_utc, to_database_datetime
from app.db.base import NutritionLog, RecoveryLog, SleepLog, WorkoutLog


def _commit(db: Session) -> None:
    """Commit a unit of work and restore the session after database errors."""
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise


def _validate_quality_score(quality_score: int | None) -> None:
    """Validate an optional quality score on a one-to-ten scale."""
    if quality_score is not None and not 1 <= quality_score <= 10:
        raise ValueError("Quality score must be between 1 and 10.")


def _required_text(value: str, field_name: str, max_length: int) -> str:
    """Normalize and validate a required text field."""
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{field_name} cannot be empty.")
    if len(normalized) > max_length:
        raise ValueError(f"{field_name} cannot exceed {max_length} characters.")
    return normalized


@dataclass(frozen=True, slots=True)
class LifestyleSummary:
    """Aggregated lifestyle activity for a UTC time interval."""

    since: datetime
    until: datetime
    sleep_hours: float
    meal_count: int
    calorie_total: int | None
    workout_count: int
    workout_minutes: int
    recovery_count: int
    recovery_minutes: int


class LifestyleService:
    """Record lifestyle events and calculate interval summaries."""

    def __init__(self, db: Session) -> None:
        """Initialize the service with a database session."""
        self._db = db

    def record_sleep(
        self,
        telegram_id: int,
        duration_hours: float,
        *,
        quality_score: int | None = None,
        logged_at: datetime | None = None,
        notes: str | None = None,
    ) -> SleepLog:
        """Record sleep ending at the supplied time or the current UTC time."""
        if not 0 < duration_hours <= 24:
            raise ValueError("Sleep duration must be greater than zero and at most 24 hours.")
        _validate_quality_score(quality_score)

        end_time = as_utc(logged_at or datetime.now(timezone.utc))
        start_time = end_time - timedelta(hours=duration_hours)
        sleep_log = SleepLog(
            telegram_id=telegram_id,
            start_time=to_database_datetime(start_time),
            end_time=to_database_datetime(end_time),
            duration_hours=duration_hours,
            quality_score=quality_score,
            notes=notes.strip() if notes and notes.strip() else None,
        )
        self._db.add(sleep_log)
        _commit(self._db)
        self._db.refresh(sleep_log)
        return sleep_log

    def record_meal(
        self,
        telegram_id: int,
        meal_type: str,
        description: str,
        *,
        calories: int | None = None,
        logged_at: datetime | None = None,
    ) -> NutritionLog:
        """Record a meal and optional calorie estimate."""
        normalized_meal_type = _required_text(meal_type, "Meal type", 32)
        normalized_description = _required_text(description, "Meal description", 4000)
        if calories is not None and not 0 <= calories <= 10_000:
            raise ValueError("Calories must be between 0 and 10000.")

        meal = NutritionLog(
            telegram_id=telegram_id,
            meal_type=normalized_meal_type,
            description=normalized_description,
            calories=calories,
            logged_at=to_database_datetime(logged_at or datetime.now(timezone.utc)),
        )
        self._db.add(meal)
        _commit(self._db)
        self._db.refresh(meal)
        return meal

    def record_workout(
        self,
        telegram_id: int,
        workout_type: str,
        duration_minutes: int,
        *,
        intensity: str | None = None,
        notes: str | None = None,
        logged_at: datetime | None = None,
    ) -> WorkoutLog:
        """Record a workout with an optional intensity and note."""
        normalized_type = _required_text(workout_type, "Workout type", 64)
        if not 1 <= duration_minutes <= 1440:
            raise ValueError("Workout duration must be between 1 and 1440 minutes.")
        normalized_intensity = intensity.strip().lower() if intensity else None
        if normalized_intensity == "":
            normalized_intensity = None
        if normalized_intensity not in {None, "low", "moderate", "high"}:
            raise ValueError("Intensity must be low, moderate, or high.")

        workout = WorkoutLog(
            telegram_id=telegram_id,
            workout_type=normalized_type,
            duration_minutes=duration_minutes,
            intensity=normalized_intensity,
            notes=notes.strip() if notes and notes.strip() else None,
            logged_at=to_database_datetime(logged_at or datetime.now(timezone.utc)),
        )
        self._db.add(workout)
        _commit(self._db)
        self._db.refresh(workout)
        return workout

    def record_recovery(
        self,
        telegram_id: int,
        recovery_type: str,
        *,
        duration_minutes: int | None = None,
        quality_score: int | None = None,
        notes: str | None = None,
        logged_at: datetime | None = None,
    ) -> RecoveryLog:
        """Record a recovery activity with optional duration and quality."""
        normalized_type = _required_text(recovery_type, "Recovery type", 64)
        if duration_minutes is not None and not 1 <= duration_minutes <= 1440:
            raise ValueError("Recovery duration must be between 1 and 1440 minutes.")
        _validate_quality_score(quality_score)

        recovery = RecoveryLog(
            telegram_id=telegram_id,
            recovery_type=normalized_type,
            duration_minutes=duration_minutes,
            quality_score=quality_score,
            notes=notes.strip() if notes and notes.strip() else None,
            logged_at=to_database_datetime(logged_at or datetime.now(timezone.utc)),
        )
        self._db.add(recovery)
        _commit(self._db)
        self._db.refresh(recovery)
        return recovery

    def get_summary(
        self,
        telegram_id: int,
        since: datetime,
        *,
        until: datetime | None = None,
    ) -> LifestyleSummary:
        """Aggregate sleep, meals, workouts, and recovery in a UTC interval."""
        start = as_utc(since)
        end = as_utc(until or datetime.now(timezone.utc))
        if end <= start:
            raise ValueError("The summary end time must be after its start time.")

        start_db = start.replace(tzinfo=None)
        end_db = end.replace(tzinfo=None)
        sleep_logs = (
            self._db.query(SleepLog)
            .filter(
                SleepLog.telegram_id == telegram_id,
                SleepLog.start_time < end_db,
                SleepLog.end_time > start_db,
            )
            .all()
        )
        sleep_seconds = 0.0
        for sleep_log in sleep_logs:
            overlap_start = max(as_utc(sleep_log.start_time), start)
            overlap_end = min(as_utc(sleep_log.end_time), end)
            sleep_seconds += max(0.0, (overlap_end - overlap_start).total_seconds())

        meals = (
            self._db.query(NutritionLog)
            .filter(
                NutritionLog.telegram_id == telegram_id,
                NutritionLog.logged_at >= start_db,
                NutritionLog.logged_at < end_db,
            )
            .all()
        )
        calorie_total = (
            sum(meal.calories for meal in meals if meal.calories is not None)
            if any(meal.calories is not None for meal in meals)
            else None
        )

        workouts = (
            self._db.query(WorkoutLog)
            .filter(
                WorkoutLog.telegram_id == telegram_id,
                WorkoutLog.logged_at >= start_db,
                WorkoutLog.logged_at < end_db,
            )
            .all()
        )
        recovery_logs = (
            self._db.query(RecoveryLog)
            .filter(
                RecoveryLog.telegram_id == telegram_id,
                RecoveryLog.logged_at >= start_db,
                RecoveryLog.logged_at < end_db,
            )
            .all()
        )
        recovery_minutes = sum(
            recovery.duration_minutes or 0 for recovery in recovery_logs
        )

        return LifestyleSummary(
            since=start,
            until=end,
            sleep_hours=round(sleep_seconds / 3600, 2),
            meal_count=len(meals),
            calorie_total=calorie_total,
            workout_count=len(workouts),
            workout_minutes=sum(workout.duration_minutes for workout in workouts),
            recovery_count=len(recovery_logs),
            recovery_minutes=recovery_minutes,
        )
