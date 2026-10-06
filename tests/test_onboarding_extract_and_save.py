"""Focused integration test for OnboardingService.extract_and_save_profile."""

import asyncio

import app.modules.onboarding.models
from app.db.base import User, UserProfile
from app.db.session import SessionLocal
from app.modules.onboarding.service import OnboardingService


def main() -> None:
    """Execute the extract_and_save_profile verification flow."""
    db = SessionLocal()

    try:
        # 1. Create temporary test user
        user = User(
            telegram_id=888888888,
            username="extract_save_tester",
            full_name="Extract Save Tester",
            role="user",
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        # 2. Create session and simulate onboarding messages
        onboarding_service = OnboardingService(db)
        session = onboarding_service.create_session(user_id=user.id)

        messages = [
            "من برنامه‌نویس فول‌استک هستم و مهندسی کامپیوتر خوندم.",
            "معمولاً ساعت ۹ صبح تا ۱۷ عصر کار می‌کنم.",
            "شب‌ها ساعت ۲۳:۳۰ می‌خوابم و صبح‌ها ۷ بیدار می‌شم.",
            "عاشق تمرکز صبحگاهی هستم و بعدازظهرها برای کارهای روتین مناسب‌تره.",
        ]

        for msg in messages:
            onboarding_service.add_user_message(session_id=session.id, content=msg)

        # 3. Call extract_and_save_profile
        profile: UserProfile = asyncio.run(
            onboarding_service.extract_and_save_profile(session_id=session.id)
        )

        # 4. Verify results
        assert profile is not None, "Profile should not be None"
        assert profile.user_id == user.id, "Profile user_id mismatch"

        print("=== EXTRACTION & SAVE SUCCESSFUL ===")
        print(f"USER ID: {profile.user_id}")
        print(f"OCCUPATION: {profile.occupation}")
        print(f"EDUCATION: {profile.education}")
        print(f"WORK SCHEDULE: {profile.work_schedule}")
        print(f"SLEEP SCHEDULE: {profile.sleep_schedule}")
        print(f"LIFESTYLE SUMMARY: {profile.lifestyle_summary}")
        print(f"PREFERENCES: {profile.preferences}")
        print(f"CONSTRAINTS: {profile.constraints}")
        print("TEST EXTRACT AND SAVE: OK")

    finally:
        # Cleanup test data
        if "user" in locals() and user.id:
            db.query(User).filter(User.id == user.id).delete()
            db.commit()
        db.close()


if __name__ == "__main__":
    main()
