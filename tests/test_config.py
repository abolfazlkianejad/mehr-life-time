"""Unit tests for configuration integrity and parsing."""

from app.core.config import Settings
import pytest
from sqlalchemy.engine import make_url


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


def test_default_database_url_uses_sync_sqlite() -> None:
    """Ensure the default URL matches the synchronous SQLAlchemy engine."""
    configured_default = Settings.model_fields["DATABASE_URL"].default
    assert isinstance(configured_default, str)
    database_url = make_url(configured_default)

    assert database_url.get_backend_name() == "sqlite"
    assert database_url.drivername == "sqlite"
    assert database_url.database == "data/mehr_life_time.db"


def test_admin_chat_id_accepts_telegram_group_ids() -> None:
    """Ensure negative Telegram group IDs parse as integers."""
    app_settings = Settings(_env_file=None, TELEGRAM_ADMIN_CHAT_ID="-1001234567890")

    assert app_settings.TELEGRAM_ADMIN_CHAT_ID == -1001234567890


def test_llm_service_uses_configured_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    """Use the configured request timeout for the local LLM client."""
    from app.services import llm

    monkeypatch.setattr(llm, "settings", Settings(_env_file=None, LLM_TIMEOUT=17.5))

    assert llm.LLMService().timeout == 17.5
