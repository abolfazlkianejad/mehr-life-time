"""Persistence, scheduling, and time tracking for the personal planner."""

from __future__ import annotations

import json
import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.time_utils import as_utc, to_database_datetime
from app.db.base import User, UserProfile
from app.modules.planning.models import (
    ConversationState,
    Goal,
    LifeArea,
    PlannedTask,
    TaskTimeLog,
    TelegramWorkspace,
    UserConsent,
    UserMemory,
)

PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩"
ASCII_DIGITS = "01234567890123456789"
DIGIT_TRANSLATION = str.maketrans(PERSIAN_DIGITS, ASCII_DIGITS)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def user_timezone() -> ZoneInfo:
    try:
        return ZoneInfo(settings.TIMEZONE)
    except Exception:
        return ZoneInfo("Asia/Tehran")


def parse_clock(value: str | None) -> time | None:
    if not value:
        return None
    value = value.translate(DIGIT_TRANSLATION)
    match = re.search(r"(?<!\d)([01]?\d|2[0-3])[:٫.]([0-5]\d)(?!\d)", value)
    if not match:
        return None
    return time(int(match.group(1)), int(match.group(2)))


class PlanningService:
    """Business operations for a user's life areas, goals, and scheduled tasks."""

    def __init__(self, db: Session):
        self.db = db

    def get_workspace(self, user_id: int) -> TelegramWorkspace | None:
        return (
            self.db.query(TelegramWorkspace)
            .filter(TelegramWorkspace.user_id == user_id)
            .first()
        )

    def get_workspace_by_chat(self, chat_id: int) -> TelegramWorkspace | None:
        return (
            self.db.query(TelegramWorkspace)
            .filter(TelegramWorkspace.chat_id == chat_id)
            .first()
        )

    def get_area_by_topic(self, user_id: int, topic_id: int | None) -> LifeArea | None:
        if topic_id is None:
            return None
        return (
            self.db.query(LifeArea)
            .filter(LifeArea.user_id == user_id, LifeArea.topic_id == topic_id)
            .first()
        )

    def list_areas(self, user_id: int) -> list[LifeArea]:
        return (
            self.db.query(LifeArea)
            .filter(LifeArea.user_id == user_id, LifeArea.is_active.is_(True))
            .order_by(LifeArea.created_at.asc())
            .all()
        )

    def ensure_area(
        self,
        user_id: int,
        *,
        key: str,
        title: str,
        topic_id: int | None = None,
        is_project: bool = False,
    ) -> LifeArea:
        safe_key = re.sub(r"[^\w-]+", "-", key.strip().lower()).strip("-")[:64]
        if not safe_key:
            safe_key = f"area-{abs(hash(title)) % 1000000}"
        area = (
            self.db.query(LifeArea)
            .filter(LifeArea.user_id == user_id, LifeArea.key == safe_key)
            .first()
        )
        if not area:
            area = LifeArea(
                user_id=user_id,
                key=safe_key,
                title=title.strip()[:128] or "حوزهٔ تازه",
                topic_id=topic_id,
                is_project=is_project,
            )
            self.db.add(area)
        else:
            if title.strip():
                area.title = title.strip()[:128]
            if topic_id is not None:
                area.topic_id = topic_id
            area.is_project = is_project
        self.db.commit()
        self.db.refresh(area)
        return area

    def create_goal(
        self,
        user_id: int,
        *,
        title: str,
        description: str = "",
        deadline: datetime | None = None,
        priority: int = 3,
        area_id: int | None = None,
        tasks: list[dict[str, Any]],
    ) -> tuple[Goal, list[PlannedTask]]:
        if not title.strip():
            raise ValueError("Goal title is required.")
        if not tasks:
            raise ValueError("At least one planned task is required.")
        safe_priority = min(5, max(1, int(priority)))
        if deadline:
            # A newly introduced, dated commitment leads the active schedule.
            safe_priority = 1
        goal = Goal(
            user_id=user_id,
            life_area_id=area_id,
            title=title.strip()[:255],
            description=description.strip(),
            deadline=to_database_datetime(deadline) if deadline else None,
            priority=safe_priority,
        )
        self.db.add(goal)
        self.db.flush()

        created: list[PlannedTask] = []
        for raw_task in tasks:
            task_title = str(raw_task.get("title", "")).strip()
            if not task_title:
                continue
            duration = int(raw_task.get("minutes", raw_task.get("estimated_minutes", 30)))
            if not 5 <= duration <= 600:
                raise ValueError("Task duration must be between 5 and 600 minutes.")
            duration = self.learned_duration(user_id, task_title, duration)
            task = PlannedTask(
                user_id=user_id,
                life_area_id=area_id,
                goal_id=goal.id,
                title=task_title[:255],
                description=str(raw_task.get("description", "")).strip(),
                priority=safe_priority,
                estimated_minutes=duration,
                due_at=to_database_datetime(deadline) if deadline else None,
            )
            self.db.add(task)
            created.append(task)
        if not created:
            self.db.rollback()
            raise ValueError("No valid planned tasks were provided.")
        self.db.commit()
        self.db.refresh(goal)
        for task in created:
            self.db.refresh(task)
        self.schedule_open_tasks(user_id)
        return goal, created

    def unscheduled_tasks(self, user_id: int, goal_id: int) -> list[PlannedTask]:
        return (
            self.db.query(PlannedTask)
            .filter(
                PlannedTask.user_id == user_id,
                PlannedTask.goal_id == goal_id,
                PlannedTask.status == "pending",
                PlannedTask.scheduled_start.is_(None),
            )
            .all()
        )

    def _user_profile(self, user_id: int) -> UserProfile | None:
        return (
            self.db.query(UserProfile)
            .filter(UserProfile.user_id == user_id)
            .first()
        )

    def _memory_facts(self, user_id: int) -> dict[str, Any]:
        memory = (
            self.db.query(UserMemory)
            .filter(UserMemory.user_id == user_id)
            .first()
        )
        if not memory:
            return {}
        try:
            value = json.loads(memory.facts)
            return value if isinstance(value, dict) else {}
        except json.JSONDecodeError:
            return {}

    def _busy_intervals(self, user_id: int, local_day: date) -> list[tuple[datetime, datetime]]:
        tz = user_timezone()
        day_start = datetime.combine(local_day, time.min, tzinfo=tz)
        day_end = day_start + timedelta(days=1)
        busy: list[tuple[datetime, datetime]] = []

        for task in (
            self.db.query(PlannedTask)
            .filter(
                PlannedTask.user_id == user_id,
                PlannedTask.status.in_(["pending", "in_progress"]),
                PlannedTask.scheduled_start.is_not(None),
                PlannedTask.scheduled_end.is_not(None),
            )
            .all()
        ):
            start = as_utc(task.scheduled_start).astimezone(tz)
            end = as_utc(task.scheduled_end).astimezone(tz)
            if start.date() == local_day and end > day_start and start < day_end:
                busy.append((max(start, day_start), min(end, day_end)))

        profile = self._user_profile(user_id)
        facts = self._memory_facts(user_id)
        commitments = facts.get("fixed_commitments", [])
        weekday = local_day.weekday()
        for item in commitments if isinstance(commitments, list) else []:
            if not isinstance(item, dict):
                continue
            days = item.get("weekdays", item.get("days", []))
            if isinstance(days, list) and days and weekday not in days:
                continue
            start_time = parse_clock(str(item.get("start_time", "")))
            end_time = parse_clock(str(item.get("end_time", "")))
            if start_time and end_time:
                start = datetime.combine(local_day, start_time, tzinfo=tz)
                end = datetime.combine(local_day, end_time, tzinfo=tz)
                if end <= start:
                    end += timedelta(days=1)
                busy.append((start, end))

        if profile and profile.work_schedule and not commitments:
            schedule_text = profile.work_schedule.translate(DIGIT_TRANSLATION)
            times = re.findall(r"(?<!\d)([01]?\d|2[0-3])[:٫.]([0-5]\d)(?!\d)", schedule_text)
            work_days = facts.get("work_days", [])
            if not isinstance(work_days, list):
                work_days = []
            if len(times) >= 2 and (not work_days or weekday in work_days):
                start_time, end_time = (
                    time(int(times[0][0]), int(times[0][1])),
                    time(int(times[1][0]), int(times[1][1])),
                )
                busy.append((
                    datetime.combine(local_day, start_time, tzinfo=tz),
                    datetime.combine(local_day, end_time, tzinfo=tz),
                ))

        return sorted(busy, key=lambda interval: interval[0])

    def _day_window(self, user_id: int, local_day: date) -> tuple[datetime, datetime]:
        tz = user_timezone()
        profile = self._user_profile(user_id)
        facts = self._memory_facts(user_id)
        wake = parse_clock(profile.sleep_schedule.split("-")[-1] if profile and profile.sleep_schedule else None)
        bedtime = parse_clock(profile.sleep_schedule.split("-")[0] if profile and profile.sleep_schedule else None)
        start_time = wake or time(7, 0)
        end_time = bedtime or time(23, 0)
        free_times = re.findall(
            r"(?<!\d)([01]?\d|2[0-3])[:٫.]([0-5]\d)(?!\d)",
            str(facts.get("daily_free_time") or "").translate(DIGIT_TRANSLATION),
        )
        if len(free_times) >= 2:
            start_time = time(int(free_times[0][0]), int(free_times[0][1]))
            end_time = time(int(free_times[1][0]), int(free_times[1][1]))
        start = datetime.combine(local_day, start_time, tzinfo=tz)
        end = datetime.combine(local_day, end_time, tzinfo=tz)
        if end <= start:
            end += timedelta(days=1)
        return start, end

    @staticmethod
    def _first_slot(
        window: tuple[datetime, datetime],
        busy: list[tuple[datetime, datetime]],
        duration: int,
        now: datetime,
    ) -> tuple[datetime, datetime] | None:
        start, end = window
        cursor = max(start, now)
        cursor = cursor.replace(minute=(cursor.minute // 15) * 15, second=0, microsecond=0)
        if cursor < max(start, now):
            cursor += timedelta(minutes=15)
        duration_delta = timedelta(minutes=duration)
        for busy_start, busy_end in sorted(busy, key=lambda interval: interval[0]):
            if busy_end <= cursor:
                continue
            if cursor + duration_delta <= busy_start:
                return cursor, cursor + duration_delta
            if cursor < busy_end:
                cursor = busy_end + timedelta(minutes=15)
        if cursor + duration_delta <= end:
            return cursor, cursor + duration_delta
        return None

    def schedule_open_tasks(self, user_id: int, *, horizon_days: int = 7) -> list[PlannedTask]:
        """Place unscheduled tasks into non-overlapping free slots this week."""
        tz = user_timezone()
        now = _now_utc().astimezone(tz)
        local_week_start = now.date() - timedelta(days=(now.weekday() - 5) % 7)
        tasks = (
            self.db.query(PlannedTask)
            .filter(
                PlannedTask.user_id == user_id,
                PlannedTask.status == "pending",
                PlannedTask.scheduled_start.is_(None),
            )
            .all()
        )
        tasks.sort(
            key=lambda task: (
                task.priority,
                as_utc(task.due_at) if task.due_at else datetime.max.replace(tzinfo=timezone.utc),
                task.created_at,
            )
        )
        scheduled: list[PlannedTask] = []
        for task in tasks:
            for offset in range(horizon_days):
                local_day = local_week_start + timedelta(days=offset)
                window = self._day_window(user_id, local_day)
                busy = self._busy_intervals(user_id, local_day)
                slot = self._first_slot(window, busy, task.estimated_minutes, now)
                if not slot:
                    continue
                slot_start, slot_end = slot
                if task.due_at and slot_end.astimezone(timezone.utc) > as_utc(task.due_at):
                    continue
                task.scheduled_start = to_database_datetime(slot_start)
                task.scheduled_end = to_database_datetime(slot_end)
                scheduled.append(task)
                break
        self.db.commit()
        for task in scheduled:
            self.db.refresh(task)
        return scheduled

    def get_week_tasks(self, user_id: int, *, include_overdue: bool = True) -> list[PlannedTask]:
        tz = user_timezone()
        now = _now_utc().astimezone(tz)
        week_start = now.date() - timedelta(days=(now.weekday() - 5) % 7)
        end = datetime.combine(week_start + timedelta(days=7), time.min, tzinfo=tz)
        query = self.db.query(PlannedTask).filter(
            PlannedTask.user_id == user_id,
            PlannedTask.status.in_(["pending", "in_progress"]),
        )
        tasks = query.order_by(PlannedTask.priority.asc(), PlannedTask.scheduled_start.asc()).all()
        result = []
        for task in tasks:
            if task.scheduled_start:
                start = as_utc(task.scheduled_start).astimezone(tz)
                if start < end:
                    result.append(task)
            elif include_overdue:
                result.append(task)
        return result

    def start_task(self, user_id: int, task_id: int) -> PlannedTask:
        task = self._get_open_task(user_id, task_id)
        now = _now_utc()
        other_log = (
            self.db.query(TaskTimeLog)
            .filter(TaskTimeLog.user_id == user_id, TaskTimeLog.ended_at.is_(None))
            .first()
        )
        if other_log and other_log.task_id != task.id:
            other_log.ended_at = to_database_datetime(now)
            other_log.duration_minutes = max(
                1,
                int((now - as_utc(other_log.started_at)).total_seconds() // 60),
            )
            previous = self.db.get(PlannedTask, other_log.task_id)
            if previous and previous.status == "in_progress":
                previous.status = "pending"
        if task.status == "in_progress":
            self.db.commit()
            return task
        task.status = "in_progress"
        task.started_at = task.started_at or to_database_datetime(now)
        self.db.add(TaskTimeLog(
            user_id=user_id,
            task_id=task.id,
            started_at=to_database_datetime(now),
        ))
        self.db.commit()
        self.db.refresh(task)
        return task

    def finish_task(self, user_id: int, task_id: int) -> PlannedTask:
        task = self._get_open_task(user_id, task_id)
        now = _now_utc()
        open_log = (
            self.db.query(TaskTimeLog)
            .filter(
                TaskTimeLog.user_id == user_id,
                TaskTimeLog.task_id == task.id,
                TaskTimeLog.ended_at.is_(None),
            )
            .order_by(TaskTimeLog.id.desc())
            .first()
        )
        if open_log:
            open_log.ended_at = to_database_datetime(now)
            open_log.duration_minutes = max(
                1, int((now - as_utc(open_log.started_at)).total_seconds() // 60)
            )
        task.status = "completed"
        task.completed_at = to_database_datetime(now)
        task.reminder_count = 0
        self._adapt_duration(task)
        self.db.commit()
        self.db.refresh(task)
        return task

    def _adapt_duration(self, task: PlannedTask) -> None:
        logs = (
            self.db.query(TaskTimeLog)
            .filter(
                TaskTimeLog.task_id == task.id,
                TaskTimeLog.duration_minutes.is_not(None),
            )
            .all()
        )
        total = sum(log.duration_minutes or 0 for log in logs)
        if logs:
            # Gradual update reduces the effect of one unusually short or long session.
            task.estimated_minutes = min(
                600,
                max(5, round(task.estimated_minutes * 0.5 + (total / len(logs)) * 0.5)),
            )
            memory = (
                self.db.query(UserMemory)
                .filter(UserMemory.user_id == task.user_id)
                .first()
            )
            facts = self._memory_facts(task.user_id)
            durations = facts.setdefault("task_duration_minutes", {})
            if isinstance(durations, dict):
                normalized_title = re.sub(r"\s+", " ", task.title.strip().lower())[:128]
                prior = durations.get(normalized_title, {})
                prior_count = int(prior.get("count", 0)) if isinstance(prior, dict) else 0
                prior_average = float(prior.get("average", 0)) if isinstance(prior, dict) else 0
                observed = total / len(logs)
                count = prior_count + 1
                durations[normalized_title] = {
                    "count": count,
                    "average": round((prior_average * prior_count + observed) / count),
                }
                if memory is None:
                    memory = UserMemory(user_id=task.user_id, facts="{}")
                    self.db.add(memory)
                memory.facts = json.dumps(facts, ensure_ascii=False)

    def learned_duration(self, user_id: int, title: str, fallback: int) -> int:
        durations = self._memory_facts(user_id).get("task_duration_minutes", {})
        normalized_title = re.sub(r"\s+", " ", title.strip().lower())[:128]
        if isinstance(durations, dict):
            saved = durations.get(normalized_title)
            if isinstance(saved, dict) and int(saved.get("count", 0)) > 0:
                return min(600, max(5, round(float(saved.get("average", fallback)))))
        return fallback

    def _get_open_task(self, user_id: int, task_id: int) -> PlannedTask:
        task = (
            self.db.query(PlannedTask)
            .filter(
                PlannedTask.user_id == user_id,
                PlannedTask.id == task_id,
                PlannedTask.status.in_(["pending", "in_progress"]),
            )
            .first()
        )
        if not task:
            raise LookupError("Open planned task was not found.")
        return task

    def get_due_notifications(self, *, now: datetime | None = None) -> list[tuple[PlannedTask, str]]:
        now_utc = as_utc(now or _now_utc())
        tasks = (
            self.db.query(PlannedTask)
            .filter(
                PlannedTask.status.in_(["pending", "in_progress"]),
                PlannedTask.scheduled_start.is_not(None),
            )
            .all()
        )
        due: list[tuple[PlannedTask, str]] = []
        for task in tasks:
            start = as_utc(task.scheduled_start)
            end = as_utc(task.scheduled_end) if task.scheduled_end else None
            if not task.start_notified and start <= now_utc:
                due.append((task, "start"))
                task.start_notified = True
            elif task.status != "completed" and end and now_utc >= end:
                elapsed = now_utc - end
                reminder_due = elapsed >= timedelta(minutes=15 * task.reminder_count)
                if reminder_due and task.reminder_count < 3:
                    due.append((task, "followup"))
                    task.reminder_count += 1
                elif task.reminder_count >= 3 and elapsed >= timedelta(minutes=45):
                    task.scheduled_start = None
                    task.scheduled_end = None
                    task.start_notified = False
                    task.reminder_count = 0
                    task.status = "pending"
        self.db.commit()
        return due

    def reschedule_unplanned(self, user_id: int) -> list[PlannedTask]:
        return self.schedule_open_tasks(user_id)

    def progress_summary(self, user_id: int) -> dict[str, int]:
        goals = self.db.query(Goal).filter(Goal.user_id == user_id, Goal.status == "active").count()
        pending = self.db.query(PlannedTask).filter(
            PlannedTask.user_id == user_id,
            PlannedTask.status.in_(["pending", "in_progress"]),
        ).count()
        complete = self.db.query(PlannedTask).filter(
            PlannedTask.user_id == user_id, PlannedTask.status == "completed"
        ).count()
        return {"goals": goals, "open": pending, "completed": complete}

    @staticmethod
    def local_datetime(value: datetime | None) -> datetime | None:
        return as_utc(value).astimezone(user_timezone()) if value else None

    @staticmethod
    def current_user_by_telegram_id(db: Session, telegram_id: int) -> User | None:
        return db.query(User).filter(User.telegram_id == telegram_id).first()

    @staticmethod
    def consent_for_user(db: Session, user_id: int) -> UserConsent | None:
        return db.query(UserConsent).filter(UserConsent.user_id == user_id).first()

    @staticmethod
    def conversation_state(db: Session, user_id: int, scope: str = "main") -> ConversationState | None:
        return (
            db.query(ConversationState)
            .filter(ConversationState.user_id == user_id, ConversationState.scope == scope)
            .first()
        )
