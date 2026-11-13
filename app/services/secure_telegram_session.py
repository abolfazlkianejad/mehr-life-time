"""Encrypted-at-rest storage for the system Telegram account session."""

from __future__ import annotations

from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


class SecureSessionError(RuntimeError):
    """Raised when an encrypted Telegram session cannot be loaded or saved."""


def _fernet() -> Fernet:
    key = settings.TELEGRAM_SESSION_ENCRYPTION_KEY.strip()
    if not key:
        raise SecureSessionError(
            "Set TELEGRAM_SESSION_ENCRYPTION_KEY before authorizing the system account."
        )
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise SecureSessionError(
            "TELEGRAM_SESSION_ENCRYPTION_KEY must be a valid Fernet key."
        ) from exc


def load_session_string() -> str:
    path = Path(settings.TELEGRAM_USER_SESSION).expanduser()
    if not path.is_file():
        raise SecureSessionError(
            f"Encrypted Telegram session was not found at {path}. "
            "Run scripts/authorize_telegram_account.py first."
        )
    try:
        return _fernet().decrypt(path.read_bytes()).decode("utf-8")
    except (InvalidToken, UnicodeDecodeError) as exc:
        raise SecureSessionError(
            "Could not decrypt the Telegram session; check its encryption key."
        ) from exc


def save_session_string(session_string: str) -> None:
    path = Path(settings.TELEGRAM_USER_SESSION).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    encrypted = _fernet().encrypt(session_string.encode("utf-8"))
    path.write_bytes(encrypted)
    try:
        path.chmod(0o600)
    except OSError:
        # Windows ACLs are inherited from the containing data directory.
        pass
