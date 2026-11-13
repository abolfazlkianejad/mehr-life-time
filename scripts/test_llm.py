# scripts/test_llm.py
"""Standalone script to verify communication with the local Ollama service."""

import asyncio
from pathlib import Path
import sys

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.services.llm import llm_service


async def main() -> None:
    """Run a health check prompt against the configured Ollama model."""
    print("[*] Testing connection to local Ollama daemon...")
    test_messages = [
        {
            "role": "system",
            "content": " a concise system health check bot. Reply in one short Persian sentence.",
        },
        {
            "role": "user",
            "content": "سلام، وضعیت سرویس را اعلام کن.",
        },
    ]

    try:
        reply = await llm_service.generate_response(test_messages, temperature=0.2)
        print("\n[+] Success! Ollama responded:")
        print(f"    {reply}\n")
    except Exception as err:
        print(f"\n[-] Verification failed: {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
