"""
Telegram bot command handlers and message processing logic.
Integrates user registration, access control, Life OS forum topics,
and the AI Onboarding conversation workflow.
"""

import logging
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.error import TelegramError
from telegram.ext import ContextTypes

from app.core.config import settings
from app.db.session import SessionLocal
from app.modules.onboarding.service import OnboardingService
from app.services.llm import LLMService
from app.services.telegram_topics import topic_service
from app.services.user_service import (
    approve_user,
    get_user_by_telegram_id,
    register_user,
    reject_user,
)

logger = logging.getLogger("mehr_life_time.bot.handlers")


async def _notify_admin_access_request(
    context: ContextTypes.DEFAULT_TYPE,
    *,
    telegram_id: int,
    username: str | None,
    full_name: str,
    is_reminder: bool,
) -> bool:
    """Send an access request to the configured administrator chat."""
    admin_chat_id = settings.TELEGRAM_ADMIN_CHAT_ID
    if admin_chat_id is None:
        logger.warning("Telegram admin chat is not configured.")
        return False

    label = "یادآوری درخواست دسترسی" if is_reminder else "درخواست دسترسی کاربر جدید"
    admin_message = (
        f"{label}:\n"
        f"نام: {full_name}\n"
        f"شناسه کاربری: @{username or 'ندارد'}\n"
        f"شناسه تلگرام: {telegram_id}"
    )
    keyboard = InlineKeyboardMarkup(
        [[
            InlineKeyboardButton("تأیید دسترسی", callback_data=f"approve_{telegram_id}"),
            InlineKeyboardButton("رد دسترسی", callback_data=f"reject_{telegram_id}"),
        ]]
    )

    try:
        await context.bot.send_message(
            chat_id=admin_chat_id,
            text=admin_message,
            reply_markup=keyboard,
        )
    except TelegramError:
        logger.exception("Could not send access request to the admin chat.")
        return False

    return True


