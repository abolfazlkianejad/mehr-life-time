"""Tests for Telegram command parsing and service integration."""

from collections.abc import Generator
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from telegram.ext import CommandHandler

from app.bot.bot import build_bot_app
from app.bot import commands
from app.core.config import settings
from app.db.base import (
    Base,
    NutritionLog,
    RecoveryLog,
    SleepLog,
    Task,
    WorkoutLog,
)
from app.modules.reports.service import ReportService


@pytest.fixture
def test_session_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[sessionmaker[Session], None, None]:
    """Provide isolated persistence for Telegram command tests."""
    test_engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=test_engine)
    factory = sessionmaker(bind=test_engine, expire_on_commit=False)
    monkeypatch.setattr(commands, "SessionLocal", factory)
    try:
        yield factory
    finally:
        Base.metadata.drop_all(bind=test_engine)
        test_engine.dispose()


def _mock_update(telegram_id: int) -> tuple[SimpleNamespace, AsyncMock]:
    """Build a lightweight update and reply mock for command tests."""
    reply_text = AsyncMock()
    message = SimpleNamespace(reply_text=reply_text)
    update = SimpleNamespace(
        effective_user=SimpleNamespace(id=telegram_id),
        effective_message=message,
    )
    return update, reply_text


def test_bot_registers_all_supported_commands(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Ensure public Telegram routes include each implemented command."""
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "123456:ABCDEF1234567890")

    bot_app = build_bot_app()

    registered_commands = {
        command
        for handlers in bot_app.handlers.values()
        for handler in handlers
        if isinstance(handler, CommandHandler)
        for command in handler.commands
    }
    assert {
        "start",
        "finish_onboarding",
        "help",
        "task",
        "tasks",
        "done",
        "work_start",
        "work_stop",
        "sleep",
        "meal",
        "workout",
        "recovery",
        "report",
    } <= registered_commands


@pytest.mark.asyncio
async def test_task_commands_create_list_and_complete_task(
    monkeypatch: pytest.MonkeyPatch,
    test_session_factory: sessionmaker[Session],
) -> None:
    """Exercise the task command flow and Persian task-ID parsing."""
    telegram_id = 123456789
    monkeypatch.setattr(settings, "TELEGRAM_ALLOWED_USER_IDS", str(telegram_id))
    update, reply_text = _mock_update(telegram_id)

    await commands.task_command(update, SimpleNamespace(args=["Prepare", "report"]))
    with test_session_factory() as db:
        task = db.query(Task).filter(Task.telegram_id == telegram_id).one()
        task_id = task.id
        assert task.title == "Prepare report"
        assert task.status == "pending"

    await commands.tasks_command(update, SimpleNamespace(args=[]))
    reply_text.assert_awaited_with(f"وظایف باز:\n{task_id}. [medium] Prepare report")

    persian_task_id = str(task_id).translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))
    await commands.done_command(update, SimpleNamespace(args=[persian_task_id]))
    with test_session_factory() as db:
        task = db.query(Task).filter(Task.id == task_id).one()
        assert task.status == "completed"


@pytest.mark.asyncio
async def test_lifestyle_commands_parse_and_record_entries(
    monkeypatch: pytest.MonkeyPatch,
    test_session_factory: sessionmaker[Session],
) -> None:
    """Parse concise Telegram inputs for sleep, meals, exercise, and recovery."""
    telegram_id = 223456789
    monkeypatch.setattr(settings, "TELEGRAM_ALLOWED_USER_IDS", str(telegram_id))
    update, reply_text = _mock_update(telegram_id)

    await commands.sleep_command(update, SimpleNamespace(args=["۷٫۵", "۸"]))
    await commands.meal_command(
        update,
        SimpleNamespace(args=["breakfast", "|", "oatmeal and fruit", "|", "500"]),
    )
    await commands.workout_command(
        update,
        SimpleNamespace(args=["walk", "|", "30", "|", "moderate"]),
    )
    await commands.recovery_command(
        update,
        SimpleNamespace(args=["stretching", "|", "15", "|", "7", "|", "evening"]),
    )

    with test_session_factory() as db:
        assert db.query(SleepLog).one().duration_hours == 7.5
        meal = db.query(NutritionLog).one()
        assert meal.meal_type == "breakfast"
        assert meal.calories == 500
        workout = db.query(WorkoutLog).one()
        assert workout.duration_minutes == 30
        assert workout.intensity == "moderate"
        recovery = db.query(RecoveryLog).one()
        assert recovery.duration_minutes == 15
        assert recovery.quality_score == 7
        assert recovery.notes == "evening"

    assert reply_text.await_count == 4


@pytest.mark.asyncio
async def test_report_command_builds_work_and_lifestyle_summary(
    monkeypatch: pytest.MonkeyPatch,
    test_session_factory: sessionmaker[Session],
) -> None:
    """Return a report assembled from the user's current-day records."""
    telegram_id = 323456789
    monkeypatch.setattr(settings, "TELEGRAM_ALLOWED_USER_IDS", str(telegram_id))
    update, reply_text = _mock_update(telegram_id)
    with test_session_factory() as db:
        db.add(
            NutritionLog(
                telegram_id=telegram_id,
                meal_type="lunch",
                description="Rice and vegetables",
                calories=600,
                logged_at=datetime.now(timezone.utc),
            )
        )
        db.commit()

    await commands.report_command(update, SimpleNamespace(args=["24"]))

    report = reply_text.await_args.args[0]
    assert "گزارش 24 ساعت گذشته" in report
    assert "تغذیه: 1 وعده" in report
    assert "600" in report
