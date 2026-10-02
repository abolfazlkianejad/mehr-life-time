"""Central registry importing all models for metadata creation."""

from app.db.session import Base
from app.modules.work.models import WorkSession, Task
from app.modules.lifestyle.models import SleepLog, NutritionLog, WorkoutLog

__all__ = [
    "Base",
    "WorkSession",
    "Task",
    "SleepLog",
    "NutritionLog",
    "WorkoutLog",
]
