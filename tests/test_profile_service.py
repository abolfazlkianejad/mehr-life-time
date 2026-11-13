"""Tests for ProfileService and Onboarding completion flow."""

import random
import pytest
from app.db.base import Base, User
from app.db.session import engine, SessionLocal
from app.modules.onboarding.service import OnboardingService
from app.services.profile_service import ProfileService


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


def test_onboarding_session_completion_and_profile_update(db_session):
    """Test full onboarding completion cycle and user profile updates."""
    unique_tg_id = random.randint(100_000_000, 999_999_999)
    user = User(
        telegram_id=unique_tg_id,
        username=f"test_{unique_tg_id}",
        full_name="Verification User",
        role="user",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    try:
        # 1. Test Onboarding session lifecycle
        onboarding_service = OnboardingService(db_session)
        onboarding_session = onboarding_service.create_session(user_id=user.id)
        assert onboarding_session.status == "active"
        assert onboarding_session.completed_at is None

        completed_session = onboarding_service.complete_session(
            session_id=onboarding_session.id
        )
        assert completed_session is not None
        assert completed_session.status == "completed"
        assert completed_session.completed_at is not None

        # 2. Test ProfileService update
        profile_service = ProfileService(db_session)
        profile = profile_service.update_profile(
            user_id=user.id,
            occupation="توسعه‌دهنده نرم‌افزار",
            education="مهندسی کامپیوتر",
            work_schedule="09:00 - 17:00",
        )

        assert profile.occupation == "توسعه‌دهنده نرم‌افزار"
        assert profile.education == "مهندسی کامپیوتر"
        assert profile.work_schedule == "09:00 - 17:00"

    finally:
        db_session.delete(user)
        db_session.commit()
