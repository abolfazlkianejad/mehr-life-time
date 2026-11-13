"""Telegram bot application setup and router."""

import logging
from datetime import time
from zoneinfo import ZoneInfo

from telegram import Update
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    ChatMemberHandler,
    CommandHandler,
    Defaults,
    MessageHandler,
    filters,
)

from app.bot.handlers import (
    admin_callback_handler,
    start_handler,
)
from app.bot.planner_ui import (
    daily_plan_job,
    document_message_handler,
    planner_callback_handler,
    task_notification_job,
    user_message_handler,
    weekly_overview_job,
    workspace_membership_handler,
)
from app.bot.commands import (
    help_command,
)
from app.core.config import settings
from app.services.telegram_workspace_creator import telegram_workspace_creator

logger = logging.getLogger("mehr_life_time.bot")


async def _post_init(app: Application) -> None:
    """Connect the encrypted system account and start Tehran-time jobs."""
    try:
        if not await telegram_workspace_creator.ensure_connected():
            logger.warning("System Telegram account is not connected; group creation is unavailable.")
    except Exception:
        logger.exception("Could not connect the Telegram workspace account.")
    queue = app.job_queue
    if queue is None:
        logger.error("JobQueue is unavailable; scheduled planning is disabled.")
        return
    tehran = ZoneInfo(settings.TIMEZONE)
    queue.run_repeating(task_notification_job, interval=60, first=10, name="task-notifications")
    queue.run_daily(
        daily_plan_job,
        time=time(hour=6, minute=0, tzinfo=tehran),
        days=tuple(range(7)),
        name="daily-plans",
    )
    # python-telegram-bot maps Sunday=0 through Saturday=6.
    queue.run_daily(
        weekly_overview_job,
        time=time(hour=6, minute=0, tzinfo=tehran),
        days=(6,),
        name="weekly-overview",
    )


async def _post_shutdown(app: Application) -> None:
    await telegram_workspace_creator.disconnect()


def build_bot_app() -> Application:
    """Construct and configure the Telegram Bot Application."""
    app = (
        Application.builder()
        .token(settings.TELEGRAM_BOT_TOKEN)
        .defaults(Defaults(tzinfo=ZoneInfo(settings.TIMEZONE)))
        .post_init(_post_init)
        .post_shutdown(_post_shutdown)
        .build()
    )

    # Core command handlers.
    app.add_handler(CommandHandler("start", start_handler))
    app.add_handler(CommandHandler("help", help_command))

    # Callback handlers for admin approval and rejection buttons.
    app.add_handler(
        CallbackQueryHandler(
            admin_callback_handler,
            pattern=r"^(approve|reject)_\d+$",
        )
    )
    app.add_handler(
        CallbackQueryHandler(
            planner_callback_handler,
            pattern=r"^(terms_(accept|decline)|task_(start|finish|continue)_\d+)$",
        )
    )

    app.add_handler(
        ChatMemberHandler(
            workspace_membership_handler,
            ChatMemberHandler.ANY_CHAT_MEMBER,
        )
    )

    # Route non-command text messages to the active workflow.
    app.add_handler(
        MessageHandler(
            filters.TEXT & ~filters.COMMAND,
            user_message_handler,
        )
    )
    app.add_handler(
        MessageHandler(
            filters.Document.ALL,
            document_message_handler,
        )
    )

    return app


def start_bot() -> None:
    """Build the Telegram bot application and start polling."""
    app = build_bot_app()
    app.run_polling(allowed_updates=Update.ALL_TYPES)
