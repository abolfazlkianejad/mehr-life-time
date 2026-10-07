import app.modules.onboarding.models

from app.db.base import User
from app.db.session import SessionLocal
from app.modules.onboarding.extraction import ProfileExtractionService
from app.services.llm import LLMService
from app.services.profile_service import ProfileService


def main():
    db = SessionLocal()

    try:
        user = User(
            telegram_id=999999999,
            username="profile_test_user",
            full_name="Profile Test User",
            role="user",
            is_active=True,
        )

        db.add(user)
        db.commit()
        db.refresh(user)

        conversation = [
            {
                "role": "user",
                "content": "من برنامه نویس هستم و مهندسی کامپیوتر خوندم.",
            },
            {
                "role": "user",
                "content": "از ۹ صبح تا ۵ عصر کار می‌کنم.",
            },
            {
                "role": "user",
                "content": "۱۲ شب می‌خوابم و ۷ صبح بیدار می‌شوم.",
            },
            {
                "role": "user",
                "content": (
                    "بیشتر روز پشت کامپیوتر هستم. "
                    "صبح‌ها تمرکز بیشتری دارم و کارهای سخت را صبح انجام می‌دهم."
                ),
            },
        ]

        extraction_service = ProfileExtractionService(LLMService())

        import asyncio

        profile_data = asyncio.run(
            extraction_service.extract(conversation)
        )

        profile_service = ProfileService(db)

        work_schedule = None

        if profile_data.work_schedule:
         work_schedule = (
            f"{profile_data.work_schedule.start_time} "
            f"تا {profile_data.work_schedule.end_time}"
    )


        sleep_schedule = None

        if profile_data.sleep_schedule:
            sleep_schedule = (
                f"{profile_data.sleep_schedule.bedtime} "
                f"تا {profile_data.sleep_schedule.wake_up_time}"
            )


        profile = profile_service.update_profile(
        user.id,
        occupation=profile_data.occupation,
        education=profile_data.education,
        work_schedule=work_schedule,
        sleep_schedule=sleep_schedule,
        lifestyle_summary=profile_data.lifestyle_summary,
        preferences=profile_data.preferences,
        constraints=profile_data.constraints,
        )

        print("USER ID:", user.id)
        print("OCCUPATION:", profile.occupation)
        print("EDUCATION:", profile.education)
        print("WORK SCHEDULE:", profile.work_schedule)
        print("SLEEP SCHEDULE:", profile.sleep_schedule)
        print("LIFESTYLE:", profile.lifestyle_summary)
        print("PREFERENCES:", profile.preferences)
        print("CONSTRAINTS:", profile.constraints)

        print("PROFILE EXTRACTION SAVE TEST: OK")

    finally:
        if "user" in locals() and user.id:
            db.query(User).filter(User.id == user.id).delete()
            db.commit()

        db.close()


if __name__ == "__main__":
    main()