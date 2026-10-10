"""Centralized structured logging configuration."""

import json
import logging
import sys
from datetime import datetime, timezone

from app.core.config import settings


class JsonFormatter(logging.Formatter):
    """Format log records as one JSON object per line."""

    def format(self, record: logging.LogRecord) -> str:
        """Serialize a log record with timestamp, level, source, and message."""
        timestamp = datetime.fromtimestamp(
            record.created,
            tz=timezone.utc,
        ).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        payload: dict[str, str | int] = {
            "timestamp": timestamp,
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
        }

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def setup_logging() -> logging.Logger:
    """Configure and return the application logger.

    Returns:
        logging.Logger: Configured application logger instance.
    """
    log_level = logging.DEBUG if settings.DEBUG else logging.INFO

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    app_logger = logging.getLogger("mehr_life_time")
    app_logger.setLevel(log_level)
    app_logger.propagate = False

    # Prevent duplicate handlers if called multiple times.
    if not app_logger.handlers:
        app_logger.addHandler(handler)

    return app_logger


logger = setup_logging()
