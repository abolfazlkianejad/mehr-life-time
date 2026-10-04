"""User management business logic and database interactions."""

import logging
from typing import Optional
from sqlalchemy.orm import Session
from app.db.base import User

logger = logging.getLogger(__name__)


def get_user_by_telegram_id(db: Session, telegram_id: int) -> Optional[User]:
    """Retrieve a user by their unique Telegram user ID."""
    return db.query(User).filter(User.telegram_id == telegram_id).first()


def register_user(
    db: Session,
    telegram_id: int,
    username: Optional[str] = None,
    full_name: Optional[str] = None,
    role: str = "user",
) -> User:
    """Register or return an existing user with initial privileges."""
    user = get_user_by_telegram_id(db, telegram_id)
    if user:
        return user

    user = User(
        telegram_id=telegram_id,
        username=username,
        full_name=full_name,
        role=role,
        is_active=True if role == "admin" else False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def approve_user(db: Session, user_id: int) -> Optional[User]:
    """Approve a registered user by primary key ID, granting bot access."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return None

    user.is_active = True
    db.commit()
    db.refresh(user)
    return user


def reject_user(db: Session, user_id: int) -> Optional[int]:
    """Reject and delete an unapproved user registration. Returns telegram_id if deleted."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return None

    telegram_id = user.telegram_id
    db.delete(user)
    db.commit()
    return telegram_id
