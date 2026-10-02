"""Security gatekeeper tests for Telegram interactions."""

from unittest.mock import AsyncMock, MagicMock
import pytest
from app.bot.security import restricted
from app.core.config import settings


@pytest.mark.asyncio
async def test_restricted_decorator_denies_unauthorized_user(monkeypatch):
    """Ensure users not in allowed_telegram_users are blocked."""
    monkeypatch.setattr(settings, "TELEGRAM_ALLOWED_USER_IDS", "1001, 1002")

    mock_handler = AsyncMock()
    protected_handler = restricted(mock_handler)

    mock_update = MagicMock()
    mock_update.effective_user.id = 9999  # Unauthorized ID
    mock_update.effective_message.reply_text = AsyncMock()
    mock_context = MagicMock()

    await protected_handler(mock_update, mock_context)

    # Handler must NOT be called
    mock_handler.assert_not_called()
    mock_update.effective_message.reply_text.assert_called_once()


@pytest.mark.asyncio
async def test_restricted_decorator_allows_authorized_user(monkeypatch):
    """Ensure users in allowed_telegram_users are allowed."""
    monkeypatch.setattr(settings, "TELEGRAM_ALLOWED_USER_IDS", "1001, 1002")

    mock_handler = AsyncMock()
    protected_handler = restricted(mock_handler)

    mock_update = MagicMock()
    mock_update.effective_user.id = 1001  # Authorized ID
    mock_update.effective_message.reply_text = AsyncMock()
    mock_context = MagicMock()

    await protected_handler(mock_update, mock_context)

    # Handler must be called
    mock_handler.assert_called_once_with(mock_update, mock_context)
