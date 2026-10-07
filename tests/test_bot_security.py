"""Unit tests for bot security, user registration, and admin authorization."""

import pytest

from app.core.config import settings
from app.db.base import Base, User
from app.db.session import SessionLocal, engine
from app.services.user_service import (
    approve_user,
    get_user_by_telegram_id,
    register_user,
)


@pytest.fixture(autouse=True)
def clean_database():
    """Ensure clean database schema for each test run."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def test_admin_is_always_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify admin user ID defined in settings is recognized."""
    admin_id = 123456789
    monkeypatch.setattr(settings, "TELEGRAM_ALLOWED_USER_IDS", str(admin_id))
    assert admin_id in settings.allowed_telegram_users


def test_unapproved_user_is_not_allowed() -> None:
    """Verify newly registered user cannot access before approval."""
    user_id = 1234567

    with SessionLocal() as session:
        user = register_user(
            db=session,
            telegram_id=user_id,
            username="testuser",
            full_name="Test User",
            role="user",
        )
        assert user.is_active is False

        fetched_user = get_user_by_telegram_id(session, user_id)
        assert fetched_user is not None
        assert fetched_user.is_active is False


def test_approved_user_is_allowed() -> None:
    """Verify that once approved, user active status is true."""
    user_id = 7654321

    with SessionLocal() as session:
        user = register_user(
            db=session,
            telegram_id=user_id,
            username="cooluser",
            full_name="Cool User",
            role="user",
        )
        assert user.is_active is False

        approved_user = approve_user(session, user.id)
        assert approved_user is not None
        assert approved_user.is_active is True
