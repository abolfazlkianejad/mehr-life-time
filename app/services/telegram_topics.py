"""
Telegram Forum Topics Management Service.
Handles automatic creation and verification of core Life OS topics.
"""

import logging
from typing import Dict
from telegram import Bot
from telegram.error import TelegramError

logger = logging.getLogger(__name__)

# Core Life OS Topics definition
DEFAULT_TOPICS: Dict[str, str] = {
    "work": "💼 کار و پروژه‌ها",
    "lifestyle": "🌱 سبک زندگی و ریکاوری",
    "reports": "📊 گزارشات و تحلیل",
    "assistant": "🤖 دستیار هوشمند",
}


class TopicService:
    """Service to create and manage Telegram forum topics."""

    @staticmethod
    async def ensure_topics(bot: Bot, chat_id: int) -> Dict[str, int]:
        """
        Create default topics in the forum supergroup.

        Args:
            bot: Active telegram.Bot instance.
            chat_id: Supergroup ID with forum enabled.

        Returns:
            Dict[str, int]: Mapping of topic key to thread_id.
        """
        created_threads: Dict[str, int] = {}

        for key, topic_name in DEFAULT_TOPICS.items():
            try:
                forum_topic = await bot.create_forum_topic(
                    chat_id=chat_id,
                    name=topic_name,
                )
                created_threads[key] = forum_topic.message_thread_id
                logger.info(
                    "Created topic '%s' (thread_id: %s) in chat %s",
                    topic_name,
                    forum_topic.message_thread_id,
                    chat_id,
                )
            except TelegramError as exc:
                logger.error(
                    "Failed to create topic '%s' in chat %s: %s",
                    topic_name,
                    chat_id,
                    exc,
                )
                raise exc

        return created_threads


topic_service = TopicService()
