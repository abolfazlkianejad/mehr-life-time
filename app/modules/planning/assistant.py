"""AI-assisted intake that asks for missing details before planning."""

from __future__ import annotations

import json
import re
from datetime import datetime, time, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.modules.planning.models import ConversationState, LifeArea, UserMemory
from app.modules.planning.service import PlanningService, user_timezone
from app.services.llm import LLMService


PLANNING_PROMPT = """تو دستیار هوشمند برنامه‌ریزی این کاربر هستی. فارسی پاسخ بده و جواب را فقط در قالب JSON معتبر بده؛ هیچ متن دیگری ننویس.
ساختار:
{"action":"chat|need_info|plan","reply":"متن برای کاربر","questions":[],"goal":null}

اگر کاربر سؤال معمولی یا گفت‌وگوی عادی دارد action=chat و پاسخ کوتاه بده.
اگر کاربر کار، هدف یا پروژه‌ای را می‌خواهد ثبت کند، بررسی کن آیا عنوان/نتیجه، حوزهٔ زندگی، شرح محدوده و کارهای باقی‌مانده، و برآورد زمان کافی است یا نه. اگر پروژهٔ مبهم است یا فقط لینک فرستاده شده، action=need_info؛ هر نوبت یک یا دو سؤال دقیق بپرس و تا اطلاعات لازم نرسیده هیچ برنامه‌ای نساز. در این نسخه محتوای لینک قابل واکشی نیست، پس متن یا فایل جزئیات را بخواه.
برای باشگاه یا ورزشکار، پیش از برنامه‌سازی بپرس هدف، سابقه و سطح، روزهای در دسترس، حرکات و وزنه‌های فعلی، ست/تکرار، تجهیزات، حال و ریکاوری و محدودیت/آسیب چیست. وزن یا وضعیت سلامت را حدس نزن.
برای درس و دانشگاه، نام درس، تعداد واحد، سطح/پیش‌نیاز، سرفصل و تکلیف و آزمون، پیشرفت فعلی و زمان کلاس/مطالعه را روشن کن؛ اگر سطح درس نامعلوم است سؤال کن.
برای پروژهٔ شرکت یا وب‌سایت، خروجی دقیق، فناوری/محدودیت‌ها، بخش‌های تمام‌شده و باقی‌مانده، اندازهٔ هر بخش و موعد را روشن کن.
وقتی جزئیات کافی شد action=plan و در goal این فیلدها را پر کن:
{"title":"هدف","description":"شرح و محدوده","domain_key":"کلید لاتین کوتاه","domain_title":"عنوان حوزه","is_project":true,"deadline":"ISO datetime یا null","priority":1,"tasks":[{"title":"گام کوچک و قابل انجام","description":"جزئیات","minutes":45}]}
برای هدف شخصی بدون پروژه is_project=false. کار بزرگ را به گام‌های عملی تقسیم کن و زمان هر کدام را واقع‌بینانه تخمین بزن. هرگز جزئیاتی را که کاربر نگفته قطعی فرض نکن؛ در صورت تردید سؤال کن. اولویت ۱ بالاترین و ۵ پایین‌ترین است. موعد را فقط از گفتهٔ کاربر استخراج کن؛ اگر تاریخ مبهم است سؤال کن. اگر زمان موجود با ضرب‌الاجل احتمالاً جور نیست، در reply صریحاً هشدار بده و پیشنهاد کاهش محدوده یا تغییر موعد بده.
پاسخ را کوتاه نگه دار. در برنامه تعداد گام‌ها را متناسب با کار انتخاب کن؛ از یک تا دوازده گام.
"""


def _extract_json(raw: str) -> dict[str, Any] | None:
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        value = json.loads(raw[start : end + 1])
        return value if isinstance(value, dict) else None
    except json.JSONDecodeError:
        return None


def _urls(text: str) -> list[str]:
    links = re.findall(r"https?://[^\s<>]+", text)
    return [link.rstrip(".,،؛!?)】]") for link in links[:3]]


