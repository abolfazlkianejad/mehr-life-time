"""Telegram consent, private workspace, and task planner interface."""

from __future__ import annotations

import json
import io
import logging
import re
from datetime import datetime, time, timedelta, timezone
from pathlib import PurePosixPath
from typing import Any

from sqlalchemy.orm import Session
from docx import Document
from pypdf import PdfReader
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup, Update
from telegram.constants import ChatMemberStatus, ChatType
from telegram.error import TelegramError
from telegram.ext import ContextTypes

from app.core.time_utils import as_utc
from app.db.base import User
from app.db.session import SessionLocal
from app.modules.onboarding.service import OnboardingService
from app.modules.planning.assistant import PlanningAssistant, parse_deadline
from app.modules.planning.models import (
    LifeArea,
    PlannedTask,
    TelegramWorkspace,
    UserConsent,
    UserMemory,
)
from app.modules.planning.service import PlanningService, user_timezone
from app.services.llm import LLMService
from app.services.secure_telegram_session import SecureSessionError
from app.services.telegram_topics import topic_service
from app.services.telegram_workspace_creator import (
    WorkspaceCreatorUnavailable,
    telegram_workspace_creator,
)

logger = logging.getLogger("mehr_life_time.bot.planner_ui")
TERMS_VERSION = "2026-10-11"

BTN_ADD = "➕ افزودن تسک/هدف"
BTN_WEEK = "📅 برنامهٔ هفتگی"
BTN_START = "▶️ شروع یا اتمام تسک"
BTN_PROGRESS = "📈 پیشرفت و گزارش"
BTN_AREAS = "🗂 حوزه‌های من"
BTN_REVOKE = "🔒 لغو رضایت AI"
HOME_KEYBOARD = ReplyKeyboardMarkup(
    [[BTN_ADD, BTN_WEEK], [BTN_START, BTN_PROGRESS], [BTN_AREAS, BTN_REVOKE]],
    resize_keyboard=True,
    is_persistent=True,
    input_field_placeholder="پیام بده یا یکی از گزینه‌ها را بزن",
)

TERMS_TEXT = (
    "پیش از ادامه، لطفاً این موارد را بخوانید و فعالانه انتخاب کنید.\n\n"
    "با پذیرش، پاسخ‌های معارفه، پیام‌های مربوط به برنامه‌ریزی و ثبت زمان شروع/پایان کارها "
    "برای ساخت حافظه و الگوی شخصی شما به هوش مصنوعی محلی سامانه داده می‌شود تا برنامه‌های "
    "بعدی با اولویت‌ها و زمان واقعی‌تان تطبیق پیدا کند. محتوای گفتگو و فایل‌ها از این بات "
    "به سرویس هوش مصنوعی یا وبِ بیرونی ارسال نمی‌شود.\n\n"
    "حساب اختصاصی سامانه، سازنده و مالک گروه خصوصی شما می‌ماند و برای راه‌اندازی بات و "
    "مدیریت تاپیک‌ها در گروه حضور دارد. نشست این حساب به‌صورت رمزگذاری‌شده روی سرور ذخیره می‌شود.\n\n"
    "هر زمان بخواهید می‌توانید از دکمهٔ «لغو رضایت AI» استفاده کنید؛ پردازش هوش مصنوعی "
    "و حافظهٔ شخصی متوقف و حافظهٔ خلاصه‌شده پاک می‌شود."
)


def _consent_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("می‌پذیرم و ادامه می‌دهم", callback_data="terms_accept"),
        InlineKeyboardButton("فعلاً نمی‌پذیرم", callback_data="terms_decline"),
    ]])


def _user(db: Session, telegram_id: int) -> User | None:
    value = db.query(User).filter(User.telegram_id == telegram_id).first()
    return value if value and value.is_active else None


def _consent(db: Session, user_id: int) -> UserConsent | None:
    return db.query(UserConsent).filter(UserConsent.user_id == user_id).first()


def consent_is_current(db: Session, user_id: int) -> bool:
    value = _consent(db, user_id)
    return bool(value and value.accepted and value.terms_version == TERMS_VERSION)


def _save_consent(db: Session, user_id: int) -> None:
    value = _consent(db, user_id)
    if value is None:
        value = UserConsent(
            user_id=user_id,
            accepted=True,
            terms_version=TERMS_VERSION,
            accepted_at=datetime.now(timezone.utc),
        )
        db.add(value)
    value.accepted = True
    value.terms_version = TERMS_VERSION
    value.accepted_at = datetime.now(timezone.utc)
    db.commit()


