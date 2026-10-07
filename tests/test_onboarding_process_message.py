"""Unit test for OnboardingService.process_user_message."""

import asyncio
import time
from unittest.mock import AsyncMock

from app.db.base import User
from app.db.session import SessionLocal
from app.modules.onboarding.service import OnboardingService
from app.services.llm import LLMService


async def run_test() -> None:
    """Verify that process_user_message stores user and assistant messages properly."""
    with SessionLocal() as db:
        # Use an ephemeral unique Telegram ID to avoid collisions
        unique_tg_id = int(time.time() * 1000) % 1_000_000_000

        user = User(
            telegram_id=unique_tg_id,
            username=f"tester_{unique_tg_id}",
            full_name="Message Tester",
            role="user",
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        user_id = user.id

        try:
            service = OnboardingService(db)
            mock_llm = AsyncMock(spec=LLMService)
            mock_llm.generate_response.return_value = (
                "عالیه! ساعات کاری معمول شما در طول روز چطور است؟"
            )

            # First turn: Send user message and get AI response
            reply_1 = await service.process_user_message(
                user_id=user_id,
                content="من مهندس نرم‌افزار هستم و روی پروژه‌های پایتون کار می‌کنم.",
                llm=mock_llm,
            )

            assert reply_1 == "عالیه! ساعات کاری معمول شما در طول روز چطور است؟"

            session = service.get_active_session(user_id)
            assert session is not None

            messages = service.get_messages(session.id)
            assert len(messages) == 2, f"Expected 2 messages, got {len(messages)}"
            assert messages[0].role == "user"
            assert "مهندس نرم‌افزار" in messages[0].content
            assert messages[1].role == "assistant"
            assert messages[1].content == reply_1

            print("=== PROCESS USER MESSAGE TEST PASSED ===")
            print(f"Session ID: {session.id}")
            print(f"Total messages recorded: {len(messages)}")

        finally:
            # Clean up test user and cascade relations
            user_to_delete = (
                db.query(User)
                .filter(User.id == user_id)
                .first()
            )
            if user_to_delete:
                db.delete(user_to_delete)
                db.commit()


if __name__ == "__main__":
    asyncio.run(run_test())
