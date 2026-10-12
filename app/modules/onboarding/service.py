"""Service layer for the AI onboarding flow."""

from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy.orm import Session

from app.db.base import UserProfile
from app.modules.onboarding.extraction import ProfileExtractionService
from app.modules.onboarding.models import OnboardingMessage, OnboardingSession
from app.services.llm import LLMService
from app.services.profile_service import ProfileService

ONBOARDING_SYSTEM_PROMPT = """تو مغز یک برنامه‌ریز شخصی هستی و معارفه را خودت با سؤال‌های تطبیقی انجام می‌دهی.
هدف: حدود ۲۰ سؤال دقیق و متناسب با جواب‌های کاربر بپرسی و فقط اگر ابهام مهمی باقی ماند تا سقف ۳۰ سؤال ادامه دهی.
موضوعات لازم، در حد مرتبط با همین فرد: شغل یا تحصیل و روزها و ساعت‌های ثابت؛ خواب و بیداری و انرژی؛ رفت‌وآمد و تعهدات؛ حوزه‌های مهم زندگی؛ اولویت‌ها؛ زمان آزاد واقعی؛ اهداف و پروژه‌های جاری و موعد و کارهای باقی‌مانده؛ محدودیت‌ها و ترجیحات برنامه‌ریزی.
هر نوبت فقط یک سؤال مشخص بپرس تا سقف ۳۰ سؤال واقعی رعایت شود؛ سؤال تکراری نپرس، پاسخ قبلی را کوتاه به رسمیت بشناس و سؤال بعدی را با توجه به آن تنظیم کن. از سؤال بی‌ربط برای پر کردن تعداد خودداری کن.
اگر پاسخ مبهم است، محترمانه بگو جزئیات دقیق‌تر باعث برنامه‌ریزی بهتر می‌شود و همان مورد را روشن کن.
پس از پوشش موضوعات مرتبط و کافی بودن اطلاعات، در انتهای پاسخ دقیقاً این نشانگر را در یک خط جدا قرار بده: [PROFILE_READY]
اگر به سؤال سی‌ام رسیدی، اطلاعات موجود را خلاصه کن، موارد نامعلوم را صریح بگو و بدون سؤال بیشتر همان نشانگر را بگذار.
فقط فارسی روان و کوتاه بنویس. هیچ برنامه یا زمان‌بندی‌ای را در مرحلهٔ معارفه نساز.
"""


