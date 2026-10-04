"""Telegram bot application setup and router."""

from telegram.ext import Application, CallbackQueryHandler, CommandHandler
from app.core.config import settings
from app.bot.handlers import ping_command, start_command, user_approval_callback


def build_bot_app() -> Application:
    """Construct and configure the Telegram Bot Application."""
    app = Application.builder().token(settings.TELEGRAM_BOT_TOKEN).build()

    # Command handlers
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("ping", ping_command))

    # Callback query handlers for inline buttons
    app.add_handler(CallbackQueryHandler(user_approval_callback, pattern=r"^(approve|reject)_\d+$"))

    return app
