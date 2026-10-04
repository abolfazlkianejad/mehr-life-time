"""Application settings and configuration management."""

from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    APP_NAME: str = "Mehr Life Time"
    APP_ENV: str = "development"
    DEBUG: bool = True
    TIMEZONE: str = "Asia/Tehran"

    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_ALLOWED_USER_IDS: str = ""
    ALLOWED_USERS: List[int] = []

    DATABASE_URL: str = "sqlite:///./mehr_life_time.db"

    LLM_PROVIDER: str = "ollama"
    LLM_BASE_URL: str = "http://localhost:11434"
    LLM_MODEL_NAME: str = "llama3"

    @property
    def allowed_telegram_users(self) -> List[int]:
        """Parse comma-separated Telegram user IDs into a list of integers."""
        if not self.TELEGRAM_ALLOWED_USER_IDS.strip():
            return []
        return [
            int(user_id.strip())
            for user_id in self.TELEGRAM_ALLOWED_USER_IDS.split(",")
            if user_id.strip().isdigit()
        ]


settings = Settings()
