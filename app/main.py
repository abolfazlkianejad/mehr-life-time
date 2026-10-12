"""Application bootstrap and entry point."""
from app.bot.bot import start_bot
from app.core.config import settings
from app.core.logging import logger
from app.db.base import Base
from app.db.session import engine

import app.modules.onboarding.models
import app.modules.planning.models
from sqlalchemy import inspect, text


def init_database() -> None:
    """Create all database tables if they do not exist."""
    logger.info("Verifying and initializing database tables...")
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    migrations = {
        "planned_tasks": {
            "start_notified": "BOOLEAN NOT NULL DEFAULT 0",
        },
        "telegram_workspaces": {
            "bot_added": "BOOLEAN NOT NULL DEFAULT 0",
            "user_joined": "BOOLEAN NOT NULL DEFAULT 0",
        },
    }
    with engine.begin() as connection:
        for table, columns in migrations.items():
            if not inspector.has_table(table):
                continue
            existing = {column["name"] for column in inspector.get_columns(table)}
            for column, declaration in columns.items():
                if column not in existing:
                    connection.execute(text(
                        f"ALTER TABLE {table} ADD COLUMN {column} {declaration}"
                    ))
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
