"""Telegram bot command handlers."""

from telegram import Update
from telegram.ext import ContextTypes
from app.bot.security import restricted
from app.core.logging import logger


@restricted
async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /start command for authorized users.

    Args:
        update (Update): Telegram incoming update.
        context (ContextTypes.DEFAULT_TYPE): Telegram callback context.
    """
    if update.effective_message:
        welcome_text = (
            "🚀 **سیستم مدیریت زندگی و کار (Mehr Life Time)**\n\n"
            "ارتباط با موفقیت برقرار شد. سیستم آماده دریافت گزارش‌ها و مدیریت تسک‌ها است.\n\n"
            "دستورات اولیه:\n"
            "/ping - بررسی وضعیت اتصال سیستم"
        )
        await update.effective_message.reply_text(welcome_text, parse_mode="Markdown")
        logger.info("Sent start message to User ID: %s", update.effective_user.id)


@restricted
async def ping_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /ping command to verify system responsiveness.

    Args:
        update (Update): Telegram incoming update.
        context (ContextTypes.DEFAULT_TYPE): Telegram callback context.
    """
    if update.effective_message:
        await update.effective_message.reply_text("🏓 Pong! سیستم فعال و آنلاین است.")
        logger.info("Ping responded for User ID: %s", update.effective_user.id)
