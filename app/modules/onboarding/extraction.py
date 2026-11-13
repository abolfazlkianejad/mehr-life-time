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
        "end_time": null,
        "weekdays": []
    },
    "sleep_schedule": {
        "bedtime": null,
        "wake_up_time": null
    },
    "lifestyle_summary": null,
    "preferences": null,
    "constraints": null,
    "priorities": null,
    "work_days": [],
    "fixed_commitments": [],
    "daily_free_time": null,
    "energy_patterns": null,
    "life_areas": []
}

IMPORTANT:
- "work_schedule" MUST always be an object or null.
- If work hours are known, use:
  {
      "start_time": "...",
      "end_time": "...",
      "weekdays": [0, 1, 2, 3, 4]
  }
- weekday numbering is 0=Monday through 6=Sunday. Extract actual work days only if stated; otherwise use an empty list.
- "sleep_schedule" MUST always be an object or null.
- If sleep hours are known, use:
  {
      "bedtime": "...",
      "wake_up_time": "..."
  }
- Never return "work_schedule" as a string.
- Never return "sleep_schedule" as a string.
- If the schedule is unknown, return null.
- "fixed_commitments" is a list of objects with title, start_time, end_time, and optional weekdays (0=Monday).
- "life_areas" is a list of explicitly mentioned recurring domains or substantial projects; each item has key, title, description, is_project.
- Extract priorities, daily free time, and energy patterns only when the user stated them.
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

        candidate = response.strip()
        if candidate.startswith("```"):
            candidate = candidate.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start >= 0 and end > start:
            candidate = candidate[start : end + 1]
        try:
            data = json.loads(candidate)
        except json.JSONDecodeError as exc:
            raise ValueError(
                "LLM returned invalid JSON during profile extraction."
            ) from exc

        return ProfileExtraction.model_validate(data)
