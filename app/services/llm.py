"""
Local LLM Service integration module using Ollama API.
Provides an asynchronous client to generate text and chat completions.
"""

import logging
from typing import Any, Dict, List, Optional
import httpx
from app.core.config import settings

logger = logging.getLogger(__name__)


class LLMService:
    """Service class for interacting with the local Ollama instance."""

    def __init__(self) -> None:
        """Initialize base URL, default model name, and client timeout."""
        self.base_url: str = settings.LLM_BASE_URL.rstrip("/")
        self.default_model: str = settings.LLM_MODEL_NAME
        self.timeout: float = 90.0

    async def generate_response(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
    ) -> str:
        """
        Send a chat completion request to the Ollama API.

        Args:
            messages: List of message dictionaries with 'role' and 'content'.
            model: Optional model override. Defaults to settings.LLM_MODEL_NAME.
            temperature: Sampling temperature for generation.

        Returns:
            str: Generated response content.

        Raises:
            RuntimeError: If the Ollama API call fails.
        """
        target_model = model or self.default_model
        endpoint = f"{self.base_url}/api/chat"
        payload: Dict[str, Any] = {
            "model": target_model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(endpoint, json=payload)
                if response.status_code != 200:
                    error_detail = response.text
                    logger.error(
                        "Ollama error %s for model '%s': %s",
                        response.status_code,
                        target_model,
                        error_detail,
                    )
                    raise RuntimeError(
                        f"Ollama error ({response.status_code}) on model '{target_model}': {error_detail}"
                    )

                data = response.json()
                return data.get("message", {}).get("content", "").strip()

        except httpx.RequestError as exc:
            error_msg = f"Network connection failed to Ollama at {endpoint}: {exc}"
            logger.error(error_msg)
            raise RuntimeError(error_msg) from exc


# Global singleton instance
llm_service = LLMService()
