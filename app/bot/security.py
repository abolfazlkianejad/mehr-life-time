"""Security gatekeeper decorators and utilities for Telegram handlers."""

from functools import wraps
from typing import Callable, Any
from telegram import Update
from telegram.ext import ContextTypes
from app.core.config import settings
from app.core.logging import logger


def restricted(func: Callable) -> Callable:
    """Ensure handler is only executable by authorized Telegram user IDs.

    Args:
        func (Callable): Target Telegram update handler.

    Returns:
        Callable: Wrapped handler enforcing user ID verification.
    """

    @wraps(func)
    async def wrapped(update: Update, context: ContextTypes.DEFAULT_TYPE, *args: Any, **kwargs: Any) -> Any:
        user = update.effective_user
        if not user:
            logger.warning("Unauthorized access attempt: No effective user found.")
            return None

        allowed_ids = settings.allowed_telegram_users
        if allowed_ids and user.id not in allowed_ids:
            logger.warning("Unauthorized access attempt by User ID: %s (%s)", user.id, user.username)
            if update.effective_message:
                await update.effective_message.reply_text("⛔ دسترسی غیرمجاز. شناسه کاربری شما ثبت نشده است.")
            return None

        return await func(update, context, *args, **kwargs)

    return wrapped
