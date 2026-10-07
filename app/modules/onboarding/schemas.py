"""Schemas for structured AI onboarding data."""

from pydantic import BaseModel, Field


class WorkSchedule(BaseModel):
    """User's usual work schedule."""

    start_time: str | None = Field(
        default=None,
        description="Usual work start time.",
    )

    end_time: str | None = Field(
        default=None,
        description="Usual work end time.",
    )


class SleepSchedule(BaseModel):
    """User's usual sleep schedule."""

    bedtime: str | None = Field(
        default=None,
        description="Usual bedtime.",
    )

    wake_up_time: str | None = Field(
        default=None,
        description="Usual wake-up time.",
    )


class ProfileExtraction(BaseModel):
    """Structured information extracted from the user's onboarding messages."""

    occupation: str | None = Field(
        default=None,
        description="The user's job, profession, or main occupation.",
    )

    education: str | None = Field(
        default=None,
        description="The user's education or field of study.",
    )

    work_schedule: WorkSchedule | None = Field(
        default=None,
        description="The user's usual work schedule.",
    )

    sleep_schedule: SleepSchedule | None = Field(
        default=None,
        description="The user's usual sleep and wake schedule.",
    )

    lifestyle_summary: str | None = Field(
        default=None,
        description="A concise summary of the user's current lifestyle.",
    )

    preferences: str | None = Field(
        default=None,
        description="Important preferences that affect planning.",
    )

    constraints: str | None = Field(
        default=None,
        description="Important limitations or constraints affecting planning.",
    )