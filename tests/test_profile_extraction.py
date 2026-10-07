import asyncio

from app.modules.onboarding.extraction import ProfileExtractionService
from app.services.llm import LLMService


async def main():
    service = ProfileExtractionService(LLMService())

    conversation = [
        {
            "role": "user",
            "content": "من برنامه نویس هستم و مهندسی کامپیوتر خوندم.",
        },
        {
            "role": "assistant",
            "content": "معمولاً چه ساعتی کار می‌کنی؟",
        },
        {
            "role": "user",
            "content": "از ۹ صبح تا ۵ عصر کار می‌کنم.",
        },
        {
            "role": "assistant",
            "content": "خواب و بیدار شدنت معمولاً چطوره؟",
        },
        {
            "role": "user",
            "content": "حدود ۱۲ شب می‌خوابم و ۷ صبح بیدار می‌شم.",
        },
        {
            "role": "assistant",
            "content": "سبک زندگی و ترجیحاتت برای برنامه‌ریزی چطوره؟",
        },
        {
            "role": "user",
            "content": (
                "بیشتر روز پشت کامپیوتر هستم. صبح‌ها تمرکز بیشتری دارم "
                "و دوست دارم کارهای سخت را صبح انجام بدهم. "
                "بعد از ساعت ۵ معمولاً وقت آزاد دارم."
            ),
        },
    ]

    profile = await service.extract(conversation)

    print("OCCUPATION:", profile.occupation)
    print("EDUCATION:", profile.education)
    print("WORK SCHEDULE:", profile.work_schedule)
    print("SLEEP SCHEDULE:", profile.sleep_schedule)
    print("LIFESTYLE:", profile.lifestyle_summary)
    print("PREFERENCES:", profile.preferences)
    print("CONSTRAINTS:", profile.constraints)


if __name__ == "__main__":
    asyncio.run(main())