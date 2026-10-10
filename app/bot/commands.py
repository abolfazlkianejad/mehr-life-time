"""Telegram command adapters for work and lifestyle services."""

from __future__ import annotations

import logging

from telegram import Update
from telegram.ext import ContextTypes

from app.bot.security import restricted
from app.db.session import SessionLocal
from app.modules.lifestyle.service import LifestyleService
from app.modules.reports.service import ReportService
from app.modules.work.service import TaskService, WorkSessionService

logger = logging.getLogger("mehr_life_time.bot.commands")
PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩"
ASCII_DIGITS = "01234567890123456789"
DIGIT_TRANSLATION = str.maketrans(PERSIAN_DIGITS, ASCII_DIGITS)


def _normalize_number(value: str) -> str:
    """Convert Persian and Arabic digits and decimal separators to ASCII."""
    return value.translate(DIGIT_TRANSLATION).replace("٫", ".").replace("٬", "")


def _split_pipe_fields(
    args: list[str],
    *,
    minimum_fields: int,
    maximum_fields: int,
) -> list[str]:
    """Parse a command argument string separated by vertical bars."""
    fields = [field.strip() for field in " ".join(args).split("|")]
    if not minimum_fields <= len(fields) <= maximum_fields:
        raise ValueError("تعداد بخش‌های ورودی درست نیست.")
    return fields


async def _reply(update: Update, text: str) -> None:
    """Reply to an update when it contains a message."""
    message = update.effective_message
    if message is not None:
        await message.reply_text(text)


def _telegram_id(update: Update) -> int | None:
    """Return the Telegram user ID associated with an update."""
    user = update.effective_user
    return user.id if user is not None else None


def _format_minutes(minutes: int) -> str:
    """Format a nonnegative minute count in Persian-friendly units."""
    hours, remaining_minutes = divmod(max(0, minutes), 60)
    if hours:
        return f"{hours} ساعت و {remaining_minutes} دقیقه"
    return f"{remaining_minutes} دقیقه"


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show supported work and lifestyle commands."""
    await _reply(
        update,
        "فرمان‌های سیستم:\n"
        "/task عنوان وظیفه — ثبت وظیفه\n"
        "/tasks — نمایش وظایف باز\n"
        "/done شناسه — تکمیل وظیفه\n"
        "/work_start [شناسه وظیفه] — شروع ثبت زمان\n"
        "/work_stop [یادداشت] — پایان ثبت زمان\n"
        "/sleep ساعت [کیفیت ۱ تا ۱۰] — ثبت خواب\n"
        "/meal نوع | شرح | کالری — ثبت وعده\n"
        "/workout نوع | دقیقه | شدت — ثبت تمرین\n"
        "/recovery نوع | دقیقه | کیفیت | یادداشت — ثبت ریکاوری\n"
        "/report [ساعت، حداکثر ۱۶۸] — گزارش بازه‌ای\n"
        "/finish_onboarding — ساخت پروفایل اولیه",
    )


@restricted
async def task_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Create a task from the command's remaining text."""
    telegram_id = _telegram_id(update)
    title = " ".join(context.args or []).strip()
    if telegram_id is None:
        return
    if not title:
        await _reply(update, "عنوان وظیفه را پس از فرمان بنویسید؛ نمونه: /task ارسال گزارش")
        return

    try:
        with SessionLocal() as db:
            task = TaskService(db).create_task(telegram_id, title)
    except ValueError:
        await _reply(update, "عنوان وظیفه معتبر نیست یا از ۲۵۵ نویسه بیشتر است.")
        return
    except Exception:
        logger.exception("Could not create a task for Telegram user %s.", telegram_id)
        await _reply(update, "ثبت وظیفه انجام نشد. لطفاً دوباره تلاش کنید.")
        return

    await _reply(update, f"وظیفهٔ «{task.title}» با شناسهٔ {task.id} ثبت شد.")


@restricted
async def tasks_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """List a user's pending tasks."""
    telegram_id = _telegram_id(update)
    if telegram_id is None:
        return

    try:
        with SessionLocal() as db:
            tasks = TaskService(db).list_tasks(telegram_id)
    except Exception:
        logger.exception("Could not list tasks for Telegram user %s.", telegram_id)
        await _reply(update, "نمایش وظایف انجام نشد. لطفاً دوباره تلاش کنید.")
        return
    if not tasks:
        await _reply(update, "وظیفهٔ بازی ندارید.")
        return

    lines = [
        f"{task.id}. [{task.priority}] {task.title}"
        for task in tasks
    ]
    await _reply(update, "وظایف باز:\n" + "\n".join(lines))


