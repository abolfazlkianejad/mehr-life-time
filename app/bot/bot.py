"""Telegram bot application setup and router."""

from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    MessageHandler,
    filters,
)

from app.bot.handlers import (
    admin_callback_handler,
    finish_onboarding_handler,
    start_handler,
    text_message_handler,
)
from app.core.config import settings


def build_bot_app() -> Application:
    """Construct and configure the Telegram Bot Application."""
    app = Application.builder().token(settings.TELEGRAM_BOT_TOKEN).build()

    # Core command handlers.
    app.add_handler(CommandHandler("start", start_handler))
    app.add_handler(
        CommandHandler("finish_onboarding", finish_onboarding_handler)
    )

    # Callback handlers for admin approval and rejection buttons.
    app.add_handler(
        CallbackQueryHandler(
            admin_callback_handler,
            pattern=r"^(approve|reject)_\d+$",
        )
    )

    # Route non-command text messages to the active workflow.
    app.add_handler(
        MessageHandler(
            filters.TEXT & ~filters.COMMAND,
            text_message_handler,
        )
    )

    return app


def start_bot() -> None:
    """Build the Telegram bot application and start polling."""
    app = build_bot_app()
    app.run_polling()