async def show_entrypoint(
    context: ContextTypes.DEFAULT_TYPE,
    user_id: int,
    telegram_id: int,
) -> None:
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if not user:
            return
        if not consent_is_current(db, user.id):
            await context.bot.send_message(
                chat_id=telegram_id,
                text=TERMS_TEXT,
                reply_markup=_consent_keyboard(),
            )
            return
        workspace = PlanningService(db).get_workspace(user.id)
        if workspace and workspace.chat_id:
            if workspace.status == "active":
                await context.bot.send_message(
                    chat_id=telegram_id,
                    text=(
                        "گروه اختصاصی شما آماده است؛ وارد آن شوید و از کیبورد پایین استفاده کنید.\n"
                        f"{workspace.invite_link or ''}"
                    ),
                    reply_markup=HOME_KEYBOARD,
                )
                return
            if workspace.bot_added and workspace.user_joined:
                try:
                    await _activate_workspace(context, db, user, workspace)
                except Exception:
                    logger.exception("Could not finish workspace setup for user %s.", user.id)
                    await context.bot.send_message(
                        chat_id=telegram_id,
                        text="گروه ساخته شده، اما تنظیم تاپیک‌ها کامل نشد. مدیر سامانه باید گروه را بررسی کند.",
                    )
                return
        if workspace and workspace.invite_link:
            await context.bot.send_message(
                chat_id=telegram_id,
                text=f"برای تکمیل راه‌اندازی وارد گروه خصوصی خود شوید:\n{workspace.invite_link}",
            )
            return
        await _create_workspace(context, user)


async def _create_workspace(context: ContextTypes.DEFAULT_TYPE, user: User) -> None:
    try:
        ready = await telegram_workspace_creator.ensure_connected()
        if not ready:
            raise WorkspaceCreatorUnavailable("Account session is not ready.")
        bot_info = await context.bot.get_me()
        created = await telegram_workspace_creator.create_workspace(
            full_name=user.full_name or "کاربر",
            telegram_username=user.username,
            bot_username=bot_info.username or "",
        )
    except (WorkspaceCreatorUnavailable, SecureSessionError, ImportError):
        logger.exception("System Telegram account is unavailable.")
        await context.bot.send_message(
            chat_id=user.telegram_id,
            text=(
                "اتصال حساب اختصاصی سامانه آماده نیست. مدیر باید نشست رمزگذاری‌شده، "
                "API تلگرام و نام کاربری بات را تنظیم کند؛ بعد دوباره /start را بفرستید."
            ),
        )
        return
    except Exception:
        logger.exception("Could not create Telegram workspace for user %s.", user.id)
        await context.bot.send_message(
            chat_id=user.telegram_id,
            text="تلگرام در ساخت یا تنظیم گروه خطا داد؛ مدیر سامانه باید حساب اختصاصی را بررسی کند.",
        )
        return

    with SessionLocal() as db:
        current = db.get(User, user.id)
        if not current or not current.is_active or not consent_is_current(db, user.id):
            return
        workspace = TelegramWorkspace(
            user_id=user.id,
            chat_id=created.chat_id,
            invite_link=created.invite_link,
            status="creating",
            bot_added=created.bot_added,
            user_joined=created.user_added,
        )
        db.add(workspace)
        db.commit()
        db.refresh(workspace)
        if workspace.bot_added and workspace.user_joined:
            await _activate_workspace(context, db, current, workspace)
            await context.bot.send_message(
                chat_id=user.telegram_id,
                text=(
                    f"گروه اختصاصی «{created.title}» ساخته شد و آمادهٔ استفاده است.\n"
                    f"{created.invite_link}"
                ),
            )
            return
        workspace.status = "awaiting_join" if not workspace.user_joined else "awaiting_bot"
        db.commit()
        text = f"گروه خصوصی «{created.title}» ساخته شد؛ برای ادامه وارد شوید:\n{created.invite_link}"
        if not workspace.bot_added:
            text += "\n\nپس از ورود، بات را به گروه اضافه کنید تا بتواند تاپیک‌ها و برنامه‌ها را مدیریت کند."
        await context.bot.send_message(chat_id=user.telegram_id, text=text)


