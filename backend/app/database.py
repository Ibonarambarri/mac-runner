"""
MacRunner - Database Configuration
SQLite database setup with SQLModel.
"""

from sqlmodel import SQLModel, create_engine, Session
from pathlib import Path

# Database file location
DATABASE_PATH = Path(__file__).parent.parent / "macrunner.db"
DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

# Create engine with SQLite
# connect_args needed for SQLite to allow multi-threaded access
engine = create_engine(
    DATABASE_URL,
    echo=False,  # Set True for SQL debugging
    connect_args={"check_same_thread": False}
)


def create_db_and_tables():
    """Initialize database and create all tables."""
    SQLModel.metadata.create_all(engine)


def get_session():
    """Dependency for FastAPI to get database session."""
    with Session(engine) as session:
        yield session
