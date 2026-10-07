"""
Telegram bot command handlers and message processing logic.
Integrates user registration, access control, Life OS forum topics,
and the AI Onboarding conversation workflow.
"""

import logging
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
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

logger = logging.getLogger(__name__)


async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /start command with role and onboarding state awareness."""
    user = update.effective_user
    if not user:
        return

    telegram_id = user.id
    username = user.username
    full_name = user.full_name or "کاربر ناشناس"

    with SessionLocal() as db:
        db_user = get_user_by_telegram_id(db, telegram_id)

        # Logic for new users (Registration)
        if not db_user:
            db_user = register_user(
                db=db,
                telegram_id=telegram_id,
                username=username,
                full_name=full_name,
                role="user",
            )
            admin_msg = (
                f"کاربر جدید درخواست دسترسی داده است:\n"
                f"نام: {full_name}\n"
                f"شناسه کاربری: @{username if username else 'ندارد'}\n"
                f"شناسه تلگرام: {telegram_id}"
            )
            keyboard = [
                [
                    InlineKeyboardButton(
                        "تایید دسترسی", callback_data=f"approve_{telegram_id}"
                    ),
                    InlineKeyboardButton(
                        "رد دسترسی", callback_data=f"reject_{telegram_id}"
                    ),
                ]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)

            if settings.TELEGRAM_ADMIN_CHAT_ID:
                await context.bot.send_message(
                    chat_id=settings.TELEGRAM_ADMIN_CHAT_ID,
                    text=admin_msg,
                    reply_markup=reply_markup,
                )

            await update.message.reply_text(
                "سلام! درخواست دسترسی شما ثبت شد و پس از تایید ادمین فعال خواهد شد."
            )
            return

        # Logic for existing, but inactive users (Re-notification)
        if not db_user.is_active:
            admin_msg = (
                f"⚠️ یادآوری: کاربر {full_name} (@{username if username else 'ندارد'}) "
                f"مجدداً درخواست دسترسی کرده است.\n"
                f"شناسه تلگرام: {telegram_id}"
            )
            keyboard = [
                [
                    InlineKeyboardButton(
                        "تایید دسترسی", callback_data=f"approve_{telegram_id}"
                    ),
                    InlineKeyboardButton(
                        "رد دسترسی", callback_data=f"reject_{telegram_id}"
                    ),
                ]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)

            if settings.TELEGRAM_ADMIN_CHAT_ID:
                await context.bot.send_message(
                    chat_id=settings.TELEGRAM_ADMIN_CHAT_ID,
                    text=admin_msg,
                    reply_markup=reply_markup,
                )

            await update.message.reply_text(
                "حساب کاربری شما هنوز تایید نشده است. درخواست شما مجدداً برای ادمین ارسال شد."
            )
            return

        # Check onboarding status
        onboarding_service = OnboardingService(db)
        if not onboarding_service.is_onboarding_completed(db_user.id):
            session = onboarding_service.get_active_session(db_user.id)
            if not session:
                onboarding_service.create_session(db_user.id)

            welcome_msg = (
                f"سلام {full_name} عزیز، به سیستم مدیریت زندگی و کار خوش آمدید!\n\n"
                "برای اینکه دستیار شخصی‌تان بتواند برنامه‌ریزی دقیقی برای شما انجام دهد، "
                "یک گفت‌وگوی کوتاه چند دقیقه‌ای برای آشنایی با اهداف و سبک زندگی شما خواهیم داشت.\n\n"
                "می‌توانید با یک معرفی کوتاه از شغل یا فعالیت روزمره‌تان شروع کنید. "
                "(هر زمان خواستید فرآیند جمع‌بندی شود، دستور /finish_onboarding را ارسال کنید.)"
            )
            await update.message.reply_text(welcome_msg)
            return

        await update.message.reply_text(
            f"خوش آمدید {full_name}! سیستم مدیریت هوشمند آماده است."
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
            "پیام شما دریافت شد. (ماژول‌های وظایف و ثبت عادت‌ها در گام‌های بعدی فعال می‌شوند)"
        )


async def admin_callback_handler(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    """Handle admin approve/reject callbacks."""
    query = update.callback_query
    if not query or not query.data:
        return

    await query.answer()
    data = query.data

    if data.startswith("approve_"):
        target_tg_id = int(data.split("_")[1])
        with SessionLocal() as db:
            user = approve_user(db, target_tg_id)
            if user:
                await query.edit_message_text(
                    f"کاربر {user.full_name} ({user.telegram_id}) با موفقیت تایید شد."
                )
                try:
                    await context.bot.send_message(
                        chat_id=target_tg_id,
                        text="دسترسی شما تایید شد! برای شروع دستور /start را ارسال کنید.",
                    )
                except Exception as e:
                    logger.warning(
                        f"Failed to notify user {target_tg_id} directly: {e}"
                    )
    elif data.startswith("reject_"):
        target_tg_id = int(data.split("_")[1])
        with SessionLocal() as db:
            user = reject_user(db, target_tg_id)
            if user:
                await query.edit_message_text(
                    f"درخواست کاربر {user.full_name} ({user.telegram_id}) رد شد."
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
