"""Database engine and session management."""

from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings


database_url = make_url(settings.DATABASE_URL)
is_sqlite = database_url.get_backend_name() == "sqlite"
database_path = database_url.database
is_memory_database = (
    database_path in (None, "", ":memory:")
    or database_url.query.get("mode") == "memory"
)

if is_sqlite and database_path and not is_memory_database:
    Path(database_path).expanduser().parent.mkdir(parents=True, exist_ok=True)

connect_args = {"check_same_thread": False} if is_sqlite else {}

engine = create_engine(
    database_url,
    connect_args=connect_args,
    echo=False,
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


def get_db() -> Generator[Session, None, None]:
    """Provide a database session scope."""
    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()
