"""Service layer for user profiles."""

from sqlalchemy.orm import Session

from app.db.base import UserProfile


class ProfileService:
    """Manage user profile data."""

    def __init__(self, db: Session):
        self.db = db

    def get_profile(
        self,
        user_id: int,
    ) -> UserProfile | None:
        """Return a user's profile if it exists."""
        return (
            self.db.query(UserProfile)
            .filter(UserProfile.user_id == user_id)
            .first()
        )

    def create_profile(
        self,
        user_id: int,
    ) -> UserProfile:
        """Create an empty profile for a user."""
        profile = UserProfile(
            user_id=user_id,
        )

        self.db.add(profile)
        self.db.commit()
        self.db.refresh(profile)

        return profile

    def get_or_create_profile(
        self,
        user_id: int,
    ) -> UserProfile:
        """Return the user's profile or create it if missing."""
        profile = self.get_profile(user_id)

        if profile is not None:
            return profile

        return self.create_profile(user_id)
    def update_profile(
        self,
        user_id: int,
        **fields,
    ) -> UserProfile:
        """Update the user's profile fields."""
        profile = self.get_or_create_profile(user_id)

        allowed_fields = {
            "occupation",
            "education",
            "work_schedule",
            "sleep_schedule",
            "lifestyle_summary",
            "preferences",
            "constraints",
        }

        for field, value in fields.items():
            if field in allowed_fields:
                setattr(profile, field, value)

        self.db.commit()
        self.db.refresh(profile)

        return profile