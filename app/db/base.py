"""Database engine, declarative base, session factory, and core user model."""

from datetime import datetime, timezone
from typing import Generator

from sqlalchemy import Boolean, BigInteger, DateTime, Integer, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from app.core.config import settings

# Database engine initialization
engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {},
    echo=False,
)

# Standard sessionmaker for application workflows
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """Base declarative class for all database models."""
    pass


class User(Base):
    """Application user model mapping Telegram identity and access roles."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True, nullable=False)
    username: Mapped[str] = mapped_column(String(255), nullable=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(50), default="user", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


def init_db() -> None:
    """Create all configured database tables."""
    Base.metadata.create_all(bind=engine)


def get_db() -> Generator:
    """Dependency helper to yield isolated database sessions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
