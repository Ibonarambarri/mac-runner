"""
MacRunner - Database Models
SQLModel models for Projects and Jobs with SQLite backend.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Optional
from sqlmodel import Field, SQLModel, Relationship


def utc_now() -> datetime:
    """Return current UTC datetime (timezone-aware)."""
    return datetime.now(timezone.utc)


class ProjectStatus(str, Enum):
    """Status states for a project."""
    IDLE = "idle"
    CLONING = "cloning"
    RUNNING = "running"
    ERROR = "error"


class JobStatus(str, Enum):
    """Status states for a job execution."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    STOPPED = "stopped"


class ProjectBase(SQLModel):
    """Base model for Project with shared fields."""
    name: str = Field(index=True)
    repo_url: str
    install_command: str = "pip install -r requirements.txt"
    run_command: str = "python main.py"


class Project(ProjectBase, table=True):
    """
    Project table - stores GitHub repos and their configurations.
    Each project has a dedicated workspace folder and virtual environment.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    status: ProjectStatus = Field(default=ProjectStatus.IDLE)
    workspace_path: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)

    # Relationships
    jobs: list["Job"] = Relationship(back_populates="project")
    command_templates: list["CommandTemplate"] = Relationship(back_populates="project", sa_relationship_kwargs={"cascade": "all, delete-orphan"})


class ProjectCreate(ProjectBase):
    """Schema for creating a new project."""
    pass


class ProjectUpdate(SQLModel):
    """Schema for updating a project."""
    name: Optional[str] = None
    install_command: Optional[str] = None
    run_command: Optional[str] = None


class ProjectRead(ProjectBase):
    """Schema for reading a project."""
    id: int
    status: ProjectStatus
    workspace_path: Optional[str]
    created_at: datetime


class Job(SQLModel, table=True):
    """
    Job table - tracks individual executions of a project.
    Each run creates a new job with its own log file.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id")
    start_time: datetime = Field(default_factory=utc_now)
    end_time: Optional[datetime] = None
    status: JobStatus = Field(default=JobStatus.PENDING)
    log_path: Optional[str] = None
    pid: Optional[int] = None  # Process ID for stopping
    command_name: Optional[str] = None  # Name of the command template executed
    command_executed: Optional[str] = None  # The exact command that was run

    # Relationship to project
    project: Optional[Project] = Relationship(back_populates="jobs")


class JobRead(SQLModel):
    """Schema for reading a job."""
    id: int
    project_id: int
    start_time: datetime
    end_time: Optional[datetime]
    status: JobStatus
    log_path: Optional[str]
    command_name: Optional[str]
    command_executed: Optional[str]


# ============================================================================
# COMMAND TEMPLATE MODELS
# ============================================================================

class CommandTemplateBase(SQLModel):
    """Base model for CommandTemplate."""
    name: str = Field(index=True)
    command: str
    description: Optional[str] = None


class CommandTemplate(CommandTemplateBase, table=True):
    """
    CommandTemplate table - stores reusable command templates per project.
    Allows multiple executable commands per project (test, build, deploy, etc.)
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id")
    created_at: datetime = Field(default_factory=utc_now)

    # Relationship to project
    project: Optional[Project] = Relationship(back_populates="command_templates")


class CommandTemplateCreate(CommandTemplateBase):
    """Schema for creating a command template."""
    pass


class CommandTemplateUpdate(SQLModel):
    """Schema for updating a command template."""
    name: Optional[str] = None
    command: Optional[str] = None
    description: Optional[str] = None


class CommandTemplateRead(CommandTemplateBase):
    """Schema for reading a command template."""
    id: int
    project_id: int
    created_at: datetime
