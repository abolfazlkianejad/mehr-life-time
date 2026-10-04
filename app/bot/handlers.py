"""Telegram bot command handlers and interaction callbacks."""

import logging
from telegram import Update
from telegram.ext import ContextTypes

from app.core.config import settings
from app.db.base import SessionLocal, User
from app.services.user_service import approve_user, get_user_by_telegram_id, register_user

logger = logging.getLogger(__name__)


async def ping_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /ping command to verify bot responsiveness."""
    if not update.effective_message:
        return
    await update.effective_message.reply_text("pong 🏓")


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /start command with role and permission check."""
    user = update.effective_user
    message = update.effective_message

    if not user or not message:
        return

    telegram_id = user.id
    username = user.username or ""
    full_name = f"{user.first_name or ''} {user.last_name or ''}".strip()

    with SessionLocal() as db:
        db_user = get_user_by_telegram_id(db, telegram_id)

        # Admin user bypass
        if telegram_id in settings.allowed_telegram_users:
            if not db_user:
                db_user = register_user(
                    db=db,
                    telegram_id=telegram_id,
                    username=username,
                    full_name=full_name,
                    role="admin",
                )
                approve_user(db=db, user_id=db_user.id)
            await message.reply_text(
                f"سلام {full_name or username} عزیز! 👑\nبه سیستم عامل مدیریت فردی Mehr خوش آمدید."
            )
            return

        # Regular user flow
        if not db_user:
            db_user = register_user(
                db=db,
                telegram_id=telegram_id,
                username=username,
                full_name=full_name,
                role="user",
            )
            await message.reply_text(
                "درخواست دسترسی شما ثبت شد. پس از تایید توسط ادمین، دسترسی شما فعال خواهد شد."
            )
            return

        if not db_user.is_active:
            await message.reply_text("حساب شما هنوز توسط ادمین تایید نشده است. لطفاً منتظر بمانید.")
            return

        await message.reply_text(
            f"سلام {full_name or username}!\nسیستم عامل زندگی و کار آماده دریافت دستورات شماست."
        )


async def user_approval_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle admin approval callbacks for user access requests."""
    query = update.callback_query
    if not query or not query.data:
        return

    await query.answer()

    if update.effective_user and update.effective_user.id not in settings.allowed_telegram_users:
        await query.edit_message_text("شما دسترسی انجام این عملیات را ندارید.")
        return

    # Callback data format: approve_{user_id}
    if query.data.startswith("approve_"):
        user_id = int(query.data.split("_")[1])
        with SessionLocal() as db:
            approved = approve_user(db=db, user_id=user_id)
            if approved:
                await query.edit_message_text(f"کاربر شناسه {user_id} با موفقیت تایید شد ✅")
            else:
                await query.edit_message_text("کاربر یافت نشد.")
