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
from app.bot.commands import (
    done_command,
    help_command,
    meal_command,
    recovery_command,
    report_command,
    sleep_command,
    task_command,
    tasks_command,
    work_start_command,
    work_stop_command,
    workout_command,
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
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(CommandHandler("task", task_command))
    app.add_handler(CommandHandler("tasks", tasks_command))
    app.add_handler(CommandHandler("done", done_command))
    app.add_handler(CommandHandler("work_start", work_start_command))
    app.add_handler(CommandHandler("work_stop", work_stop_command))
    app.add_handler(CommandHandler("sleep", sleep_command))
    app.add_handler(CommandHandler("meal", meal_command))
    app.add_handler(CommandHandler("workout", workout_command))
    app.add_handler(CommandHandler("recovery", recovery_command))
    app.add_handler(CommandHandler("report", report_command))

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
