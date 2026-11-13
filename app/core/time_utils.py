"""Shared UTC and database datetime helpers."""

from datetime import datetime, timezone


def as_utc(value: datetime) -> datetime:
    """Return an aware UTC datetime, treating legacy naive values as UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def to_database_datetime(value: datetime) -> datetime:
    """Convert a datetime to naive UTC for SQLite datetime columns."""
    return as_utc(value).replace(tzinfo=None)
