"""Unit tests for the complete onboarding flow and profile extraction."""

import json
import random
from unittest.mock import AsyncMock

import pytest

from app.db.base import Base, User, UserProfile
from app.db.session import SessionLocal, engine
from app.modules.onboarding.service import OnboardingService
from app.services.llm import LLMService


@pytest.fixture(scope="session", autouse=True)
def init_test_db():
    """Ensure all database tables exist before running test suite."""
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture
def db_session():
    """Provide a transactional database session fixture with cleanup."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def test_user(db_session):
    """Create a temporary test user and cleanup afterwards."""
    unique_tg_id = random.randint(100_000_000, 999_999_999)
    user = User(
        telegram_id=unique_tg_id,
        username=f"onboarding_flow_{unique_tg_id}",
        full_name="Flow Test User",
        role="user",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    yield user

    # Cleanup
    db_session.query(UserProfile).filter(UserProfile.user_id == user.id).delete()
    db_session.delete(user)
    db_session.commit()


@pytest.mark.asyncio
async def test_onboarding_process_user_message(db_session, test_user):
    """Test sending user messages and recording LLM responses in history."""
    service = OnboardingService(db_session)
    mock_llm = AsyncMock(spec=LLMService)
    mock_llm.generate_response.return_value = "سلام! معمولاً چه ساعاتی کار می‌کنی؟"

    # Send first user message
    reply = await service.process_user_message(
        user_id=test_user.id,
        content="سلام، من توسعه‌دهنده فرانت‌اند هستم.",
        llm=mock_llm,
    )

    assert reply == "سلام! معمولاً چه ساعاتی کار می‌کنی؟"
    mock_llm.generate_response.assert_awaited_once()

    # Verify session and messages in database
    session = service.get_active_session(test_user.id)
    assert session is not None
    assert session.status == "active"

    messages = service.get_messages(session.id)
    assert len(messages) == 2
    assert messages[0].role == "user"
    assert messages[0].content == "سلام، من توسعه‌دهنده فرانت‌اند هستم."
    assert messages[1].role == "assistant"
    assert messages[1].content == "سلام! معمولاً چه ساعاتی کار می‌کنی؟"


@pytest.mark.asyncio
async def test_onboarding_extract_and_save_profile(db_session, test_user):
    """Test extracting profile data from conversation history and persisting it."""
    service = OnboardingService(db_session)
    session = service.create_session(test_user.id)

    # Populate session with sample conversation messages
    service.add_message(session.id, "user", "من برنامه‌نویس وب هستم.")
    service.add_message(session.id, "assistant", "ساعت کاری شما چطور است؟")
    service.add_message(session.id, "user", "از ۹ صبح تا ۱۷ کار می‌کنم و ساعت ۲۳ می‌خوابم.")

    # Mock LLM structured extraction output
    mock_extracted_json = {
        "occupation": "برنامه‌نویس وب",
        "education": "مهندسی نرم‌افزار",
        "work_schedule": {
            "start_time": "09:00",
            "end_time": "17:00",
        },
        "sleep_schedule": {
            "bedtime": "23:00",
            "wake_up_time": "07:00",
        },
        "lifestyle_summary": "برنامه‌نویس با ساعات کاری منظم",
        "preferences": "تمرکز بالا در صبح",
        "constraints": "جلسات تیم در عصر",
    }

    mock_llm = AsyncMock(spec=LLMService)
    mock_llm.generate_response.return_value = json.dumps(mock_extracted_json)

    # Execute extraction & persist
    profile = await service.extract_and_save_profile(
        user_id=test_user.id,
        llm=mock_llm,
    )

    # Assert profile data was persisted correctly
    assert profile.user_id == test_user.id
    assert profile.occupation == "برنامه‌نویس وب"
    assert profile.education == "مهندسی نرم‌افزار"
    assert profile.work_schedule == "09:00 - 17:00"
    assert profile.sleep_schedule == "23:00 - 07:00"
    assert profile.lifestyle_summary == "برنامه‌نویس با ساعات کاری منظم"

    # Assert session marked as completed
    assert session.status == "completed"
    assert session.completed_at is not None
    assert service.is_onboarding_completed(test_user.id) is True