@restricted
async def done_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Mark a user's pending task as completed."""
    telegram_id = _telegram_id(update)
    args = context.args or []
    if telegram_id is None:
        return
    if len(args) != 1:
        await _reply(update, "شناسهٔ وظیفه را وارد کنید؛ نمونه: /done 12")
        return

    try:
        task_id = int(_normalize_number(args[0]))
        with SessionLocal() as db:
            task = TaskService(db).complete_task(telegram_id, task_id)
    except ValueError as exc:
        message = (
            "این وظیفه فقط در حالت باز قابل تکمیل است."
            if "pending" in str(exc)
            else "شناسهٔ وظیفه باید عدد باشد."
        )
        await _reply(update, message)
        return
    except LookupError:
        await _reply(update, "وظیفهٔ بازی با این شناسه پیدا نشد.")
        return
    except Exception:
        logger.exception("Could not complete task for Telegram user %s.", telegram_id)
        await _reply(update, "تکمیل وظیفه انجام نشد. لطفاً دوباره تلاش کنید.")
        return

    await _reply(update, f"وظیفهٔ «{task.title}» تکمیل شد.")


@restricted
async def work_start_command(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> None:
    """Start a work session, optionally linked to one pending task."""
    telegram_id = _telegram_id(update)
    args = context.args or []
    if telegram_id is None:
        return
    if len(args) > 1:
        await _reply(update, "نمونه: /work_start یا /work_start 12")
        return

    try:
        task_id = int(_normalize_number(args[0])) if args else None
        with SessionLocal() as db:
            session = WorkSessionService(db).start_session(
                telegram_id,
                task_id=task_id,
            )
    except ValueError as exc:
        message = (
            "یک نشست کاری فعال دارید؛ ابتدا آن را با /work_stop پایان دهید."
            if "already active" in str(exc)
            else "شناسهٔ وظیفه باید عدد باشد."
        )
        await _reply(update, message)
        return
    except LookupError:
        await _reply(update, "وظیفهٔ باز با این شناسه پیدا نشد.")
        return
    except Exception:
        logger.exception("Could not start work session for Telegram user %s.", telegram_id)
        await _reply(update, "شروع ثبت زمان انجام نشد. لطفاً دوباره تلاش کنید.")
        return

    await _reply(update, f"ثبت زمان شروع شد. شناسهٔ نشست: {session.id}")


@restricted
async def work_stop_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Stop the active work session and save an optional note."""
    telegram_id = _telegram_id(update)
    if telegram_id is None:
        return

    try:
        summary = " ".join(context.args or []).strip() or None
        with SessionLocal() as db:
            session = WorkSessionService(db).stop_session(
                telegram_id,
                summary=summary,
            )
    except LookupError:
        await _reply(update, "نشست کاری فعالی برای پایان دادن پیدا نشد.")
        return
    except Exception:
        logger.exception("Could not stop work session for Telegram user %s.", telegram_id)
        await _reply(update, "پایان ثبت زمان انجام نشد. لطفاً دوباره تلاش کنید.")
        return

    await _reply(
        update,
        f"ثبت زمان پایان یافت؛ مدت: {_format_minutes(session.duration_minutes or 0)}.",
    )


@restricted
async def sleep_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Record sleep duration and optional quality score."""
    telegram_id = _telegram_id(update)
    args = context.args or []
    if telegram_id is None:
        return
    if not 1 <= len(args) <= 2:
        await _reply(update, "نمونه: /sleep 7.5 8 — مدت خواب و کیفیت از ۱ تا ۱۰")
        return

    try:
        duration_hours = float(_normalize_number(args[0]).replace(",", "."))
        quality_score = int(_normalize_number(args[1])) if len(args) == 2 else None
        with SessionLocal() as db:
            sleep = LifestyleService(db).record_sleep(
                telegram_id,
                duration_hours,
                quality_score=quality_score,
            )
    except ValueError as exc:
        message = (
            "مدت خواب باید بیشتر از صفر و حداکثر ۲۴ ساعت باشد؛ کیفیت نیز باید بین ۱ تا ۱۰ باشد."
            if "Sleep duration" in str(exc) or "Quality score" in str(exc)
            else "مدت و کیفیت خواب باید عدد باشند."
        )
        await _reply(update, message)
        return
    except Exception:
        logger.exception("Could not record sleep for Telegram user %s.", telegram_id)
        await _reply(update, "ثبت خواب انجام نشد. لطفاً دوباره تلاش کنید.")
        return

    quality_text = f"؛ کیفیت {sleep.quality_score} از ۱۰" if sleep.quality_score else ""
    await _reply(update, f"خواب به مدت {sleep.duration_hours:g} ساعت ثبت شد{quality_text}.")


@restricted
async def meal_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Record a meal using type, description, and optional calories."""
    telegram_id = _telegram_id(update)
    if telegram_id is None:
        return
    try:
        fields = _split_pipe_fields(
            context.args or [],
            minimum_fields=2,
            maximum_fields=3,
        )
        calories = int(_normalize_number(fields[2])) if len(fields) == 3 and fields[2] else None
        with SessionLocal() as db:
            meal = LifestyleService(db).record_meal(
                telegram_id,
                fields[0],
                fields[1],
                calories=calories,
            )
    except ValueError:
        await _reply(
            update,
            "قالب وعده: /meal نوع | شرح | کالری اختیاری؛ کالری باید بین صفر تا ۱۰۰۰۰ باشد.",
        )
        return
    except Exception:
        logger.exception("Could not record meal for Telegram user %s.", telegram_id)
        await _reply(update, "ثبت وعده انجام نشد. لطفاً دوباره تلاش کنید.")
        return

    calorie_text = f" ({meal.calories} کیلوکالری)" if meal.calories is not None else ""
    await _reply(update, f"وعدهٔ «{meal.meal_type}» ثبت شد{calorie_text}.")


@restricted
async def workout_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Record a workout using type, duration, and optional intensity."""
    telegram_id = _telegram_id(update)
    if telegram_id is None:
        return
    try:
        fields = _split_pipe_fields(
            context.args or [],
            minimum_fields=2,
            maximum_fields=3,
        )
        duration_minutes = int(_normalize_number(fields[1]))
        intensity = fields[2] if len(fields) == 3 and fields[2] else None
        with SessionLocal() as db:
            workout = LifestyleService(db).record_workout(
                telegram_id,
                fields[0],
                duration_minutes,
                intensity=intensity,
            )
    except ValueError:
        await _reply(
            update,
            "قالب تمرین: /workout نوع | دقیقه | شدت اختیاری؛ مدت ۱ تا ۱۴۴۰ و شدت کم، متوسط یا زیاد باشد.",
        )
        return
    except Exception:
        logger.exception("Could not record workout for Telegram user %s.", telegram_id)
        await _reply(update, "ثبت تمرین انجام نشد. لطفاً دوباره تلاش کنید.")
        return

    await _reply(
        update,
        f"تمرین «{workout.workout_type}» به مدت "
        f"{_format_minutes(workout.duration_minutes)} ثبت شد.",
    )


@restricted
async def recovery_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Record a recovery activity with optional duration, quality, and note."""
    telegram_id = _telegram_id(update)
    if telegram_id is None:
        return
    try:
        fields = _split_pipe_fields(
            context.args or [],
            minimum_fields=1,
            maximum_fields=4,
        )
        duration_minutes = (
            int(_normalize_number(fields[1]))
            if len(fields) > 1 and fields[1]
            else None
        )
        quality_score = (
            int(_normalize_number(fields[2]))
            if len(fields) > 2 and fields[2]
            else None
        )
        notes = fields[3] if len(fields) > 3 and fields[3] else None
        with SessionLocal() as db:
            recovery = LifestyleService(db).record_recovery(
                telegram_id,
                fields[0],
                duration_minutes=duration_minutes,
                quality_score=quality_score,
                notes=notes,
            )
    except ValueError:
        await _reply(
            update,
            "اطلاعات ریکاوری معتبر نیست؛ مدت باید ۱ تا ۱۴۴۰ دقیقه و کیفیت ۱ تا ۱۰ باشد.",
        )
        return
    except Exception:
        logger.exception("Could not record recovery for Telegram user %s.", telegram_id)
        await _reply(update, "ثبت ریکاوری انجام نشد. لطفاً دوباره تلاش کنید.")
        return

    duration_text = (
        f"، {_format_minutes(recovery.duration_minutes)}"
        if recovery.duration_minutes is not None
        else ""
    )
    await _reply(update, f"ریکاوری «{recovery.recovery_type}» ثبت شد{duration_text}.")


@restricted
async def report_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show a deterministic work and lifestyle summary for up to one week."""
    telegram_id = _telegram_id(update)
    args = context.args or []
    if telegram_id is None:
        return
    if len(args) > 1:
        await _reply(update, "نمونه: /report یا /report 168")
        return

    try:
        hours = int(_normalize_number(args[0])) if args else 24
        if not 1 <= hours <= 168:
            raise ValueError("بازهٔ گزارش باید بین ۱ تا ۱۶۸ ساعت باشد.")
    except ValueError:
        await _reply(update, "بازهٔ گزارش باید عددی بین ۱ تا ۱۶۸ ساعت باشد.")
        return

    try:
        with SessionLocal() as db:
            report = ReportService(db).create_report(telegram_id, hours)
    except Exception:
        logger.exception("Could not build a report for Telegram user %s.", telegram_id)
        await _reply(update, "ساخت گزارش انجام نشد. لطفاً دوباره تلاش کنید.")
        return

    await _reply(update, ReportService.format_report(report))
