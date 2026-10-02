"""Telegram bot application builder and runner."""

from telegram.ext import ApplicationBuilder, CommandHandler, Application
from app.core.config import settings
from app.core.logging import logger
from app.bot.handlers import start_command, ping_command


def create_bot_application() -> Application:
    """Build and configure the Telegram Bot Application.

    Returns:
        Application: Configured python-telegram-bot application.
    """
    if not settings.TELEGRAM_BOT_TOKEN:
        raise ValueError("TELEGRAM_BOT_TOKEN is not configured in .env")

    app = ApplicationBuilder().token(settings.TELEGRAM_BOT_TOKEN).build()

    # Register basic command handlers
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("ping", ping_command))

    return app


def start_bot() -> None:
    """Start polling for Telegram updates."""
    logger.info("Starting Telegram Bot Polling...")
    bot_app = create_bot_application()
    bot_app.run_polling()