def _facts(db: Session, user_id: int) -> dict[str, Any]:
    memory = db.query(UserMemory).filter(UserMemory.user_id == user_id).first()
    if not memory:
        return {}
    try:
        value = json.loads(memory.facts)
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}


def _state(db: Session, user_id: int) -> ConversationState:
    state = (
        db.query(ConversationState)
        .filter(
            ConversationState.user_id == user_id,
            ConversationState.scope == "planner",
        )
        .first()
    )
    if state is None:
        state = ConversationState(
            user_id=user_id,
            scope="planner",
            flow="idle",
            payload="{}",
        )
        db.add(state)
        db.commit()
        db.refresh(state)
    return state


class PlanningAssistant:
    def __init__(self, db: Session, llm: LLMService | None = None) -> None:
        self.db = db
        self.llm = llm or LLMService()

    def begin_intake(self, user_id: int, *, area_title: str | None = None) -> ConversationState:
        state = _state(self.db, user_id)
        state.flow = "planner_intake"
        state.payload = json.dumps(
            {
                "history": [],
                "forced": True,
                "area_title": area_title,
            },
            ensure_ascii=False,
        )
        self.db.commit()
        self.db.refresh(state)
        return state

    def clear_intake(self, user_id: int) -> None:
        state = _state(self.db, user_id)
        state.flow = "idle"
        state.payload = "{}"
        self.db.commit()

    async def handle_text(
        self,
        *,
        user_id: int,
        text: str,
        current_area: LifeArea | None = None,
    ) -> dict[str, Any]:
        state = _state(self.db, user_id)
        try:
            payload = json.loads(state.payload)
            if not isinstance(payload, dict):
                payload = {}
        except json.JSONDecodeError:
            payload = {}
        history = payload.get("history", [])
        if not isinstance(history, list):
            history = []
        if text.strip():
            history.append({"role": "user", "content": text.strip()[:8000]})

        research_context = ""
        links = _urls(text)
        if links:
            research_context = (
                "\nکاربر لینک فرستاده است اما دریافت محتوای لینک از سرویس بیرونی فعلاً فعال نیست. "
                "برای پرهیز از ارسال داده به مقصد تأییدنشده، از او بخواه متن یا فایل جزئیات را بفرستد.\n"
            )

        areas = [
            {"key": area.key, "title": area.title, "is_project": area.is_project}
            for area in PlanningService(self.db).list_areas(user_id)
        ]
        user_facts = _facts(self.db, user_id)
        system_prompt = (
            PLANNING_PROMPT
            + "\nحوزه‌های موجود کاربر: "
            + json.dumps(areas, ensure_ascii=False)
            + "\nحافظهٔ برنامه‌ریزی کاربر: "
            + json.dumps(user_facts, ensure_ascii=False)[:8000]
            + "\nحوزهٔ گفت‌وگوی فعلی: "
            + (current_area.title if current_area else str(payload.get("area_title") or "عمومی"))
            + research_context
        )
        if payload.get("forced") and not history:
            history.append({
                "role": "user",
                "content": "می‌خواهم یک کار یا هدف جدید ثبت کنم. ابتدا سؤال‌های لازم را یکی‌یکی بپرس.",
            })
        llm_messages = [{"role": "system", "content": system_prompt}, *history]
        raw = await self.llm.generate_response(llm_messages, temperature=0.2)
        result = _extract_json(raw)
        if result is None:
            state.flow = "planner_intake" if payload.get("forced") or len(history) > 1 else "idle"
            state.payload = json.dumps({**payload, "history": history}, ensure_ascii=False)
            self.db.commit()
            return {
                "action": "need_info" if state.flow != "idle" else "chat",
                "reply": "برای اینکه درست پیش برویم، لطفاً عنوان کار، نتیجه‌ای که می‌خواهی و اگر داری موعد و کارهای باقی‌مانده را روشن‌تر بنویس.",
            }

        action = str(result.get("action", "chat"))
        reply = str(result.get("reply", "")).strip()
        if action == "need_info":
            state.flow = "planner_intake"
            history.append({"role": "assistant", "content": reply})
            state.payload = json.dumps({
                "history": history[-24:],
                "forced": True,
                "area_title": payload.get("area_title"),
            }, ensure_ascii=False)
            self.db.commit()
            return {"action": "need_info", "reply": reply or "برای برنامه‌ریزی دقیق‌تر، جزئیات کار و موعدش را بگو."}

        if action == "plan":
            goal_data = result.get("goal")
            if not isinstance(goal_data, dict):
                state.flow = "planner_intake"
                state.payload = json.dumps({"history": history, "forced": True}, ensure_ascii=False)
                self.db.commit()
                return {"action": "need_info", "reply": "جزئیات کافی برای ساخت برنامه نرسید؛ کارهای باقی‌مانده و زمان هرکدام را توضیح بده."}
            goal_title = str(goal_data.get("title", "")).strip()
            tasks = goal_data.get("tasks")
            if not goal_title or not isinstance(tasks, list) or not 1 <= len(tasks) <= 12:
                state.flow = "planner_intake"
                state.payload = json.dumps({"history": history, "forced": True}, ensure_ascii=False)
                self.db.commit()
                return {"action": "need_info", "reply": "عنوان هدف یا گام‌های کوچک آن کامل نیست؛ لطفاً محدوده و کارهای باقی‌مانده را روشن کن."}
            cleaned_tasks: list[dict[str, Any]] = []
            for task in tasks:
                if not isinstance(task, dict) or not str(task.get("title", "")).strip():
                    state.flow = "planner_intake"
                    state.payload = json.dumps({"history": history, "forced": True}, ensure_ascii=False)
                    self.db.commit()
                    return {"action": "need_info", "reply": "یکی از گام‌ها عنوان روشنی ندارد؛ آن را مشخص کن تا برنامه بسازم."}
                try:
                    minutes = int(task.get("minutes", 30))
                except (TypeError, ValueError):
                    minutes = 0
                if not 5 <= minutes <= 600:
                    state.flow = "planner_intake"
                    state.payload = json.dumps({"history": history, "forced": True}, ensure_ascii=False)
                    self.db.commit()
                    return {"action": "need_info", "reply": f"برای گام «{task['title']}» زمان تقریبی لازم است؛ چند دقیقه یا ساعت در نظر بگیر؟"}
                cleaned_tasks.append({
                    "title": str(task["title"]).strip()[:255],
                    "description": str(task.get("description", ""))[:4000],
                    "minutes": minutes,
                })
            raw_deadline = goal_data.get("deadline")
            if raw_deadline not in (None, "", "null") and parse_deadline(raw_deadline) is None:
                state.flow = "planner_intake"
                state.payload = json.dumps({"history": history, "forced": True}, ensure_ascii=False)
                self.db.commit()
                return {"action": "need_info", "reply": "موعد را با تاریخ و ساعت دقیق بنویس تا درست در برنامه جا بدهم."}
            goal_data["title"] = goal_title[:255]
            goal_data["tasks"] = cleaned_tasks
            state.flow = "planner_ready"
            state.payload = json.dumps({
                "history": history[-12:],
                "forced": True,
                "pending_goal": goal_data,
            }, ensure_ascii=False)
            self.db.commit()
            return {"action": "plan", "reply": reply, "goal": goal_data}

        state.flow = "idle"
        state.payload = "{}"
        self.db.commit()
        return {"action": "chat", "reply": reply or raw[:3500]}


def parse_deadline(value: Any) -> datetime | None:
    if value in (None, "", "null"):
        return None
    raw = str(value).strip()
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
            parsed = datetime.combine(datetime.fromisoformat(raw).date(), time(23, 59))
        else:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=user_timezone())
    return parsed.astimezone(timezone.utc)
