"""Tests for structured application logging."""

import json
import logging

from app.core.logging import JsonFormatter


def test_json_formatter_emits_structured_log_record() -> None:
    """Ensure log records are serialized as JSON with expected metadata."""
    record = logging.LogRecord(
        name="mehr_life_time.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=42,
        msg="Saved %s",
        args=("work session",),
        exc_info=None,
        func="test_json_formatter_emits_structured_log_record",
    )

    payload = json.loads(JsonFormatter().format(record))

    assert payload["level"] == "INFO"
    assert payload["logger"] == "mehr_life_time.test"
    assert payload["message"] == "Saved work session"
    assert payload["module"] == "test_logging"
    assert payload["function"] == "test_json_formatter_emits_structured_log_record"
    assert payload["line"] == 42
    assert payload["timestamp"].endswith("Z")
