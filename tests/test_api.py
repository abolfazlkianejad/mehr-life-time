"""Tests for the FastAPI liveness and readiness endpoints."""

from unittest.mock import Mock

import httpx
import pytest
from sqlalchemy.exc import OperationalError

from app import api


@pytest.mark.asyncio
async def test_health_check_returns_application_name() -> None:
    """Return a successful liveness response without database access."""
    transport = httpx.ASGITransport(app=api.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "application": api.settings.APP_NAME,
    }


@pytest.mark.asyncio
async def test_readiness_check_confirms_database() -> None:
    """Return readiness when the configured database accepts a query."""
    transport = httpx.ASGITransport(app=api.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


@pytest.mark.asyncio
async def test_readiness_check_hides_database_error_details(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Return a generic 503 if the database cannot be reached."""
    monkeypatch.setattr(
        api.engine,
        "connect",
        Mock(side_effect=OperationalError("SELECT 1", {}, RuntimeError("offline"))),
    )
    transport = httpx.ASGITransport(app=api.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {"detail": "The database is not ready."}
