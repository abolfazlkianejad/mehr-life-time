import asyncio

import app.modules.onboarding.models

from app.db.base import User
from app.db.session import SessionLocal
from app.modules.onboarding.service import OnboardingService


def main():
    db = SessionLocal()

    try:
        user = User(
            telegram_id=888888888,
            username="onboarding_test_user",
            full_name="Onboarding Test User",
            role="user",
            is_active=True,
        )

        db.add(user)
        db.commit()
        db.refresh(user)

        onboarding_service = OnboardingService(db)

        session = onboarding_service.create_session(user.id)

        onboarding_service.add_user_message(
            session.id,
            "من برنامه نویس هستم و مهندسی کامپیوتر خوندم.",
        )

        onboarding_service.add_assistant_message(
            session.id,
            "معمولاً چه ساعتی کار می‌کنی؟",
        )

        onboarding_service.add_user_message(
            session.id,
            "از 9 صبح تا 5 عصر کار می‌کنم.",
        )

        onboarding_service.add_assistant_message(
            session.id,
            "معمولاً چه ساعتی می‌خوابی و بیدار می‌شی؟",
        )

        onboarding_service.add_user_message(
            session.id,
            "حدود 12 شب می‌خوابم و 7 صبح بیدار می‌شوم.",
        )

        onboarding_service.add_assistant_message(
            session.id,
            "سبک زندگی و ترجیحاتت برای برنامه‌ریزی چطوره؟",
        )

        onboarding_service.add_user_message(
            session.id,
            "بیشتر روز پشت کامپیوتر هستم. "
            "صبح‌ها تمرکز بیشتری دارم و کارهای سخت را صبح انجام می‌دهم.",
        )

        profile_data = asyncio.run(
            onboarding_service.extract_profile(session.id)
        )

        print("USER ID:", user.id)
        print("SESSION ID:", session.id)
        print()

        print("OCCUPATION:", profile_data.occupation)
        print("EDUCATION:", profile_data.education)

        if profile_data.work_schedule:
            print(
                "WORK SCHEDULE:",
                profile_data.work_schedule.start_time,
                "تا",
                profile_data.work_schedule.end_time,
            )
        else:
            print("WORK SCHEDULE: None")

        if profile_data.sleep_schedule:
            print(
                "SLEEP SCHEDULE:",
                profile_data.sleep_schedule.bedtime,
                "تا",
                profile_data.sleep_schedule.wake_up_time,
            )
        else:
            print("SLEEP SCHEDULE: None")

        print("LIFESTYLE:", profile_data.lifestyle_summary)
        print("PREFERENCES:", profile_data.preferences)
        print("CONSTRAINTS:", profile_data.constraints)

        print()
        print("ONBOARDING PROFILE EXTRACTION TEST: OK")

    finally:
        if "user" in locals() and user.id:
            db.query(User).filter(User.id == user.id).delete()
            db.commit()

        db.close()


if __name__ == "__main__":
    main()