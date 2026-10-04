"""Telegram bot command handlers and message processing logic."""

import logging
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes
from app.core.config import settings
from app.db.base import SessionLocal
from app.services.user_service import (
    approve_user,
    get_user_by_telegram_id,
    register_user,
    reject_user,
)

logger = logging.getLogger(__name__)


async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle the /start command, register user, and notify admin if approval is needed."""
    if not update.effective_user or not update.effective_message:
        return

    tg_user = update.effective_user
    full_name = tg_user.full_name or tg_user.first_name
    username = tg_user.username or "ندارد"
    is_admin = tg_user.id in settings.allowed_telegram_users

    with SessionLocal() as db:
        user = get_user_by_telegram_id(db, tg_user.id)
        if not user:
            role = "admin" if is_admin else "user"
            user = register_user(
                db=db,
                telegram_id=tg_user.id,
                username=tg_user.username,
                full_name=full_name,
                role=role,
            )

        if is_admin or user.is_active:
            await update.effective_message.reply_text(
                f"سلام {full_name} عزیز! 👑\nبه سیستم عامل مدیریت فردی Mehr خوش آمدید."
            )
            return

        # Regular unapproved user
        await update.effective_message.reply_text(
            "حساب شما هنوز توسط ادمین تایید نشده است. لطفاً منتظر بمانید."
        )

        keyboard = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton("✅ تایید", callback_data=f"approve_{user.id}"),
                    InlineKeyboardButton("❌ رد", callback_data=f"reject_{user.id}"),
                ]
            ]
        )

        admin_message = (
            "👤 درخواست دسترسی جدید\n\n"
            f"نام: {full_name}\n"
            f"Username: @{username}\n"
            f"Telegram ID: {tg_user.id}\n"
            f"User ID: {user.id}"
        )

        for admin_id in settings.allowed_telegram_users:
            try:
                await context.bot.send_message(
                    chat_id=admin_id,
                    text=admin_message,
                    reply_markup=keyboard,
                )
            except Exception as e:
                logger.error(f"Failed to notify admin {admin_id}: {e}")


async def ping_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Respond to /ping healthcheck command."""
    if not update.effective_message:
        return
    await update.effective_message.reply_text("🏓 پونگ! سیستم فعال و آنلاین است.")


async def user_approval_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle callback queries for approving or rejecting user registrations."""
    query = update.callback_query
    if not query or not query.data:
        return

    await query.answer()

    admin_id = query.from_user.id
    if admin_id not in settings.allowed_telegram_users:
        await query.edit_message_text("⛔ شما دسترسی لازم برای این عملیات را ندارید.")
        return

    action, _, target_id_str = query.data.partition("_")
    if not target_id_str.isdigit():
        return

    user_db_id = int(target_id_str)

    with SessionLocal() as db:
        if action == "approve":
            approved_user = approve_user(db, user_db_id)
            if approved_user:
                await query.edit_message_text(
                    f"{query.message.text}\n\n✅ تایید شد توسط ادمین."
                )
                try:
                    await context.bot.send_message(
                        chat_id=approved_user.telegram_id,
                        text="🎉 حساب کاربری شما با موفقیت تایید شد! اکنون می‌توانید از سیستم استفاده کنید.",
                    )
                except Exception as e:
                    logger.error(f"Failed to notify user {approved_user.telegram_id}: {e}")
            else:
                await query.edit_message_text("❌ کاربر مورد نظر در دیتابیس یافت نشد.")

        elif action == "reject":
            target_tg_id = reject_user(db, user_db_id)
            if target_tg_id:
                await query.edit_message_text(
                    f"{query.message.text}\n\n❌ درخواست رد و حذف شد."
                )
                try:
                    await context.bot.send_message(
                        chat_id=target_tg_id,
                        text="❌ متأسفانه درخواست دسترسی شما به ربات تایید نشد.",
                    )
                except Exception as e:
                    logger.error(f"Failed to notify user {target_tg_id}: {e}")
            else:
                await query.edit_message_text("❌ کاربر مورد نظر در دیتابیس یافت نشد.")
