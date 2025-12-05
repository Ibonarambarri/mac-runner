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


class UserRole(str, Enum):
    """Role types for users."""
    admin = "admin"
    worker = "worker"


class ProjectStatus(str, Enum):
    """Status states for a project."""
    IDLE = "idle"
    CLONING = "cloning"
    RUNNING = "running"
    ERROR = "error"


class EnvironmentType(str, Enum):
    """Type of Python environment for a project."""
    # Using lowercase names to match frontend values and database storage
    venv = "venv"
    conda = "conda"
    docker = "docker"


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
    run_command_enabled: bool = True  # Toggle to enable/disable run command
    run_notebook_enabled: bool = False  # Toggle to enable/disable notebook execution
    default_notebook: Optional[str] = None  # Path to default notebook to run
    environment_type: EnvironmentType = Field(default=EnvironmentType.venv)  # venv or conda
    python_version: Optional[str] = None  # Python version (e.g., "3.9", "3.11"). None = system default


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
    run_command_enabled: Optional[bool] = None
    run_notebook_enabled: Optional[bool] = None
    default_notebook: Optional[str] = None
    environment_type: Optional[EnvironmentType] = None
    python_version: Optional[str] = None


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


# ============================================================================
# SCHEDULED TASK MODELS
# ============================================================================

class ScheduledTaskBase(SQLModel):
    """Base model for ScheduledTask."""
    name: str = Field(index=True)
    command: str
    cron_expression: str  # Cron format: "0 9 * * *" (9am daily)
    enabled: bool = True
    description: Optional[str] = None


class ScheduledTask(ScheduledTaskBase, table=True):
    """
    ScheduledTask table - stores scheduled/recurring tasks.
    Supports cron expressions for flexible scheduling.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    created_at: datetime = Field(default_factory=utc_now)
    last_run: Optional[datetime] = None
    next_run: Optional[datetime] = None
    last_job_id: Optional[int] = None  # ID of the last job created by this schedule


class ScheduledTaskCreate(ScheduledTaskBase):
    """Schema for creating a scheduled task."""
    project_id: int


class ScheduledTaskUpdate(SQLModel):
    """Schema for updating a scheduled task."""
    name: Optional[str] = None
    command: Optional[str] = None
    cron_expression: Optional[str] = None
    enabled: Optional[bool] = None
    description: Optional[str] = None


class ScheduledTaskRead(ScheduledTaskBase):
    """Schema for reading a scheduled task."""
    id: int
    project_id: int
    created_at: datetime
    last_run: Optional[datetime]
    next_run: Optional[datetime]
    last_job_id: Optional[int]


# ============================================================================
# FILE EXPLORER MODELS
# ============================================================================

class FileInfo(SQLModel):
    """Schema for file/directory information."""
    name: str
    path: str  # Relative path from workspace root
    is_directory: bool
    size: Optional[int] = None  # File size in bytes
    extension: Optional[str] = None  # File extension for icons


# ============================================================================
# USER & AUTHENTICATION MODELS (RBAC)
# ============================================================================

class User(SQLModel, table=True):
    """
    User table - stores user credentials and roles for RBAC.
    """
    username: str = Field(primary_key=True)
    hashed_password: str
    role: UserRole = Field(default=UserRole.worker)
    created_at: datetime = Field(default_factory=utc_now)


class UserCreate(SQLModel):
    """Schema for creating a new user."""
    username: str
    password: str
    role: UserRole = UserRole.worker


class UserRead(SQLModel):
    """Schema for reading a user (without password)."""
    username: str
    role: UserRole
    created_at: datetime


# ============================================================================
# AUDIT LOG MODELS
# ============================================================================

class AuditLog(SQLModel, table=True):
    """
    AuditLog table - tracks user actions for security auditing.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True)
    action: str = Field(index=True)  # e.g., "run", "install", "stop", "create_user"
    target: Optional[str] = None  # e.g., project name, user name
    details: Optional[str] = None  # Additional JSON details
    timestamp: datetime = Field(default_factory=utc_now, index=True)


class AuditLogRead(SQLModel):
    """Schema for reading audit logs."""
    id: int
    username: str
    action: str
    target: Optional[str]
    details: Optional[str]
    timestamp: datetime