async def _activate_workspace(
    context: ContextTypes.DEFAULT_TYPE,
    db: Session,
    user: User,
    workspace: TelegramWorkspace,
) -> None:
    if not workspace.chat_id or not workspace.bot_added or not workspace.user_joined:
        workspace.status = "awaiting_join" if not workspace.user_joined else "awaiting_bot"
        db.commit()
        return
    area = db.query(LifeArea).filter(
        LifeArea.user_id == user.id,
        LifeArea.key == "assistant",
    ).first()
    if area and area.topic_id:
        thread_id = area.topic_id
    else:
        thread_id = await topic_service.create_topic(
            context.bot,
            workspace.chat_id,
            "معارفه و دستیار",
        )
        if area:
            area.topic_id = thread_id
        else:
            db.add(LifeArea(
                user_id=user.id,
                key="assistant",
                title="دستیار",
                topic_id=thread_id,
                details="{}",
                intake_status="complete",
            ))
        db.commit()

    workspace.status = "active"
    workspace.activated_at = datetime.now(timezone.utc)
    db.commit()

    onboarding = OnboardingService(db)
    if onboarding.is_onboarding_completed(user.id):
        await context.bot.send_message(
            chat_id=workspace.chat_id,
            message_thread_id=thread_id,
            text="خوش آمدی! دکمه‌های پایین برای هدف‌ها، برنامهٔ هفتگی و ثبت زمان آماده‌اند.",
            reply_markup=HOME_KEYBOARD,
        )
        return
    onboarding.create_session(user.id)
    await context.bot.send_message(
        chat_id=workspace.chat_id,
        message_thread_id=thread_id,
        text=(
            "برای ساخت برنامهٔ شخصی چند سؤال تطبیقی می‌پرسم: حدود ۲۰ سؤال و در صورت نیاز "
            "حداکثر ۳۰ سؤال. لطفاً ساعت‌ها، اولویت‌ها و کارهای باقی‌مانده را دقیق بگو."
        ),
    )
    try:
        question = await onboarding.start_conversation(user.id, LLMService())
        await context.bot.send_message(
            chat_id=workspace.chat_id,
            message_thread_id=thread_id,
            text=question.replace("[PROFILE_READY]", "").strip(),
        )
    except Exception:
        logger.exception("Could not start onboarding for user %s.", user.id)
        await context.bot.send_message(
            chat_id=workspace.chat_id,
            message_thread_id=thread_id,
            text="مدل محلی هوش مصنوعی در دسترس نیست؛ اتصال Ollama را بررسی کنید و دوباره پیام بدهید.",
        )


async def consent_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query or query.data not in {"terms_accept", "terms_decline"}:
        return
    with SessionLocal() as db:
        user = _user(db, query.from_user.id)
        if not user:
            await query.answer("ابتدا باید مدیر دسترسی شما را تأیید کند.", show_alert=True)
            return
        if query.data == "terms_decline":
            await query.answer("برای استفاده باید رضایت بدهید.", show_alert=True)
            await query.edit_message_text("رضایت ثبت نشد. هر زمان آماده بودید /start را بفرستید.")
            return
        _save_consent(db, user.id)
        await query.answer("رضایت ثبت شد.")
        await query.edit_message_text("رضایت ثبت شد؛ گروه اختصاصی را آماده می‌کنم…")
        await _create_workspace(context, user)


