"""Tests for user authorization and access control."""

from app.bot.security import is_user_allowed
from app.core.config import settings
from app.db.session import SessionLocal
from app.db.base import init_db
from app.services.user_service import register_user, set_user_approval


def test_admin_is_always_allowed() -> None:
    """Verify that user in ALLOWED_USERS list is always allowed."""
    admin_id = 999999
    settings.ALLOWED_USERS = [admin_id]
    assert is_user_allowed(admin_id) is True


def test_unapproved_user_is_not_allowed() -> None:
    """Verify newly registered user cannot access before approval."""
    init_db()
    settings.ALLOWED_USERS = [999999]
    user_id = 1234567

    with SessionLocal() as session:
        register_user(session, telegram_id=user_id, username="testuser", first_name="Test", is_approved=False)

    assert is_user_allowed(user_id) is False


def test_approved_user_is_allowed() -> None:
    """Verify that once approved, user can access system."""
    init_db()
    settings.ALLOWED_USERS = [999999]
    user_id = 7654321

    with SessionLocal() as session:
        register_user(session, telegram_id=user_id, username="cooluser", first_name="Cool", is_approved=False)
        set_user_approval(session, telegram_id=user_id, approved=True)

    assert is_user_allowed(user_id) is True
