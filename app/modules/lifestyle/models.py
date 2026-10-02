"""Domain models for Lifestyle, Health, and Recovery."""

from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, Float
from app.db.session import Base


class SleepLog(Base):
    """Tracks sleep cycles and subjective quality."""

    __tablename__ = "sleep_logs"

    id = Column(Integer, primary_key=True, index=True)
    bedtime = Column(DateTime, nullable=False)
    wake_time = Column(DateTime, nullable=False)
    duration_hours = Column(Float, nullable=False)
    quality_score = Column(Integer, nullable=True)  # 1 to 10
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


class NutritionLog(Base):
    """Tracks meals and basic nutrition logs."""

    __tablename__ = "nutrition_logs"

    id = Column(Integer, primary_key=True, index=True)
    meal_type = Column(String(50), nullable=False)  # breakfast, lunch, dinner, snack
    description = Column(Text, nullable=False)
    logged_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


class WorkoutLog(Base):
    """Tracks workouts and physical activities."""

    __tablename__ = "workout_logs"

    id = Column(Integer, primary_key=True, index=True)
    activity_type = Column(String(100), nullable=False)  # gym, walk, running
    duration_minutes = Column(Integer, nullable=False)
    notes = Column(Text, nullable=True)
    logged_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

