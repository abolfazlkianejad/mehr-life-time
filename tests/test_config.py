"""Unit tests for configuration integrity and parsing."""

from app.core.config import Settings


def test_default_settings() -> None:
    """Ensure default settings initialize with expected values."""
    app_settings = Settings(
        APP_NAME="Mehr Life Time",
        TELEGRAM_ALLOWED_USER_IDS="111, 222, 333",
    )
    assert app_settings.APP_NAME == "Mehr Life Time"
    assert app_settings.allowed_telegram_users == [111, 222, 333]
    assert app_settings.TIMEZONE == "Asia/Tehran"


def test_empty_allowed_users() -> None:
    """Ensure empty user ID string safely returns an empty list."""
    app_settings = Settings(TELEGRAM_ALLOWED_USER_IDS="")
    assert app_settings.allowed_telegram_users == []