async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /start command with role and onboarding state awareness."""
    user = update.effective_user
    message = update.effective_message
    if not user or not message:
        return

    telegram_id = user.id
    username = user.username
    full_name = user.full_name or "کاربر ناشناس"
    is_configured_admin = telegram_id in settings.allowed_telegram_users
    is_new_user = False
    is_active = False
    user_id: int | None = None
    onboarding_completed = False

    with SessionLocal() as db:
        db_user = get_user_by_telegram_id(db, telegram_id)
        if not db_user:
            is_new_user = True
            db_user = register_user(
                db=db,
                telegram_id=telegram_id,
                username=username,
                full_name=full_name,
                role="admin" if is_configured_admin else "user",
            )
        elif is_configured_admin and not db_user.is_active:
            db_user.is_active = True
            db_user.role = "admin"
            db.commit()
            db.refresh(db_user)

        user_id = db_user.id
        is_active = db_user.is_active

        if is_active:
            onboarding_service = OnboardingService(db)
            onboarding_completed = onboarding_service.is_onboarding_completed(user_id)
            if not onboarding_completed and not onboarding_service.get_active_session(user_id):
                onboarding_service.create_session(user_id)

    if not is_active:
        notification_sent = await _notify_admin_access_request(
            context,
            telegram_id=telegram_id,
            username=username,
            full_name=full_name,
            is_reminder=not is_new_user,
        )
        if notification_sent:
            reply = (
                "درخواست دسترسی شما ثبت شد و پس از تأیید مدیر فعال خواهد شد."
                if is_new_user
                else "حساب شما هنوز تأیید نشده است؛ درخواست دوباره برای مدیر ارسال شد."
            )
        else:
            reply = (
                "درخواست ثبت شد، اما مسیر اطلاع‌رسانی مدیر تنظیم نشده است. "
                "مدیر بات باید شناسهٔ شما را در TELEGRAM_ALLOWED_USER_IDS قرار دهد "
                "یا TELEGRAM_ADMIN_CHAT_ID را پیکربندی کند."
            )
        await message.reply_text(reply)
        return

    if not onboarding_completed:
        await message.reply_text(
            f"سلام {full_name} عزیز، به سیستم مدیریت زندگی و کار خوش آمدید!\n\n"
            "برای آشنایی با کار و سبک زندگی‌تان، یک گفت‌وگوی کوتاه انجام می‌دهیم.\n\n"
            "با معرفی کوتاهی از شغل یا فعالیت روزانه‌تان شروع کنید. "
            "برای ساخت پروفایل، هر زمان آماده بودید /finish_onboarding را بفرستید."
        )
        return

    await message.reply_text(
        f"خوش آمدید {full_name}! دستیار شخصی آماده است. برای دیدن فرمان‌ها /help را بفرستید."
    )


async def finish_onboarding_handler(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    """Handle /finish_onboarding to finalize onboarding and extract profile."""
    user = update.effective_user
    if not user:
        return

    with SessionLocal() as db:
        db_user = get_user_by_telegram_id(db, user.id)
        if not db_user or not db_user.is_active:
            await update.message.reply_text("دسترسی مجاز نمی‌باشد.")
            return

        onboarding_service = OnboardingService(db)
        session = onboarding_service.get_active_session(db_user.id)

        if not session:
            await update.message.reply_text(
                "سشن معارفه فعالی یافت نشد یا قبلاً تکمیل شده است."
            )
            return

        messages = onboarding_service.get_messages(session.id)
        if len(messages) < 2:
            await update.message.reply_text(
                "هنوز اطلاعات کافی رد و بدل نشده است. لطفاً ابتدا کمی از برنامه و کارهایتان برایم بگویید."
            )
            return

        await update.message.reply_text(
            "⏳ در حال تحلیل و ذخیره‌سازی اطلاعات پروفایل شما... لطفاً چند لحظه صبر کنید."
        )

        try:
            llm = LLMService()
            profile = await onboarding_service.extract_and_save_profile(
                user_id=db_user.id, llm=llm
            )

            report = (
                "✅ اطلاعات شما با موفقیت ذخیره و پروفایل اولیه تشکیل شد!\n\n"
                f"💼 شغل: {profile.occupation or 'مشخص نشده'}\n"
                f"⏰ برنامه کاری: {profile.work_schedule or 'مشخص نشده'}\n"
                f"🌙 ساعات خواب: {profile.sleep_schedule or 'مشخص نشده'}\n"
                f"🎯 ترجیحات: {profile.preferences or 'مشخص نشده'}\n\n"
                "اکنون دستیار شخصی برای مدیریت کارهای روزمره در دسترس شماست."
            )
            await update.message.reply_text(report)
        except Exception as e:
            logger.error(f"Error during profile extraction: {e}", exc_info=True)
            await update.message.reply_text(
                "خطایی در استخراج اطلاعات رخ داد. لطفاً مجدداً تلاش کنید."
            )


async def text_message_handler(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    """Route text messages to active onboarding conversation or general assistant."""
    if not update.message or not update.message.text:
        return

    user = update.effective_user
    if not user:
        return

    incoming_text = update.message.text.strip()

    with SessionLocal() as db:
        db_user = get_user_by_telegram_id(db, user.id)
        if not db_user or not db_user.is_active:
            await update.message.reply_text(
                "حساب کاربری شما فعال نیست یا تایید نشده است."
            )
            return

        onboarding_service = OnboardingService(db)
        session = onboarding_service.get_active_session(db_user.id)

        # Active onboarding session route
        if session:
            # Send typing action
            await context.bot.send_chat_action(
                chat_id=update.effective_chat.id, action="typing"
            )

            llm = LLMService()
            response_text = await onboarding_service.process_user_message(
                user_id=db_user.id,
                content=incoming_text,
                llm=llm,
            )
            await update.message.reply_text(response_text)
            return

        # General flow for completed onboarding
        await update.message.reply_text(
            "برای ثبت و مدیریت کارها و عادت‌ها از فرمان‌های بات استفاده کنید. /help را بفرستید."
        )


async def admin_callback_handler(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    """Handle admin approve/reject callbacks."""
    query = update.callback_query
    if not query or not query.data:
        return

    if query.from_user.id not in settings.allowed_telegram_users:
        logger.warning(
            "Rejected access-management callback from unauthorized Telegram user %s.",
            query.from_user.id,
        )
        await query.answer("این عملیات فقط برای مدیر مجاز است.", show_alert=True)
        return

    action, separator, target_text = query.data.partition("_")
    if not separator or action not in {"approve", "reject"}:
        await query.answer("درخواست نامعتبر است.", show_alert=True)
        return

    try:
        target_tg_id = int(target_text)
    except ValueError:
        await query.answer("شناسهٔ کاربر نامعتبر است.", show_alert=True)
        return

    await query.answer()

    if action == "approve":
        with SessionLocal() as db:
            user = approve_user(db, target_tg_id)
            approved_user = (user.full_name, user.telegram_id) if user else None

        if approved_user is None:
            await query.edit_message_text("کاربر موردنظر پیدا نشد.")
            return

        approved_name, approved_telegram_id = approved_user
        await query.edit_message_text(
            f"کاربر {approved_name or approved_telegram_id} "
            f"({approved_telegram_id}) با موفقیت تأیید شد."
        )
        try:
            await context.bot.send_message(
                chat_id=approved_telegram_id,
                text="دسترسی شما تأیید شد! برای شروع دستور /start را ارسال کنید.",
            )
        except TelegramError:
            logger.exception(
                "Failed to notify approved Telegram user %s.",
                approved_telegram_id,
            )
    else:
        with SessionLocal() as db:
            rejected_user = reject_user(db, target_tg_id)

        if rejected_user is None:
            await query.edit_message_text("کاربر موردنظر پیدا نشد.")
            return

        rejected_telegram_id, rejected_name = rejected_user
        await query.edit_message_text(
            f"درخواست کاربر {rejected_name or rejected_telegram_id} "
            f"({rejected_telegram_id}) رد شد."
        )


async def setup_forum_topics_handler(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    """Create required forum topics in the supergroup."""
    chat = update.effective_chat
    if not chat or chat.type != "supergroup":
        if update.message:
            await update.message.reply_text(
                "این دستور فقط در سوپرگروه‌های تلگرام قابل اجرا است."
            )
        return

    try:
        created_topics = await topic_service.setup_default_topics(
            bot=context.bot, chat_id=chat.id
        )
        msg_lines = ["تاپیک‌های زیر ایجاد شدند یا از قبل موجود بودند:"]
        for key, tid in created_topics.items():
            msg_lines.append(f"- {key}: Topic ID {tid}")
        if update.message:
            await update.message.reply_text("\n".join(msg_lines))
    except Exception as e:
        logger.error(f"Error in setup_forum_topics_handler: {e}")
        if update.message:
            await update.message.reply_text(
                f"خطا در ایجاد تاپیک‌ها: {e}"
            )
