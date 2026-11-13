"""Create a private forum supergroup with the system-owned Telegram account."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.core.config import settings

logger = logging.getLogger("mehr_life_time.services.telegram_workspace_creator")


class WorkspaceCreatorUnavailable(RuntimeError):
    """Raised when the system-owned Telegram account is not ready."""


@dataclass(frozen=True, slots=True)
class CreatedWorkspace:
    chat_id: int
    title: str
    invite_link: str
    user_added: bool
    bot_added: bool
    setup_error: str | None = None


class TelegramWorkspaceCreator:
    """MTProto account wrapper. The bot token cannot create supergroups."""

    def __init__(self) -> None:
        self._client = None

    @property
    def configured(self) -> bool:
        return bool(settings.TELEGRAM_API_ID and settings.TELEGRAM_API_HASH)

    async def connect(self) -> bool:
        """Connect to an already-authorized local Telegram user session."""
        if not self.configured:
            logger.warning("Telegram user-account API credentials are not configured.")
            return False

        from telethon import TelegramClient
        from telethon.sessions import StringSession

        from app.services.secure_telegram_session import load_session_string

        self._client = TelegramClient(
            StringSession(load_session_string()),
            settings.TELEGRAM_API_ID,
            settings.TELEGRAM_API_HASH,
        )
        await self._client.connect()
        if not await self._client.is_user_authorized():
            logger.error("The Telegram creator session is not authorized.")
            await self._client.disconnect()
            self._client = None
            return False
        account = await self._client.get_me()
        logger.info("Telegram workspace creator connected as user %s.", account.id)
        return True

    async def ensure_connected(self) -> bool:
        if self._client is not None and await self._client.is_user_authorized():
            return True
        return await self.connect()

    async def disconnect(self) -> None:
        if self._client is not None:
            await self._client.disconnect()
            self._client = None

    async def create_workspace(
        self,
        *,
        full_name: str,
        telegram_username: str | None,
        bot_username: str,
    ) -> CreatedWorkspace:
        """Create a private forum, make the bot a topic manager, and invite user."""
        if self._client is None or not await self._client.is_user_authorized():
            raise WorkspaceCreatorUnavailable(
                "Telegram creator account is not connected or authorized."
            )
        if not bot_username.strip():
            raise WorkspaceCreatorUnavailable("TELEGRAM_BOT_USERNAME is not configured.")

        from telethon import functions, types, utils
        from telethon.errors import RPCError

        title = f"{full_name.strip() or 'کاربر'} | Mehr Life"[:128]
        created = await self._client(
            functions.channels.CreateChannelRequest(
                title=title,
                about="فضای خصوصی برنامه‌ریزی زندگی، کار، درس و هدف‌ها.",
                megagroup=True,
                forum=True,
            )
        )
        channel = next(
            (
                chat
                for chat in getattr(created, "chats", [])
                if getattr(chat, "megagroup", False)
            ),
            None,
        )
        if channel is None:
            raise WorkspaceCreatorUnavailable(
                "Telegram did not return the created forum supergroup."
            )
        channel_input = await self._client.get_input_entity(channel)

        bot_added = False
        setup_error = None
        try:
            bot_input = await self._client.get_input_entity(
                bot_username.lstrip("@")
            )
            try:
                await self._client(
                    functions.channels.InviteToChannelRequest(
                        channel=channel_input,
                        users=[bot_input],
                    )
                )
            except RPCError as exc:
                # The bot may already be present; promotion below is the final check.
                logger.info(
                    "Bot invite returned %s for workspace %s; attempting promotion.",
                    type(exc).__name__,
                    channel.id,
                )
            await self._client(
                functions.channels.EditAdminRequest(
                    channel=channel_input,
                    user_id=bot_input,
                    admin_rights=types.ChatAdminRights(
                        change_info=True,
                        delete_messages=True,
                        invite_users=True,
                        pin_messages=True,
                        manage_topics=True,
                    ),
                    rank="Mehr Life",
                )
            )
            bot_added = True
        except (RPCError, ValueError) as exc:
            setup_error = type(exc).__name__
            logger.exception(
                "Could not add and promote the bot in Telegram workspace %s.",
                channel.id,
            )

        user_added = False
        if telegram_username:
            try:
                user_input = await self._client.get_input_entity(
                    telegram_username.lstrip("@")
                )
                await self._client(
                    functions.channels.InviteToChannelRequest(
                        channel=channel_input,
                        users=[user_input],
                    )
                )
                user_added = True
            except RPCError as exc:
                logger.info(
                    "Could not directly add Telegram user %s to workspace %s; "
                    "an invite link will be sent (%s).",
                    telegram_username,
                    channel.id,
                    type(exc).__name__,
                )
            except ValueError:
                logger.info(
                    "Telegram username %s could not be resolved; using an invite link.",
                    telegram_username,
                )

        exported = await self._client(
            functions.messages.ExportChatInviteRequest(peer=channel_input)
        )
        return CreatedWorkspace(
            chat_id=utils.get_peer_id(channel),
            title=title,
            invite_link=exported.link,
            user_added=user_added,
            bot_added=bot_added,
            setup_error=setup_error,
        )


telegram_workspace_creator = TelegramWorkspaceCreator()
