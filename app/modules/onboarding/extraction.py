"""AI-powered profile extraction for onboarding."""

import json

from app.modules.onboarding.schemas import ProfileExtraction
from app.services.llm import LLMService


class ProfileExtractionService:
    """Extract structured profile information from onboarding conversations."""

    def __init__(self, llm_service: LLMService):
        self.llm_service = llm_service

    async def extract(
        self,
        conversation: list[dict[str, str]],
    ) -> ProfileExtraction:
        """Extract structured profile data from a conversation."""

        system_prompt = """
You are a profile extraction assistant.

Analyze the onboarding conversation and extract only information
that is explicitly stated or strongly supported by the user.

Return ONLY valid JSON.
Do not include markdown.
Do not include explanations.

The JSON must contain exactly these fields:

{
    "occupation": null,
    "education": null,
    "work_schedule": {
        "start_time": null,
        "end_time": null
    },
    "sleep_schedule": {
        "bedtime": null,
        "wake_up_time": null
    },
    "lifestyle_summary": null,
    "preferences": null,
    "constraints": null
}

IMPORTANT:
- "work_schedule" MUST always be an object or null.
- If work hours are known, use:
  {
      "start_time": "...",
      "end_time": "..."
  }
- "sleep_schedule" MUST always be an object or null.
- If sleep hours are known, use:
  {
      "bedtime": "...",
      "wake_up_time": "..."
  }
- Never return "work_schedule" as a string.
- Never return "sleep_schedule" as a string.
- If the schedule is unknown, return null.
- Do not invent missing information.

If a field is not known from the conversation, use null.
"""

        messages = [
            {
                "role": "system",
                "content": system_prompt,
            },
            *conversation,
        ]

        response = await self.llm_service.generate_response(
            messages=messages,
            temperature=0.0,
        )

        try:
            data = json.loads(response)
        except json.JSONDecodeError as exc:
            raise ValueError(
                "LLM returned invalid JSON during profile extraction."
            ) from exc

        return ProfileExtraction.model_validate(data)