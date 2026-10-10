"""Application bootstrap and entry point."""
from app.bot.bot import start_bot
from app.core.config import settings
from app.core.logging import logger
from app.db.base import Base
from app.db.session import engine

import app.modules.onboarding.models


def init_database() -> None:
    """Create all database tables if they do not exist."""
    logger.info("Verifying and initializing database tables...")
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables verified.")


def main() -> None:
    """Initialize core systems and run the bot application."""
    logger.info("Initializing %s...", settings.APP_NAME)
    logger.info("Environment: %s | Timezone: %s", settings.APP_ENV, settings.TIMEZONE)

    # Initialize SQLite database
    init_database()

    # Start Telegram Bot if token is present
    if settings.TELEGRAM_BOT_TOKEN and not settings.TELEGRAM_BOT_TOKEN.startswith("YOUR_"):
        start_bot()
    else:
        logger.warning("TELEGRAM_BOT_TOKEN is not set. Bot polling skipped.")


if __name__ == "__main__":
    main()
