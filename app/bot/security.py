"""Security and access control decorators for Telegram Bot handlers."""

from functools import wraps
from typing import Any, Callable
from telegram import Update
from telegram.ext import ContextTypes

from app.core.config import settings
from app.db.session import SessionLocal
from app.services.user_service import get_user_by_telegram_id


def is_user_allowed(telegram_id: int) -> bool:
    """Check if the telegram user is in allowed admin list or is an active approved user."""
    if telegram_id in settings.allowed_telegram_users:
        return True

    with SessionLocal() as session:
        user = get_user_by_telegram_id(session, telegram_id)
        return user is not None and bool(user.is_active)


def restricted(func: Callable[..., Any]) -> Callable[..., Any]:
    """Ensure handler only executes for approved or admin users."""
    @wraps(func)
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE, *args: Any, **kwargs: Any) -> Any:
        user = update.effective_user
        if not user or not is_user_allowed(user.id):
            if update.effective_message:
                await update.effective_message.reply_text(
                    "⛔ دسترسی شما هنوز تایید نشده است. لطفاً منتظر تایید ادمین بمانید."
                )
            return None
        return await func(update, context, *args, **kwargs)
    return wrapper
