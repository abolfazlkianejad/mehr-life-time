"""Telegram bot command handlers."""

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from app.core.config import settings
from app.core.database import SessionLocal
from app.bot.security import restricted
from app.services.user_service import get_user_by_telegram_id, register_user, set_user_approval


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /start command, register users, and notify admin for unapproved ones."""
    tg_user = update.effective_user
    if not tg_user:
        return

    is_primary_admin = tg_user.id in settings.ALLOWED_USERS

    with SessionLocal() as session:
        user = register_user(
            session=session,
            telegram_id=tg_user.id,
            username=tg_user.username,
            first_name=tg_user.first_name,
            is_admin=is_primary_admin,
            is_approved=is_primary_admin,
        )

    if user.is_approved:
        await update.message.reply_text(
            f"سلام {tg_user.first_name}! 🚀\n"
            "به سیستم مدیریت شخصی Mehr Life Time خوش آمدید.\n\n"
            "از دستورات سیستم برای ثبت فعالیت‌های خود استفاده کنید."
        )
        return

    # User is not approved yet -> Send waiting message and alert admin
    await update.message.reply_text(
        "درخواست عضویت شما ثبت شد و برای ادمین ارسال گردید. لطفاً منتظر تایید باشید."
    )

    admin_keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("تایید دسترسی ✅", callback_data=f"approve_{tg_user.id}"),
            InlineKeyboardButton("رد دسترسی ❌", callback_data=f"reject_{tg_user.id}"),
        ]
    ])

    user_info = f"👤 کاربر جدید درخواست دسترسی داده است:\n\n" \
                f"نام: {tg_user.first_name}\n" \
                f"نام کاربری: @{tg_user.username or 'ندارد'}\n" \
                f"آیدی عددی: `{tg_user.id}`"

    for admin_id in settings.ALLOWED_USERS:
        try:
            await context.bot.send_message(
                chat_id=admin_id,
                text=user_info,
                reply_markup=admin_keyboard,
                parse_mode="Markdown"
            )
        except Exception:
            pass


async def user_approval_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle approval or rejection callback queries from admin."""
    query = update.callback_query
    if not query or not query.data:
        return

    await query.answer()
    admin_id = update.effective_user.id if update.effective_user else None

    if admin_id not in settings.ALLOWED_USERS:
        await query.edit_message_text("⛔ شما دسترسی لازم برای این کار را ندارید.")
        return

    data = query.data
    action, target_user_id_str = data.split("_", 1)
    target_user_id = int(target_user_id_str)

    with SessionLocal() as session:
        if action == "approve":
            set_user_approval(session, target_user_id, approved=True)
            await query.edit_message_text(f"✅ دسترسی کاربر `{target_user_id}` تایید شد.", parse_mode="Markdown")
            try:
                await context.bot.send_message(
                    chat_id=target_user_id,
                    text="🎉 تبریک! حساب شما توسط ادمین تایید شد. اکنون می‌توانید با /start کار با ربات را آغاز کنید."
                )
            except Exception:
                pass
        elif action == "reject":
            set_user_approval(session, target_user_id, approved=False)
            await query.edit_message_text(f"❌ درخواست کاربر `{target_user_id}` رد شد.", parse_mode="Markdown")
            try:
                await context.bot.send_message(
                    chat_id=target_user_id,
                    text="⛔ متاسفانه درخواست دسترسی شما توسط ادمین رد شد."
                )
            except Exception:
                pass


@restricted
async def ping_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /ping command for verified users."""
    await update.message.reply_text("Pong! ⚡ سیستم فعال است.")
