"""Unit tests for bot security, user registration, and admin authorization."""

import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.bot.handlers import admin_callback_handler, start_handler
from app.core.config import settings
from app.db.base import Base, User
from app.db.session import SessionLocal, engine
from app.services.user_service import (
    approve_user,
    get_user_by_telegram_id,
    register_user,
    reject_user,
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


@pytest.mark.asyncio
async def test_configured_admin_is_activated_on_first_start(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Ensure the configured owner can enter without a separate approval flow."""
    admin_id = 345678901
    monkeypatch.setattr(settings, "TELEGRAM_ALLOWED_USER_IDS", str(admin_id))
    message = SimpleNamespace(reply_text=AsyncMock())
    update = SimpleNamespace(
        effective_user=SimpleNamespace(
            id=admin_id,
            username="owner",
            full_name="Owner",
        ),
        effective_message=message,
    )
    context = SimpleNamespace(bot=SimpleNamespace(send_message=AsyncMock()))

    await start_handler(update, context)

    message.reply_text.assert_awaited_once()
    with SessionLocal() as session:
        user = get_user_by_telegram_id(session, admin_id)
        assert user is not None
        assert user.is_active is True
        assert user.role == "admin"


@pytest.mark.asyncio
async def test_unauthorized_callback_cannot_approve_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Ensure access callbacks require a configured administrator ID."""
    admin_id = 456789012
    target_id = 567890123
    monkeypatch.setattr(settings, "TELEGRAM_ALLOWED_USER_IDS", str(admin_id))
    with SessionLocal() as session:
        register_user(session, telegram_id=target_id, full_name="Pending User")

    query = SimpleNamespace(
        from_user=SimpleNamespace(id=target_id),
        data=f"approve_{target_id}",
        answer=AsyncMock(),
        edit_message_text=AsyncMock(),
    )
    update = SimpleNamespace(callback_query=query)
    context = SimpleNamespace(bot=SimpleNamespace(send_message=AsyncMock()))

    await admin_callback_handler(update, context)

    query.answer.assert_awaited_once_with(
        "این عملیات فقط برای مدیر مجاز است.",
        show_alert=True,
    )
    query.edit_message_text.assert_not_awaited()
    with SessionLocal() as session:
        user = get_user_by_telegram_id(session, target_id)
        assert user is not None
        assert user.is_active is False


def test_reject_user_returns_notification_data_and_deletes_record() -> None:
    """Ensure rejection returns display data while deleting the pending user."""
    target_id = 678901234
    with SessionLocal() as session:
        register_user(session, telegram_id=target_id, full_name="Rejected User")

        rejected_user = reject_user(session, target_id)

        assert rejected_user == (target_id, "Rejected User")
        assert get_user_by_telegram_id(session, target_id) is None
