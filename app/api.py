"""FastAPI health and readiness endpoints."""

from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.db.session import engine


class HealthResponse(BaseModel):
    """Liveness response that identifies the application."""

    status: Literal["ok"]
    application: str


class ReadinessResponse(BaseModel):
    """Readiness response confirming the application database is reachable."""

    status: Literal["ok"]
    database: Literal["ok"]


app = FastAPI(title=settings.APP_NAME)


@app.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    """Return a liveness response without accessing the database."""
    return HealthResponse(status="ok", application=settings.APP_NAME)


@app.get("/ready", response_model=ReadinessResponse)
def readiness_check() -> ReadinessResponse:
    """Return readiness after checking the configured database connection."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503,
            detail="The database is not ready.",
        ) from exc
    return ReadinessResponse(status="ok", database="ok")
