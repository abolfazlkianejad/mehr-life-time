"""Authorize the system Telegram account and save its encrypted session.

Run locally after setting TELEGRAM_API_ID, TELEGRAM_API_HASH, and a generated
TELEGRAM_SESSION_ENCRYPTION_KEY in .env. Login prompts stay in this terminal.
"""

import asyncio

from telethon import TelegramClient
from telethon.sessions import StringSession

from app.core.config import settings
from app.services.secure_telegram_session import save_session_string


async def main() -> None:
    if not settings.TELEGRAM_API_ID or not settings.TELEGRAM_API_HASH:
        raise SystemExit("Set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env first.")

    if not settings.TELEGRAM_SESSION_ENCRYPTION_KEY:
        raise SystemExit("Set TELEGRAM_SESSION_ENCRYPTION_KEY in .env first.")

    client = TelegramClient(
        StringSession(),
        settings.TELEGRAM_API_ID,
        settings.TELEGRAM_API_HASH,
    )
    await client.start()
    account = await client.get_me()
    save_session_string(client.session.save())
    print(f"Authorized system account: @{account.username or account.id}")
    print(f"Encrypted session saved to: {settings.TELEGRAM_USER_SESSION}")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
