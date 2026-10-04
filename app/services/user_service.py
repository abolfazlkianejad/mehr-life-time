"""User management and authorization database operations."""

from typing import Optional
from sqlalchemy.orm import Session
from app.db.base import User



def get_user_by_telegram_id(session: Session, telegram_id: int) -> Optional[User]:
    """Retrieve user entity by telegram unique identifier."""
    return session.query(User).filter(User.telegram_id == telegram_id).first()


def register_user(
    session: Session,
    telegram_id: int,
    username: Optional[str],
    first_name: Optional[str],
    is_admin: bool = False,
    is_approved: bool = False
) -> User:
    """Create or update a user upon registration attempt."""
    user = get_user_by_telegram_id(session, telegram_id)
    if not user:
        user = User(
            telegram_id=telegram_id,
            username=username,
            first_name=first_name,
            is_admin=is_admin,
            is_approved=is_approved,
        )
        session.add(user)
    else:
        user.username = username
        user.first_name = first_name
        if is_admin:
            user.is_admin = True
            user.is_approved = True

    session.commit()
    session.refresh(user)
    return user


def set_user_approval(session: Session, telegram_id: int, approved: bool) -> Optional[User]:
    """Approve or reject a user."""
    user = get_user_by_telegram_id(session, telegram_id)
    if user:
        user.is_approved = approved
        session.commit()
        session.refresh(user)
    return user
