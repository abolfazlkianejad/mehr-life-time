"""Work domain models.

The canonical SQLAlchemy models live in app.db.base.
This module re-exports them for backward compatibility.
"""

from app.db.base import Task, WorkSession

__all__ = [
    "Task",
    "WorkSession",
]