async def workspace_membership_handler(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> None:
    change = update.chat_member or update.my_chat_member
    if not change:
        return
    chat_id = change.chat.id
    member = change.new_chat_member
    changed_id = member.user.id
    new_status = member.status
    is_bot = member.user.is_bot
    is_member = new_status in {
        ChatMemberStatus.MEMBER,
        ChatMemberStatus.ADMINISTRATOR,
        ChatMemberStatus.OWNER,
    }
    with SessionLocal() as db:
        workspace = PlanningService(db).get_workspace_by_chat(chat_id)
        if not workspace:
            return
        user = db.get(User, workspace.user_id)
        if not user:
            return
        if is_bot and changed_id == context.bot.id:
            workspace.bot_added = is_member
        elif not is_bot and changed_id == user.telegram_id:
            workspace.user_joined = is_member
        db.commit()
        if workspace.bot_added and workspace.user_joined and workspace.status != "active":
            try:
                await _activate_workspace(context, db, user, workspace)
            except Exception:
                logger.exception("Workspace activation failed for %s.", chat_id)
                try:
                    await context.bot.send_message(
                        chat_id=user.telegram_id,
                        text="گروه ساخته شده، اما ساخت تاپیک دستیار کامل نشد. مدیر سامانه باید دسترسی بات را بررسی کند.",
                    )
                except TelegramError:
                    logger.exception("Could not notify user %s about workspace setup.", user.id)


def _thread_id(update: Update) -> int | None:
    message = update.effective_message
    return getattr(message, "message_thread_id", None) if message else None


def _area_for_thread(db: Session, user_id: int, thread_id: int | None) -> LifeArea | None:
    if thread_id is None:
        return None
    return db.query(LifeArea).filter(
        LifeArea.user_id == user_id,
        LifeArea.topic_id == thread_id,
    ).first()


async def _task_list(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    user: User,
    workspace: TelegramWorkspace,
) -> None:
    with SessionLocal() as db:
        planner = PlanningService(db)
        tasks = planner.get_week_tasks(user.id)
        if not tasks:
            await update.effective_message.reply_text("تسک بازی ندارید.")
            return
        for task in tasks[:20]:
            area = db.get(LifeArea, task.life_area_id) if task.life_area_id else None
            local = planner.local_datetime(task.scheduled_start)
            label = local.strftime("%m/%d %H:%M") if local else "بدون زمان"
            await context.bot.send_message(
                chat_id=workspace.chat_id,
                message_thread_id=area.topic_id if area else _thread_id(update),
                text=f"{task.title} — {label}",
                reply_markup=InlineKeyboardMarkup([[
                    InlineKeyboardButton("▶️ شروع", callback_data=f"task_start_{task.id}"),
                    InlineKeyboardButton("✅ پایان", callback_data=f"task_finish_{task.id}"),
                ]]),
            )


async def _publish_plan(
    context: ContextTypes.DEFAULT_TYPE,
    user: User,
    workspace: TelegramWorkspace,
    goal_data: dict[str, Any],
    reply: str,
    current_area: LifeArea | None,
) -> tuple[str, int | None, list[int]]:
    domain_title = str(goal_data.get("domain_title") or (current_area.title if current_area else "شخصی"))[:128]
    goal_title = str(goal_data.get("title") or "هدف تازه")[:255]
    is_project = bool(goal_data.get("is_project", False))
    raw_key = str(goal_data.get("domain_key") or domain_title).lower()
    key = re.sub(r"[^\w-]+", "-", raw_key).strip("-")[:56] or "personal"
    if is_project:
        suffix = re.sub(r"[^\w-]+", "-", goal_title.lower()).strip("-")[:36]
        key = f"{key}-{suffix}"[:64]
    with SessionLocal() as db:
        planner = PlanningService(db)
        area = current_area if current_area and not is_project else None
        if area is None:
            area = db.query(LifeArea).filter(
                LifeArea.user_id == user.id,
                LifeArea.key == key,
            ).first()
        if area is None:
            thread = await topic_service.create_topic(
                context.bot,
                workspace.chat_id,
                goal_title if is_project else domain_title,
            )
            area = planner.ensure_area(
                user.id,
                key=key,
                title=goal_title if is_project else domain_title,
                topic_id=thread,
                is_project=is_project,
            )
        elif area.topic_id is None:
            area.topic_id = await topic_service.create_topic(context.bot, workspace.chat_id, area.title)
            db.commit()
        tasks = goal_data.get("tasks", [])
        goal, created_tasks = planner.create_goal(
            user.id,
            title=goal_title,
            description=str(goal_data.get("description") or ""),
            deadline=parse_deadline(goal_data.get("deadline")),
            priority=int(goal_data.get("priority", 3)),
            area_id=area.id,
            tasks=tasks if isinstance(tasks, list) else [],
        )
        unscheduled = planner.unscheduled_tasks(user.id, goal.id)
        lines = [reply or f"برنامهٔ «{goal.title}» آماده شد.", "", f"حوزه: {area.title}"]
        for task in created_tasks:
            local = planner.local_datetime(task.scheduled_start)
            clock = local.strftime("%a %m/%d، %H:%M") if local else "زمان آزاد پیدا نشد"
            lines.append(f"• {clock} — {task.title} ({task.estimated_minutes} دقیقه)")
        if goal.deadline:
            lines.append(f"موعد: {as_utc(goal.deadline).astimezone(user_timezone()).strftime('%Y-%m-%d %H:%M')}")
        if unscheduled:
            lines.extend([
                "",
                "⚠️ با زمان‌های آزاد فعلی همهٔ گام‌ها تا موعد جا نشدند. "
                "پیشنهاد: محدوده را کم کن یا موعد را جابه‌جا کن.",
            ])
        return "\n".join(lines), area.topic_id, [task.id for task in created_tasks]


async def _finish_onboarding(
    context: ContextTypes.DEFAULT_TYPE,
    db: Session,
    user: User,
    workspace: TelegramWorkspace,
    thread_id: int | None,
) -> str:
    profile = await OnboardingService(db).extract_and_save_profile(user.id, LLMService())
    memory = db.query(UserMemory).filter(UserMemory.user_id == user.id).first()
    try:
        facts = json.loads(memory.facts) if memory else {}
    except json.JSONDecodeError:
        facts = {}
    candidates = facts.get("life_areas", []) if isinstance(facts, dict) else []
    if not isinstance(candidates, list):
        candidates = []
    if profile.occupation:
        candidates.append({"key": "work", "title": "کار و شرکت"})
    if profile.education:
        candidates.append({"key": "education", "title": "درس و دانشگاه"})
    created: list[str] = []
    for item in candidates:
        if not isinstance(item, dict) or not item.get("title"):
            continue
        title = str(item["title"]).strip()[:128]
        key = re.sub(r"[^\w-]+", "-", str(item.get("key") or title).lower()).strip("-")[:64]
        if not key or db.query(LifeArea).filter(
            LifeArea.user_id == user.id,
            LifeArea.key == key,
        ).first():
            continue
        topic = await topic_service.create_topic(context.bot, workspace.chat_id, title)
        PlanningService(db).ensure_area(
            user.id,
            key=key,
            title=title,
            topic_id=topic,
            is_project=bool(item.get("is_project", False)),
        )
        created.append(title)
    return (
        "✅ شناخت اولیه تمام شد و برنامه‌ریز حالا اولویت‌ها و محدودیت‌هایت را می‌شناسد.\n"
        f"حوزه‌های ساخته‌شده: {', '.join(created) if created else 'با ثبت هدف ساخته می‌شوند'}.\n\n"
        "برای افزودن هدف یا پروژه از دکمهٔ پایین استفاده کن؛ AI جزئیات لازم را می‌پرسد و بعد برنامه را می‌سازد."
    )


async def user_message_handler(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    *,
    override_text: str | None = None,
) -> None:
    message = update.effective_message
    sender = update.effective_user
    chat = update.effective_chat
    if not message or not sender or not chat:
        return
    text = (override_text if override_text is not None else (message.text or "")).strip()

    with SessionLocal() as db:
        user = _user(db, sender.id)
        if not user:
            await message.reply_text("حساب شما هنوز با تأیید مدیر فعال نشده است.")
            return
        if not consent_is_current(db, user.id):
            if chat.type == ChatType.PRIVATE:
                await message.reply_text(TERMS_TEXT, reply_markup=_consent_keyboard())
            else:
                await message.reply_text("رضایت AI فعال نیست؛ در گفت‌وگوی خصوصی /start را بفرستید.")
            return
        workspace = PlanningService(db).get_workspace(user.id)
        if not workspace or workspace.status != "active" or chat.id != workspace.chat_id:
            if chat.type == ChatType.PRIVATE:
                await message.reply_text("وارد گروه خصوصی خودت شو؛ برای دریافت لینک /start را بفرست.")
            return

        if text == BTN_REVOKE:
            consent = _consent(db, user.id)
            if consent:
                consent.accepted = False
                consent.accepted_at = None
            memory = db.query(UserMemory).filter(UserMemory.user_id == user.id).first()
            if memory:
                db.delete(memory)
            db.commit()
            await message.reply_text("رضایت لغو شد؛ حافظهٔ AI پاک و پردازش هوش مصنوعی متوقف شد.")
            return

        thread_id = _thread_id(update)
        current_area = _area_for_thread(db, user.id, thread_id)
        onboarding = OnboardingService(db)
        session = onboarding.get_active_session(user.id)
        if session:
            try:
                response = await onboarding.process_user_message(
                    user_id=user.id,
                    content=text,
                    llm=LLMService(),
                )
                ready = "[PROFILE_READY]" in response
                await message.reply_text(response.replace("[PROFILE_READY]", "").strip() or "شناخت اولیه کامل شد.")
                if ready:
                    summary = await _finish_onboarding(context, db, user, workspace, thread_id)
                    await context.bot.send_message(
                        chat_id=workspace.chat_id,
                        message_thread_id=thread_id,
                        text=summary,
                        reply_markup=HOME_KEYBOARD,
                    )
            except Exception:
                logger.exception("Onboarding failed for user %s.", user.id)
                await message.reply_text("پردازش پاسخ ناموفق شد؛ لطفاً با جزئیات روشن‌تر دوباره جواب بده.")
            return

        if text == BTN_WEEK:
            planner = PlanningService(db)
            tasks = planner.get_week_tasks(user.id)
            if not tasks:
                await message.reply_text("این هفته برنامه‌ای ثبت نشده؛ از افزودن هدف شروع کن.")
                return
            lines = ["📅 برنامهٔ هفته:"]
            now = datetime.now(user_timezone())
            for task in tasks:
                local = planner.local_datetime(task.scheduled_start)
                label = local.strftime("%a %m/%d، %H:%M") if local else "بدون زمان‌بندی"
                late = local is None or (local < now and task.status != "completed")
                lines.append(f"{'⚠️ عقب‌افتاده | ' if late else ''}{label} — {task.title} ({task.estimated_minutes} دقیقه)")
            await message.reply_text("\n".join(lines), reply_markup=HOME_KEYBOARD)
            return

        if text == BTN_START:
            await _task_list(update, context, user, workspace)
            return

        if text == BTN_PROGRESS:
            summary = PlanningService(db).progress_summary(user.id)
            await message.reply_text(
                f"هدف‌های فعال: {summary['goals']}\nتسک‌های باز: {summary['open']}\n"
                f"تسک‌های انجام‌شده: {summary['completed']}",
                reply_markup=HOME_KEYBOARD,
            )
            return

        if text == BTN_AREAS:
            areas = PlanningService(db).list_areas(user.id)
            await message.reply_text(
                "حوزه‌های شما:\n" + ("\n".join(f"• {area.title}" for area in areas) or "هنوز حوزه‌ای ساخته نشده."),
                reply_markup=HOME_KEYBOARD,
            )
            return

        assistant = PlanningAssistant(db)
        if text == BTN_ADD:
            assistant.begin_intake(user.id, area_title=current_area.title if current_area else None)
            text = ""
        if not text:
            try:
                result = await assistant.handle_text(
                    user_id=user.id,
                    text="",
                    current_area=current_area,
                )
                await message.reply_text(result.get("reply", "جزئیات هدف یا پروژه را بگو."), reply_markup=HOME_KEYBOARD)
            except Exception:
                logger.exception("Could not start goal intake for user %s.", user.id)
                await message.reply_text("مدل محلی AI در دسترس نیست؛ اتصال Ollama را بررسی کنید.")
            return

        try:
            result = await assistant.handle_text(
                user_id=user.id,
                text=text,
                current_area=current_area,
            )
        except Exception:
            logger.exception("Planning AI failed for user %s.", user.id)
            await message.reply_text("مدل محلی AI پاسخ نداد؛ اتصال Ollama را بررسی و دوباره تلاش کن.")
            return
        if result.get("action") != "plan":
            await message.reply_text(result.get("reply", ""), reply_markup=HOME_KEYBOARD)
            return
        try:
            plan_text, plan_thread, task_ids = await _publish_plan(
                context,
                user,
                workspace,
                result["goal"],
                result.get("reply", ""),
                current_area,
            )
            await message.reply_text("برنامه ساخته و در تاپیک حوزهٔ مربوط منتشر شد.")
            await context.bot.send_message(
                chat_id=workspace.chat_id,
                message_thread_id=plan_thread or thread_id,
                text=plan_text,
                reply_markup=HOME_KEYBOARD,
            )
            with SessionLocal() as output_db:
                for task_id in task_ids:
                    task = output_db.query(PlannedTask).filter(
                        PlannedTask.user_id == user.id,
                        PlannedTask.id == task_id,
                    ).first()
                    if not task:
                        continue
                    await context.bot.send_message(
                        chat_id=workspace.chat_id,
                        message_thread_id=plan_thread,
                        text=f"{task.title} — {task.estimated_minutes} دقیقه",
                        reply_markup=InlineKeyboardMarkup([[
                            InlineKeyboardButton("▶️ شروع", callback_data=f"task_start_{task.id}"),
                            InlineKeyboardButton("✅ پایان", callback_data=f"task_finish_{task.id}"),
                        ]]),
                    )
            assistant.clear_intake(user.id)
        except Exception:
            logger.exception("Could not store or publish plan for user %s.", user.id)
            await message.reply_text("ساخت تاپیک یا ذخیرهٔ برنامه انجام نشد؛ لطفاً یک‌بار دیگر درخواست را بفرست.")


async def document_message_handler(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> None:
    message = update.effective_message
    if not message or not message.document:
        return
    document = message.document
    suffix = (document.file_name or "").lower().rsplit(".", 1)[-1]
    if suffix not in {"txt", "md", "csv", "pdf", "docx"}:
        await message.reply_text("فایل‌های متنی، PDF و Word را می‌توانم بخوانم؛ یا متن را اینجا بفرست.")
        return
    if document.file_size and document.file_size > 5 * 1024 * 1024:
        await message.reply_text("فایل از ۵ مگابایت بزرگ‌تر است؛ لطفاً بخش‌های مرتبط را جدا بفرست.")
        return
    try:
        telegram_file = await context.bot.get_file(document.file_id)
        payload = bytes(await telegram_file.download_as_bytearray())
        if suffix in {"txt", "md", "csv"}:
            extracted = payload.decode("utf-8", errors="replace")
        elif suffix == "pdf":
            extracted = "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(payload)).pages)
        else:
            extracted = "\n".join(paragraph.text for paragraph in Document(io.BytesIO(payload)).paragraphs)
    except Exception:
        logger.exception("Could not read uploaded project brief.")
        await message.reply_text("خواندن فایل ممکن نشد؛ لطفاً متن یا جزئیات لازم را بفرست.")
        return
    if len(extracted.strip()) < 100:
        await message.reply_text("در فایل متن کافی پیدا نکردم؛ لطفاً کارهای باقی‌مانده را در پیام توضیح بده.")
        return
    await user_message_handler(
        update,
        context,
        override_text=f"شرح پیوست برای هدف یا پروژه:\n{extracted[:8000]}",
    )


async def planner_callback_handler(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> None:
    query = update.callback_query
    if not query or not query.data:
        return
    if query.data.startswith("terms_"):
        await consent_callback(update, context)
        return
    match = re.fullmatch(r"task_(start|finish|continue)_(\d+)", query.data)
    if not match:
        return
    action, task_text = match.groups()
    with SessionLocal() as db:
        user = _user(db, query.from_user.id)
        if not user or not consent_is_current(db, user.id):
            await query.answer("حساب فعال یا رضایت ثبت‌شده پیدا نشد.", show_alert=True)
            return
        workspace = PlanningService(db).get_workspace(user.id)
        if not workspace or not query.message or query.message.chat.id != workspace.chat_id:
            await query.answer("این دکمه متعلق به فضای شما نیست.", show_alert=True)
            return
        planner = PlanningService(db)
        try:
            task_id = int(task_text)
            if action == "start":
                task = planner.start_task(user.id, task_id)
                answer = f"شروع «{task.title}» ثبت شد."
            elif action == "finish":
                task = planner.finish_task(user.id, task_id)
                answer = f"پایان «{task.title}» و مدت واقعی ثبت شد."
            else:
                task = planner._get_open_task(user.id, task_id)
                answer = f"ادامهٔ «{task.title}» ثبت شد."
        except LookupError:
            await query.answer("این تسک دیگر باز نیست.", show_alert=True)
            return
        await query.answer("ثبت شد.")
        await context.bot.send_message(
            chat_id=workspace.chat_id,
            message_thread_id=getattr(query.message, "message_thread_id", None),
            text=answer,
            reply_markup=HOME_KEYBOARD,
        )
        if action == "finish":
            try:
                await query.edit_message_reply_markup(reply_markup=None)
            except TelegramError:
                pass


async def task_notification_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    """Send start and end-time prompts and move stale tasks to later slots."""
    with SessionLocal() as db:
        planner = PlanningService(db)
        due_notifications = planner.get_due_notifications()
        for task, event in due_notifications:
            workspace = planner.get_workspace(task.user_id)
            consent = _consent(db, task.user_id)
            if not workspace or workspace.status != "active" or not consent or not consent.accepted:
                continue
            area = db.get(LifeArea, task.life_area_id) if task.life_area_id else None
            thread_id = area.topic_id if area else None
            if event == "start":
                body = f"⏰ زمان برنامه‌ریزی‌شدهٔ «{task.title}» شروع شد."
                buttons = [[
                    InlineKeyboardButton("▶️ شروع", callback_data=f"task_start_{task.id}"),
                    InlineKeyboardButton("✅ اتمام", callback_data=f"task_finish_{task.id}"),
                ]]
            else:
                body = f"زمان تخمینی «{task.title}» تمام شد؛ کار به پایان رسید؟"
                buttons = [[
                    InlineKeyboardButton("✅ بله، اتمام", callback_data=f"task_finish_{task.id}"),
                    InlineKeyboardButton("⏳ هنوز ادامه دارد", callback_data=f"task_continue_{task.id}"),
                ]]
            try:
                await context.bot.send_message(
                    chat_id=workspace.chat_id,
                    message_thread_id=thread_id,
                    text=body,
                    reply_markup=InlineKeyboardMarkup(buttons),
                )
            except TelegramError:
                logger.exception("Could not send reminder for task %s.", task.id)
                if event == "start":
                    task.start_notified = False
                    db.commit()

        active_workspaces = db.query(TelegramWorkspace).filter(
            TelegramWorkspace.status == "active"
        ).all()
        for workspace in active_workspaces:
            consent = _consent(db, workspace.user_id)
            if consent and consent.accepted:
                planner.schedule_open_tasks(workspace.user_id)


async def daily_plan_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    """Publish each user's day plan at 06:00 in their area topics."""
    local_today = datetime.now(user_timezone()).date()
    with SessionLocal() as db:
        workspaces = db.query(TelegramWorkspace).filter(
            TelegramWorkspace.status == "active"
        ).all()
        for workspace in workspaces:
            consent = _consent(db, workspace.user_id)
            if not consent or not consent.accepted:
                continue
            planner = PlanningService(db)
            planner.schedule_open_tasks(workspace.user_id)
            open_tasks = planner.get_week_tasks(workspace.user_id)
            grouped: dict[int | None, list[PlannedTask]] = {}
            for task in open_tasks:
                local_start = planner.local_datetime(task.scheduled_start)
                if local_start is None or local_start.date() <= local_today:
                    area = db.get(LifeArea, task.life_area_id) if task.life_area_id else None
                    grouped.setdefault(area.topic_id if area else None, []).append(task)
            if not grouped:
                grouped[None] = []
            for thread_id, tasks in grouped.items():
                lines = ["🌅 برنامهٔ امروز — ساعت ۰۶:۰۰"]
                if not tasks:
                    lines.append("امروز تسکی برنامه‌ریزی نشده است.")
                for task in tasks:
                    local_start = planner.local_datetime(task.scheduled_start)
                    label = local_start.strftime("%H:%M") if local_start and local_start.date() == local_today else "عقب‌افتاده / زمان بعدی"
                    lines.append(f"• {label} — {task.title} ({task.estimated_minutes} دقیقه)")
                try:
                    await context.bot.send_message(
                        chat_id=workspace.chat_id,
                        message_thread_id=thread_id,
                        text="\n".join(lines),
                        reply_markup=HOME_KEYBOARD,
                    )
                    for task in tasks:
                        await context.bot.send_message(
                            chat_id=workspace.chat_id,
                            message_thread_id=thread_id,
                            text=f"{task.title} — {task.estimated_minutes} دقیقه",
                            reply_markup=InlineKeyboardMarkup([[
                                InlineKeyboardButton("▶️ شروع", callback_data=f"task_start_{task.id}"),
                                InlineKeyboardButton("✅ پایان", callback_data=f"task_finish_{task.id}"),
                            ]]),
                        )
                except TelegramError:
                    logger.exception("Could not publish today's plan in %s.", workspace.chat_id)


async def weekly_overview_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    """Send last week's completion count and this week's scheduled work."""
    tz = user_timezone()
    with SessionLocal() as db:
        workspaces = db.query(TelegramWorkspace).filter(
            TelegramWorkspace.status == "active"
        ).all()
        for workspace in workspaces:
            consent = _consent(db, workspace.user_id)
            if not consent or not consent.accepted:
                continue
            planner = PlanningService(db)
            planner.schedule_open_tasks(workspace.user_id)
            now = datetime.now(tz)
            saturday = now.date() - timedelta(days=(now.weekday() - 5) % 7)
            previous_start = datetime.combine(saturday - timedelta(days=7), time.min, tzinfo=tz)
            current_start = datetime.combine(saturday, time.min, tzinfo=tz)
            completed = db.query(PlannedTask).filter(
                PlannedTask.user_id == workspace.user_id,
                PlannedTask.status == "completed",
                PlannedTask.completed_at.is_not(None),
            ).all()
            previous_count = sum(
                1
                for task in completed
                if previous_start <= as_utc(task.completed_at).astimezone(tz) < current_start
            )
            upcoming = planner.get_week_tasks(workspace.user_id)
            lines = [
                "📊 مرور هفتهٔ گذشته و برنامهٔ هفتهٔ پیش رو",
                f"هفتهٔ گذشته: {previous_count} تسک تکمیل شد.",
                    "برنامهٔ هفتهٔ پیشِ رو:",
            ]
            if upcoming:
                for task in upcoming:
                    start = planner.local_datetime(task.scheduled_start)
                    label = start.strftime("%a %m/%d، %H:%M") if start else "زمان‌بندی نشده"
                    lines.append(f"• {label} — {task.title}")
            else:
                lines.append("هنوز تسکی برنامه‌ریزی نشده است.")
            try:
                await context.bot.send_message(
                    chat_id=workspace.chat_id,
                    text="\n".join(lines),
                    reply_markup=HOME_KEYBOARD,
                )
            except TelegramError:
                logger.exception("Could not send weekly overview for %s.", workspace.chat_id)
