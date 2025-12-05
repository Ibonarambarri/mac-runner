"""
MacRunner - Database Configuration
SQLite database setup with SQLModel.
"""

import sqlite3
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


def run_migrations():
    """
    Run database migrations for schema changes.
    SQLite doesn't support ALTER TABLE ADD COLUMN with defaults well,
    so we check if columns exist and add them if missing.
    """
    if not DATABASE_PATH.exists():
        return  # No database yet, will be created fresh

    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    # Check if columns exist in project table
    cursor.execute("PRAGMA table_info(project)")
    columns = [col[1] for col in cursor.fetchall()]

    if "run_command_enabled" not in columns:
        print("Migration: Adding run_command_enabled column to project table")
        cursor.execute("ALTER TABLE project ADD COLUMN run_command_enabled BOOLEAN DEFAULT 1")
        conn.commit()

    if "run_notebook_enabled" not in columns:
        print("Migration: Adding run_notebook_enabled column to project table")
        cursor.execute("ALTER TABLE project ADD COLUMN run_notebook_enabled BOOLEAN DEFAULT 0")
        conn.commit()

    if "default_notebook" not in columns:
        print("Migration: Adding default_notebook column to project table")
        cursor.execute("ALTER TABLE project ADD COLUMN default_notebook TEXT DEFAULT NULL")
        conn.commit()

    if "environment_type" not in columns:
        print("Migration: Adding environment_type column to project table")
        cursor.execute("ALTER TABLE project ADD COLUMN environment_type TEXT DEFAULT 'venv'")
        conn.commit()

    if "python_version" not in columns:
        print("Migration: Adding python_version column to project table")
        cursor.execute("ALTER TABLE project ADD COLUMN python_version TEXT DEFAULT NULL")
        conn.commit()

    conn.close()


def create_db_and_tables():
    """Initialize database and create all tables."""
    # Run migrations first for existing databases
    run_migrations()
    # Create any new tables
    SQLModel.metadata.create_all(engine)


def get_session():
    """Dependency for FastAPI to get database session."""
    with Session(engine) as session:
        yield session
