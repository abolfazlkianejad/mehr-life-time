"""Centralized logging configuration."""

import logging
import sys
from app.core.config import settings


def setup_logging() -> logging.Logger:
    """Configure and return the root logger for the application.

    Returns:
        logging.Logger: Configured application logger instance.
    """
    log_level = logging.DEBUG if settings.DEBUG else logging.INFO

    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)s:%(funcName)s:%(lineno)d - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    app_logger = logging.getLogger("mehr_life_time")
    app_logger.setLevel(log_level)

    # Prevent duplicate handlers if called multiple times
    if not app_logger.handlers:
        app_logger.addHandler(handler)

    return app_logger


logger = setup_logging()
