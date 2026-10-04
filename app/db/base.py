"""Database models and initialization."""

from datetime import datetime
from sqlalchemy import Boolean, Column, DateTime, Integer, String
from sqlalchemy.orm import declarative_base

from app.db.session import engine

Base = declarative_base()


class User(Base):
    """User model representing a Telegram user in the system."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    telegram_id = Column(Integer, unique=True, index=True, nullable=False)
    username = Column(String(255), nullable=True)
    first_name = Column(String(255), nullable=True)
    is_admin = Column(Boolean, default=False)
    is_approved = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


def init_db() -> None:
    """Create all database tables."""
    Base.metadata.create_all(bind=engine)
