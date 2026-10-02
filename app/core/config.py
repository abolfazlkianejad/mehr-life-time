"""Central application configuration using Pydantic Settings."""

from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables and .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # General Application
    APP_NAME: str = "Mehr Life Time"
    APP_ENV: str = "development"
    DEBUG: bool = True
    TIMEZONE: str = "Asia/Tehran"

    # Telegram Credentials
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_ALLOWED_USER_IDS: str = ""

    # Database
    DATABASE_URL: str = "sqlite:///./mehr_life_time.db"

    # LLM Settings
    LLM_PROVIDER: str = "ollama"
    LLM_BASE_URL: str = "http://localhost:11434"
    LLM_MODEL_NAME: str = "llama3"

    @property
    def allowed_telegram_users(self) -> List[int]:
        """Parse comma-separated Telegram user IDs into a list of integers.

        Returns:
            List[int]: Authorized Telegram user IDs.
        """
        if not self.TELEGRAM_ALLOWED_USER_IDS.strip():
            return []
        return [
            int(uid.strip())
            for uid in self.TELEGRAM_ALLOWED_USER_IDS.split(",")
            if uid.strip().isdigit()
        ]


# Singleton settings instance
settings = Settings()
