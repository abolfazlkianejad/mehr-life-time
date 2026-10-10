# app/core/config.py
"""Application settings and configuration management."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
    )

    APP_NAME: str = "Mehr Life Time"
    APP_ENV: str = "development"
    DEBUG: bool = True
    TIMEZONE: str = "Asia/Tehran"

    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_ALLOWED_USER_IDS: str = ""
    TELEGRAM_ADMIN_CHAT_ID: int | None = None
    ALLOWED_USERS: list[int] = Field(default_factory=list)
    DATABASE_URL: str = "sqlite:///data/mehr_life_time.db"

    # LLM Settings
    LLM_PROVIDER: str = "ollama"
    LLM_BASE_URL: str = "http://localhost:11434"
    LLM_MODEL_NAME: str = "llama3"
    LLM_TIMEOUT: float = 90.0

    @property
    def allowed_telegram_users(self) -> list[int]:
        """Parse comma-separated Telegram user IDs into a list of integers."""
        if not self.TELEGRAM_ALLOWED_USER_IDS.strip():
            return []
        return [
            int(user_id.strip())
            for user_id in self.TELEGRAM_ALLOWED_USER_IDS.split(",")
            if user_id.strip().isdigit()
        ]


settings = Settings()