class OnboardingService:
    """Manage onboarding sessions for users."""

    def __init__(self, db: Session):
        self.db = db

    def get_active_session(self, user_id: int) -> Optional[OnboardingSession]:
        """Fetch the current active onboarding session for a user."""
        return (
            self.db.query(OnboardingSession)
            .filter(
                OnboardingSession.user_id == user_id,
                OnboardingSession.status == "active",
            )
            .order_by(OnboardingSession.id.desc())
            .first()
        )

    def create_session(self, user_id: int) -> OnboardingSession:
        """Create a new onboarding session for a user."""
        active = self.get_active_session(user_id)
        if active:
            return active

        session = OnboardingSession(
            user_id=user_id,
            status="active",
            started_at=datetime.now(timezone.utc),
        )
        self.db.add(session)
        self.db.commit()
        self.db.refresh(session)
        return session

    def add_message(
        self, session_id: int, role: str, content: str
    ) -> OnboardingMessage:
        """Append a message to an onboarding session."""
        message = OnboardingMessage(
            session_id=session_id,
            role=role,
            content=content,
            created_at=datetime.now(timezone.utc),
        )
        self.db.add(message)
        self.db.commit()
        self.db.refresh(message)
        return message

    def get_messages(self, session_id: int) -> List[OnboardingMessage]:
        """Retrieve all messages for a session in chronological order."""
        return (
            self.db.query(OnboardingMessage)
            .filter(OnboardingMessage.session_id == session_id)
            .order_by(OnboardingMessage.created_at.asc())
            .all()
        )

    def complete_session(self, session_id: int) -> Optional[OnboardingSession]:
        """Mark an onboarding session as completed."""
        session = (
            self.db.query(OnboardingSession)
            .filter(OnboardingSession.id == session_id)
            .first()
        )
        if session:
            session.status = "completed"
            session.completed_at = datetime.now(timezone.utc)
            self.db.commit()
            self.db.refresh(session)
        return session

    def is_onboarding_completed(self, user_id: int) -> bool:
        """Check if user has already completed the onboarding process."""
        profile = (
            self.db.query(UserProfile)
            .filter(UserProfile.user_id == user_id)
            .first()
        )
        if profile and profile.occupation:
            return True

        completed_session = (
            self.db.query(OnboardingSession)
            .filter(
                OnboardingSession.user_id == user_id,
                OnboardingSession.status == "completed",
            )
            .first()
        )
        return completed_session is not None

    async def process_user_message(
        self,
        user_id: int,
        content: str,
        llm: LLMService,
    ) -> str:
        """Process incoming user message, save history, and generate next onboarding prompt."""
        session = self.get_active_session(user_id)
        if not session:
            session = self.create_session(user_id)

        # 1. Record incoming user message
        self.add_message(session_id=session.id, role="user", content=content)

        # 2. Build history for context
        history = self.get_messages(session.id)
        asked_count = sum(1 for msg in history if msg.role == "assistant")
        if asked_count >= 30:
            response_text = (
                "اطلاعات فعلی را جمع‌بندی می‌کنم و موارد نامعلوم را در برنامه لحاظ نمی‌کنم. "
                "اگر بعداً نکته‌ای جا افتاد، می‌توانی آن را در گفت‌وگو اضافه کنی.\n[PROFILE_READY]"
            )
            self.add_message(session_id=session.id, role="assistant", content=response_text)
            return response_text
        prompt = (
            ONBOARDING_SYSTEM_PROMPT
            + f"\nتعداد سؤال‌های دستیار تا اینجا: {asked_count} از ۳۰. "
            + "سؤال بعدی را فقط اگر لازم است مطرح کن."
        )
        llm_messages = [{"role": "system", "content": prompt}]
        for msg in history:
            llm_messages.append({"role": msg.role, "content": msg.content})

        # 3. Generate response from LLM
        response_text = await llm.generate_response(messages=llm_messages)

        # 4. Record assistant reply
        self.add_message(session_id=session.id, role="assistant", content=response_text)

        return response_text

    async def start_conversation(self, user_id: int, llm: LLMService) -> str:
        """Create the first adaptive question without requiring a user command."""
        session = self.get_active_session(user_id) or self.create_session(user_id)
        existing = self.get_messages(session.id)
        if existing:
            return existing[-1].content
        response_text = await llm.generate_response(
            messages=[
                {"role": "system", "content": ONBOARDING_SYSTEM_PROMPT},
                {"role": "user", "content": "معارفه را شروع کن و اولین سؤال ضروری را بپرس."},
            ]
        )
        self.add_message(
            session_id=session.id,
            role="assistant",
            content=response_text,
        )
        return response_text

    async def extract_and_save_profile(
        self,
        user_id: int,
        llm: LLMService,
    ) -> UserProfile:
        """Extract structured profile from session history and persist into UserProfile."""
        session = self.get_active_session(user_id)
        if not session:
            session = (
                self.db.query(OnboardingSession)
                .filter(OnboardingSession.user_id == user_id)
                .order_by(OnboardingSession.id.desc())
                .first()
            )

        if not session:
            raise ValueError(f"No onboarding session found for user_id={user_id}")

        history = self.get_messages(session.id)
        conversation_dicts = [
            {"role": msg.role, "content": msg.content}
            for msg in history
        ]

        extractor = ProfileExtractionService(llm_service=llm)
        extracted = await extractor.extract(conversation_dicts)

        work_schedule_str = None
        if extracted.work_schedule:
            start = extracted.work_schedule.start_time or ""
            end = extracted.work_schedule.end_time or ""
            work_schedule_str = f"{start} - {end}".strip(" -") or None

        sleep_schedule_str = None
        if extracted.sleep_schedule:
            bedtime = extracted.sleep_schedule.bedtime or ""
            wake = extracted.sleep_schedule.wake_up_time or ""
            sleep_schedule_str = f"{bedtime} - {wake}".strip(" -") or None

        profile_service = ProfileService(self.db)
        profile = profile_service.update_profile(
            user_id=user_id,
            occupation=extracted.occupation,
            education=extracted.education,
            work_schedule=work_schedule_str,
            sleep_schedule=sleep_schedule_str,
            lifestyle_summary=extracted.lifestyle_summary,
            preferences=extracted.preferences,
            constraints=extracted.constraints,
        )

        from app.modules.planning.models import UserMemory
        import json

        memory = (
            self.db.query(UserMemory)
            .filter(UserMemory.user_id == user_id)
            .first()
        )
        facts = {
            "priorities": extracted.priorities,
            "work_days": extracted.work_days or (
                extracted.work_schedule.weekdays if extracted.work_schedule else []
            ),
            "fixed_commitments": extracted.fixed_commitments,
            "daily_free_time": extracted.daily_free_time,
            "energy_patterns": extracted.energy_patterns,
            "life_areas": [area.model_dump() for area in extracted.life_areas],
            "onboarding_summary": extracted.lifestyle_summary,
            "planning_preferences": extracted.preferences,
            "constraints": extracted.constraints,
        }
        if memory:
            try:
                old_facts = json.loads(memory.facts)
                if isinstance(old_facts, dict):
                    facts = {**old_facts, **facts}
            except json.JSONDecodeError:
                pass
            memory.facts = json.dumps(facts, ensure_ascii=False)
        else:
            self.db.add(UserMemory(
                user_id=user_id,
                facts=json.dumps(facts, ensure_ascii=False),
            ))
        self.db.commit()

        self.complete_session(session.id)
        return profile
