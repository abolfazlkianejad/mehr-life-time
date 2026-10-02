"""Application entry point for bootstrap verification."""

from app.core.config import settings
from app.core.logging import logger


def main() -> None:
    """Run the initial bootstrap check."""
    logger.info("Initializing %s...", settings.APP_NAME)
    logger.info("Environment: %s | Timezone: %s", settings.APP_ENV, settings.TIMEZONE)
    logger.info("Core setup initialized successfully.")


if __name__ == "__main__":
    main()
