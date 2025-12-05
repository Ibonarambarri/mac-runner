"""
MacRunner - FastAPI Application
REST API endpoints and WebSocket routes for the task orchestration system.
"""

import asyncio
import os
import socket
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, WebSocket, BackgroundTasks, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
import bcrypt
import os as os_module
import secrets as secrets_module
from sqlmodel import Session, select

from .database import create_db_and_tables, get_session, engine
from .models import (
    Project, ProjectCreate, ProjectRead, ProjectUpdate,
    Job, JobRead, JobStatus, ProjectStatus,
    CommandTemplate, CommandTemplateCreate, CommandTemplateRead, CommandTemplateUpdate,
    FileInfo,
    ScheduledTask, ScheduledTaskCreate, ScheduledTaskRead, ScheduledTaskUpdate,
    User, UserCreate, UserRead, UserRole,
    AuditLog, AuditLogRead
)
from .manager import init_process_manager, get_process_manager, safe_kill_process_group
from .websockets import stream_logs, handle_terminal, handle_status_websocket, broadcast_status_update
from .scheduler import (
    init_scheduler, start_scheduler, shutdown_scheduler,
    add_scheduled_job, remove_scheduled_job, update_scheduled_job,
    get_scheduler_status, CRON_PRESETS
)


# Application base path (parent of /app)
BASE_PATH = Path(__file__).parent.parent

# Load environment variables from root .env file
ROOT_ENV_PATH = BASE_PATH / ".env"
if ROOT_ENV_PATH.exists():
    load_dotenv(ROOT_ENV_PATH)
    print(f"[INFO] Loaded environment from {ROOT_ENV_PATH}")


# ============================================================================
# AUTHENTICATION & SECURITY
# ============================================================================

# HTTP Basic Auth security scheme
security = HTTPBasic()


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    password_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password_bytes, salt).decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    try:
        password_bytes = plain_password.encode('utf-8')
        hashed_bytes = hashed_password.encode('utf-8')
        return bcrypt.checkpw(password_bytes, hashed_bytes)
    except Exception:
        return False


def get_current_user(
    credentials: HTTPBasicCredentials = Depends(security),
    session: Session = Depends(get_session)
) -> User:
    """
    Validate HTTP Basic credentials and return the current user.
    Raises HTTPException 401 if credentials are invalid.
    """
    user = session.get(User, credentials.username)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )

    if not verify_password(credentials.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )

    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """
    Dependency that requires the current user to be an admin.
    Raises HTTPException 403 if user is not an admin.
    """
    if current_user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required"
        )
    return current_user


def require_worker_or_admin(current_user: User = Depends(get_current_user)) -> User:
    """
    Dependency that requires the current user to be a worker or admin.
    (Both roles have access to basic operations)
    """
    # Both worker and admin have access
    return current_user


def log_activity(
    session: Session,
    username: str,
    action: str,
    target: Optional[str] = None,
    details: Optional[str] = None
) -> None:
    """
    Log a user activity to the audit log.
    """
    audit_entry = AuditLog(
        username=username,
        action=action,
        target=target,
        details=details
    )
    session.add(audit_entry)
    session.commit()


def create_default_admin() -> None:
    """
    Create the default admin user if the users table is empty.
    This ensures there's always a way to access the system.
    """
    with Session(engine) as session:
        # Check if any users exist
        existing_users = session.exec(select(User)).first()

        if existing_users is None:
            # Create default admin user
            default_admin = User(
                username="admin",
                hashed_password=hash_password("admin"),
                role=UserRole.admin
            )
            session.add(default_admin)
            session.commit()
            print("[INFO] Created default admin user (username: admin, password: admin)")
            print("[WARN] Please change the default admin password immediately!")


def get_accessible_hostname() -> str:
    """
    Determine the best hostname/IP to use for accessible URLs.

    Priority:
    1. TAILSCALE_URL or BASE_URL environment variable (e.g., "mac-mini.tail171eca.ts.net")
    2. Tailscale IP detection (100.x.x.x range)
    3. Fallback to socket.gethostname()

    Returns:
        Hostname or IP address string (without protocol)
    """
    # Priority 1: Check environment variables
    tailscale_url = os.environ.get("TAILSCALE_URL") or os.environ.get("BASE_URL")
    if tailscale_url:
        # Strip protocol if present (e.g., "http://host" -> "host")
        if "://" in tailscale_url:
            tailscale_url = tailscale_url.split("://", 1)[1]
        # Strip trailing slash if present
        tailscale_url = tailscale_url.rstrip("/")
        return tailscale_url

    # Priority 2: Try to detect Tailscale IP (100.x.x.x range)
    try:
        import psutil
        for interface, addrs in psutil.net_if_addrs().items():
            for addr in addrs:
                # Check for IPv4 addresses in Tailscale's CGNAT range (100.64.0.0/10)
                if addr.family == socket.AF_INET and addr.address.startswith("100."):
                    print(f"[INFO] Detected Tailscale IP: {addr.address} on {interface}")
                    return addr.address
    except ImportError:
        print("[WARN] psutil not available for Tailscale IP detection")
    except Exception as e:
        print(f"[WARN] Error detecting Tailscale IP: {e}")

    # Priority 3: Fallback to hostname
    return socket.gethostname()


# Background task for PTY session cleanup
_cleanup_task: Optional[asyncio.Task] = None


async def _periodic_pty_cleanup():
    """Periodically clean up inactive PTY sessions to prevent memory leaks."""
    while True:
        try:
            await asyncio.sleep(300)  # Check every 5 minutes
            manager = get_process_manager()
            cleaned = manager.cleanup_inactive_sessions()
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[WARN] PTY cleanup error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan handler.
    Initializes database and process manager on startup.
    Restores persisted Jupyter/TensorBoard processes.
    """
    global _cleanup_task

    # Startup
    create_db_and_tables()
    create_default_admin()  # Create default admin user if none exists
    manager = init_process_manager(BASE_PATH)
    print("[INFO] MacRunner initialized")
    print(f"       Workspaces: {BASE_PATH / 'workspaces'}")
    print(f"       Logs: {BASE_PATH / 'logs'}")

    # Restore persisted Jupyter and TensorBoard processes
    restore_jupyter_processes()
    restore_tensorboard_processes()

    # Initialize and start the task scheduler
    init_scheduler(manager)
    start_scheduler()
    print("[INFO] Task scheduler started")

    # Start PTY cleanup background task
    _cleanup_task = asyncio.create_task(_periodic_pty_cleanup())
    print("[INFO] PTY session cleanup task started (runs every 5 minutes)")

    yield

    # Cancel PTY cleanup task
    if _cleanup_task:
        _cleanup_task.cancel()
        try:
            await _cleanup_task
        except asyncio.CancelledError:
            pass

    # Shutdown scheduler
    shutdown_scheduler()

    # Shutdown - stop all running processes
    manager = get_process_manager()
    for job_id in list(manager.running_processes.keys()):
        await manager.stop_job(job_id)

    # Gracefully terminate Jupyter processes
    for project_id, proc_info in list(jupyter_processes.items()):
        try:
            pid = proc_info.get("pid") or (proc_info.get("process").pid if proc_info.get("process") else None)
            if pid and is_process_alive(pid):
                import signal
                safe_kill_process_group(pid, signal.SIGTERM)
                print(f"[INFO] Stopped Jupyter for project {project_id}")
        except Exception as e:
            print(f"[WARN] Could not stop Jupyter for project {project_id}: {e}")
        remove_jupyter_pid(project_id)

    # Gracefully terminate TensorBoard processes
    for key, proc_info in list(tensorboard_processes.items()):
        try:
            pid = proc_info.get("pid") or (proc_info.get("process").pid if proc_info.get("process") else None)
            if pid and is_process_alive(pid):
                import os
                import signal
                os.kill(pid, signal.SIGTERM)
                print(f"[INFO] Stopped TensorBoard {key}")
        except Exception as e:
            print(f"[WARN] Could not stop TensorBoard {key}: {e}")
        remove_tensorboard_pid(key)

    print("[INFO] MacRunner shutdown complete")


# Create FastAPI app
app = FastAPI(
    title="MacRunner",
    description="Self-hosted task orchestration for macOS",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration for frontend
# Allow all origins to support local dev, Tailscale, and other remote access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for flexibility
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# PROJECT ENDPOINTS
# ============================================================================

@app.post("/projects/", response_model=ProjectRead)
async def create_project(
    project_data: ProjectCreate,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session)
):
    """
    Create a new project and clone the repository.

    The git clone happens in the background, so the endpoint returns immediately.
    Check project status to know when cloning is complete.
    """
    # Create project in database
    project = Project.model_validate(project_data)
    session.add(project)
    session.commit()
    session.refresh(project)

    # Schedule git clone as background task
    async def clone_task():
        # Need a new session for background task
        with Session(engine) as bg_session:
            proj = bg_session.get(Project, project.id)
            manager = get_process_manager()
            await manager.clone_repository(proj, bg_session)

    background_tasks.add_task(clone_task)

    return project


@app.get("/projects/", response_model=List[ProjectRead])
def list_projects(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_worker_or_admin)
):
    """List all projects. Requires authentication."""
    projects = session.exec(select(Project)).all()
    return projects


@app.get("/projects/{project_id}", response_model=ProjectRead)
def get_project(
    project_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_worker_or_admin)
):
    """Get a specific project by ID. Requires authentication."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@app.patch("/projects/{project_id}", response_model=ProjectRead)
def update_project(
    project_id: int,
    project_update: ProjectUpdate,
    session: Session = Depends(get_session)
):
    """Update project configuration (commands, name)."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Update only provided fields
    update_data = project_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(project, key, value)

    session.add(project)
    session.commit()
    session.refresh(project)

    return project


@app.delete("/projects/{project_id}")
async def delete_project(project_id: int, session: Session = Depends(get_session)):
    """Delete a project and its workspace."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Stop any running jobs
    running_jobs = session.exec(
        select(Job).where(
            Job.project_id == project_id,
            Job.status == JobStatus.RUNNING
        )
    ).all()

    manager = get_process_manager()
    for job in running_jobs:
        await manager.stop_job(job.id)

    # Delete workspace directory
    if project.workspace_path:
        import shutil
        workspace = Path(project.workspace_path)
        if workspace.exists():
            shutil.rmtree(workspace)

    # Delete related jobs
    jobs = session.exec(select(Job).where(Job.project_id == project_id)).all()
    for job in jobs:
        session.delete(job)

    # Delete project
    session.delete(project)
    session.commit()

    return {"status": "deleted", "id": project_id}


# ============================================================================
# JOB ENDPOINTS
# ============================================================================

@app.post("/projects/{project_id}/pull", response_model=JobRead)
async def pull_project(
    project_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session)
):
    """
    Execute git pull in the project workspace.
    Creates a new job and streams logs via WebSocket.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.status == ProjectStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Project is already running")

    if project.status == ProjectStatus.CLONING:
        raise HTTPException(status_code=400, detail="Project is still cloning")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    # Create job for git pull
    job = Job(
        project_id=project_id,
        status=JobStatus.PENDING,
        command_name="pull",
        command_executed="git pull"
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    # Run git pull in background
    async def pull_task():
        await broadcast_status_update("job_started", {
            "job_id": job.id,
            "project_id": project_id,
            "project_name": project.name,
            "command_name": "pull"
        })

        with Session(engine) as bg_session:
            proj = bg_session.get(Project, project_id)
            j = bg_session.get(Job, job.id)
            manager = get_process_manager()
            await manager.git_pull(proj, j, bg_session)

            j_updated = bg_session.get(Job, job.id)
            await broadcast_status_update("job_finished", {
                "job_id": job.id,
                "project_id": project_id,
                "status": j_updated.status.value if j_updated else "unknown"
            })

    background_tasks.add_task(pull_task)

    return job


@app.post("/projects/{project_id}/install", response_model=JobRead)
async def install_project(
    project_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_worker_or_admin)
):
    """
    Run the install/build command for a project.
    Creates a new job and streams logs via WebSocket.
    Requires authentication (worker or admin).
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.status == ProjectStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Project is already running")

    if project.status == ProjectStatus.CLONING:
        raise HTTPException(status_code=400, detail="Project is still cloning")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    # Create job with command info
    job = Job(
        project_id=project_id,
        status=JobStatus.PENDING,
        command_name="install",
        command_executed=project.install_command
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    # Log the activity
    log_activity(
        session,
        username=current_user.username,
        action="install",
        target=project.name,
        details=f"job_id={job.id}"
    )

    # Run install in background
    async def install_task():
        await broadcast_status_update("job_started", {
            "job_id": job.id,
            "project_id": project_id,
            "project_name": project.name,
            "command_name": "install"
        })

        with Session(engine) as bg_session:
            proj = bg_session.get(Project, project_id)
            j = bg_session.get(Job, job.id)
            manager = get_process_manager()
            await manager.run_command(proj, j, proj.install_command, bg_session)

            j_updated = bg_session.get(Job, job.id)
            await broadcast_status_update("job_finished", {
                "job_id": job.id,
                "project_id": project_id,
                "status": j_updated.status.value if j_updated else "unknown"
            })

    background_tasks.add_task(install_task)

    return job


@app.post("/projects/{project_id}/run", response_model=JobRead)
async def run_project(
    project_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_worker_or_admin)
):
    """
    Run the main command for a project.
    Creates a new job and streams logs via WebSocket.
    Requires authentication (worker or admin).

    Returns the job_id which can be used to connect to /ws/logs/{job_id}
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.status == ProjectStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Project is already running")

    if project.status == ProjectStatus.CLONING:
        raise HTTPException(status_code=400, detail="Project is still cloning")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    # Create job with command info
    job = Job(
        project_id=project_id,
        status=JobStatus.PENDING,
        command_name="run",
        command_executed=project.run_command
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    # Log the activity
    log_activity(
        session,
        username=current_user.username,
        action="run",
        target=project.name,
        details=f"job_id={job.id}"
    )

    # Run job in background
    async def run_task():
        # Broadcast job started
        await broadcast_status_update("job_started", {
            "job_id": job.id,
            "project_id": project_id,
            "project_name": project.name,
            "command_name": "run"
        })

        with Session(engine) as bg_session:
            proj = bg_session.get(Project, project_id)
            j = bg_session.get(Job, job.id)
            manager = get_process_manager()
            await manager.run_command(proj, j, proj.run_command, bg_session)

            # Broadcast job completed/failed
            j_updated = bg_session.get(Job, job.id)
            await broadcast_status_update("job_finished", {
                "job_id": job.id,
                "project_id": project_id,
                "status": j_updated.status.value if j_updated else "unknown"
            })

    background_tasks.add_task(run_task)

    return job


@app.get("/projects/{project_id}/jobs", response_model=List[JobRead])
def list_project_jobs(
    project_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_worker_or_admin)
):
    """List all jobs for a project. Requires authentication."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    jobs = session.exec(
        select(Job).where(Job.project_id == project_id).order_by(Job.start_time.desc())
    ).all()

    return jobs


@app.get("/jobs/{job_id}", response_model=JobRead)
def get_job(
    job_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_worker_or_admin)
):
    """Get a specific job by ID. Requires authentication."""
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.post("/jobs/{job_id}/stop")
async def stop_job(
    job_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_worker_or_admin)
):
    """
    Stop a running job by terminating its process.
    Requires authentication (worker or admin).
    """
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status != JobStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Job is not running")

    manager = get_process_manager()
    stopped = await manager.stop_job(job_id)

    if stopped:
        # Update job status
        job.status = JobStatus.STOPPED
        session.add(job)
        session.commit()

        # Update project status
        project = session.get(Project, job.project_id)
        if project:
            project.status = ProjectStatus.IDLE
            session.add(project)
            session.commit()

            # Log the activity
            log_activity(
                session,
                username=current_user.username,
                action="stop",
                target=project.name,
                details=f"job_id={job_id}"
            )

        return {"status": "stopped", "job_id": job_id}
    else:
        raise HTTPException(status_code=500, detail="Failed to stop job")


@app.delete("/jobs/{job_id}")
async def delete_job(job_id: int, session: Session = Depends(get_session)):
    """
    Delete a job from history.
    Cannot delete running jobs.
    """
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status == JobStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Cannot delete a running job")

    session.delete(job)
    session.commit()

    return {"status": "deleted", "job_id": job_id}


# ============================================================================
# COMMAND TEMPLATE ENDPOINTS
# ============================================================================

@app.get("/projects/{project_id}/commands", response_model=List[CommandTemplateRead])
def list_command_templates(
    project_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_worker_or_admin)
):
    """List all command templates for a project. Requires authentication."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    templates = session.exec(
        select(CommandTemplate).where(CommandTemplate.project_id == project_id)
    ).all()

    return templates


@app.post("/projects/{project_id}/commands", response_model=CommandTemplateRead)
def create_command_template(
    project_id: int,
    template_data: CommandTemplateCreate,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin)
):
    """Create a new command template for a project. Admin only."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    template = CommandTemplate(project_id=project_id, **template_data.model_dump())
    session.add(template)
    session.commit()
    session.refresh(template)

    return template


@app.patch("/projects/{project_id}/commands/{command_id}", response_model=CommandTemplateRead)
def update_command_template(
    project_id: int,
    command_id: int,
    template_update: CommandTemplateUpdate,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin)
):
    """Update a command template. Admin only."""
    template = session.get(CommandTemplate, command_id)
    if not template or template.project_id != project_id:
        raise HTTPException(status_code=404, detail="Command template not found")

    update_data = template_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(template, key, value)

    session.add(template)
    session.commit()
    session.refresh(template)

    return template


@app.delete("/projects/{project_id}/commands/{command_id}")
def delete_command_template(
    project_id: int,
    command_id: int,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin)
):
    """Delete a command template. Admin only."""
    template = session.get(CommandTemplate, command_id)
    if not template or template.project_id != project_id:
        raise HTTPException(status_code=404, detail="Command template not found")

    session.delete(template)
    session.commit()

    return {"status": "deleted", "id": command_id}


@app.post("/projects/{project_id}/commands/{command_id}/run", response_model=JobRead)
async def run_command_template(
    project_id: int,
    command_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_worker_or_admin)
):
    """
    Execute a command template.
    Creates a new job and streams logs via WebSocket.
    Requires authentication (worker or admin).
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    template = session.get(CommandTemplate, command_id)
    if not template or template.project_id != project_id:
        raise HTTPException(status_code=404, detail="Command template not found")

    if project.status == ProjectStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Project is already running")

    if project.status == ProjectStatus.CLONING:
        raise HTTPException(status_code=400, detail="Project is still cloning")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    # Create job with command info
    job = Job(
        project_id=project_id,
        status=JobStatus.PENDING,
        command_name=template.name,
        command_executed=template.command
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    # Log the activity
    log_activity(
        session,
        username=current_user.username,
        action="run_template",
        target=project.name,
        details=f"template={template.name}, job_id={job.id}"
    )

    # Run command in background
    async def run_task():
        with Session(engine) as bg_session:
            proj = bg_session.get(Project, project_id)
            j = bg_session.get(Job, job.id)
            manager = get_process_manager()
            await manager.run_command(proj, j, template.command, bg_session)

    background_tasks.add_task(run_task)

    return job


from pydantic import BaseModel

class OneOffCommandRequest(BaseModel):
    """Request body for one-off command execution."""
    command: str


@app.post("/projects/{project_id}/run-command", response_model=JobRead)
async def run_one_off_command(
    project_id: int,
    request: OneOffCommandRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin)
):
    """
    Execute a one-off command without saving it as a template.
    Admin only - arbitrary command execution is privileged.
    Creates a new job and streams logs via WebSocket.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.status == ProjectStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Project is already running")

    if project.status == ProjectStatus.CLONING:
        raise HTTPException(status_code=400, detail="Project is still cloning")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    # Extract a short name from the command (first word)
    command_parts = request.command.strip().split()
    command_name = command_parts[0] if command_parts else "custom"

    # Create job with command info
    job = Job(
        project_id=project_id,
        status=JobStatus.PENDING,
        command_name=command_name,
        command_executed=request.command
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    # Log the activity
    log_activity(
        session,
        username=admin.username,
        action="run_command",
        target=project.name,
        details=f"command={request.command}"
    )

    # Run command in background
    async def run_task():
        await broadcast_status_update("job_started", {
            "job_id": job.id,
            "project_id": project_id,
            "project_name": project.name,
            "command_name": command_name
        })

        with Session(engine) as bg_session:
            proj = bg_session.get(Project, project_id)
            j = bg_session.get(Job, job.id)
            manager = get_process_manager()
            await manager.run_command(proj, j, request.command, bg_session)

            j_updated = bg_session.get(Job, job.id)
            await broadcast_status_update("job_finished", {
                "job_id": job.id,
                "project_id": project_id,
                "status": j_updated.status.value if j_updated else "unknown"
            })

    background_tasks.add_task(run_task)

    return job


# ============================================================================
# ENVIRONMENT VARIABLES ENDPOINTS
# ============================================================================

@app.get("/projects/{project_id}/env")
def get_project_env(
    project_id: int,
    session: Session = Depends(get_session)
):
    """
    Get environment variables for a project from its .env file.

    Returns a list of {key, value} pairs.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    env_path = Path(project.workspace_path) / ".env"
    env_vars = []

    if env_path.exists():
        try:
            with open(env_path, "r") as f:
                for line in f:
                    line = line.strip()
                    # Skip comments and empty lines
                    if not line or line.startswith('#'):
                        continue
                    # Parse key=value
                    if '=' in line:
                        key, _, value = line.partition('=')
                        # Remove quotes if present
                        value = value.strip()
                        if (value.startswith('"') and value.endswith('"')) or \
                           (value.startswith("'") and value.endswith("'")):
                            value = value[1:-1]
                        env_vars.append({"key": key.strip(), "value": value})
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error reading .env file: {str(e)}")

    return {"variables": env_vars}


@app.put("/projects/{project_id}/env")
def save_project_env(
    project_id: int,
    env_data: dict,
    session: Session = Depends(get_session)
):
    """
    Save environment variables to a project's .env file.

    Expects: {"variables": [{"key": "...", "value": "..."}, ...]}
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    env_path = Path(project.workspace_path) / ".env"
    variables = env_data.get("variables", [])

    try:
        with open(env_path, "w") as f:
            f.write("# Environment variables for MacRunner project\n")
            f.write("# Auto-generated - edit via MacRunner UI or directly\n\n")
            for var in variables:
                key = var.get("key", "").strip()
                value = var.get("value", "")
                if key:
                    # Quote values with spaces or special characters
                    if ' ' in value or '"' in value or "'" in value or '\n' in value:
                        # Escape double quotes and use double quotes
                        value = value.replace('"', '\\"')
                        f.write(f'{key}="{value}"\n')
                    else:
                        f.write(f'{key}={value}\n')
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error writing .env file: {str(e)}")

    return {"status": "saved", "count": len(variables)}


# ============================================================================
# FILE EXPLORER ENDPOINTS
# ============================================================================

def remove_file(path: str) -> None:
    """
    Background task to remove a temporary file after it has been sent.
    Used by ZIP download endpoints to clean up temporary files.
    """
    try:
        os_module.unlink(path)
    except OSError as e:
        print(f"Warning: Could not remove temporary file {path}: {e}")


@app.get("/projects/{project_id}/files", response_model=List[FileInfo])
def list_files(
    project_id: int,
    path: str = "",
    allow_external: bool = False,
    show_hidden: bool = False,
    session: Session = Depends(get_session)
):
    """
    List files and directories at a given path.

    Args:
        project_id: Project ID
        path: Path to list (relative to workspace, or absolute if allow_external=True)
        allow_external: Allow browsing outside project workspace (for datasets, etc.)
        show_hidden: Show hidden files (starting with .)
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.workspace_path and not allow_external:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    manager = get_process_manager()
    try:
        files = manager.list_directory(project_id, path, allow_external=allow_external, show_hidden=show_hidden)
        return files
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/projects/{project_id}/files/content")
def get_file_content(
    project_id: int,
    path: str,
    session: Session = Depends(get_session)
):
    """
    Get the content of a text file.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    manager = get_process_manager()
    try:
        content = manager.get_file_content(project_id, path)
        return PlainTextResponse(content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


from pydantic import BaseModel


class FileContentUpdate(BaseModel):
    content: str


@app.put("/projects/{project_id}/files/content")
def save_file_content(
    project_id: int,
    path: str,
    data: FileContentUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_worker_or_admin)
):
    """
    Save content to a text file.

    Args:
        project_id: Project ID
        path: Relative path within workspace
        data: File content to save
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    manager = get_process_manager()
    try:
        manager.save_file_content(project_id, path, data.content)
        return {"status": "saved", "path": path}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except IOError as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")


@app.get("/projects/{project_id}/files/download")
def download_file(
    project_id: int,
    path: str,
    session: Session = Depends(get_session)
):
    """
    Download a single file.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    manager = get_process_manager()
    try:
        file_path = manager.get_file_path(project_id, path)
        return FileResponse(
            path=file_path,
            filename=file_path.name,
            media_type="application/octet-stream"
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/projects/{project_id}/files/download-zip")
def download_folder_zip(
    project_id: int,
    path: str = "",
    background_tasks: BackgroundTasks = None,
    session: Session = Depends(get_session)
):
    """
    Download a folder as a ZIP archive.
    The temporary ZIP file is automatically deleted after the response is sent.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    manager = get_process_manager()
    try:
        zip_path = manager.create_zip_archive(project_id, path)
        folder_name = Path(path).name if path else project.name

        # Schedule cleanup of temporary file after response is sent
        background_tasks.add_task(remove_file, str(zip_path))

        return FileResponse(
            path=zip_path,
            filename=f"{folder_name}.zip",
            media_type="application/zip"
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/projects/{project_id}/files/download-batch")
def download_batch_files(
    project_id: int,
    paths: List[str] = Query(...),
    background_tasks: BackgroundTasks = None,
    session: Session = Depends(get_session)
):
    """
    Download multiple selected files/folders as a single ZIP archive.
    The temporary ZIP file is automatically deleted after the response is sent.

    Args:
        project_id: Project ID
        paths: List of relative paths to include in the ZIP
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    if not paths:
        raise HTTPException(status_code=400, detail="No files selected")

    manager = get_process_manager()
    try:
        zip_path = manager.create_batch_zip_archive(project_id, paths)

        # Schedule cleanup of temporary file after response is sent
        background_tasks.add_task(remove_file, str(zip_path))

        return FileResponse(
            path=zip_path,
            filename=f"{project.name}_selected.zip",
            media_type="application/zip"
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================================
# JUPYTER NOTEBOOK ENDPOINTS
# ============================================================================

# Track running Jupyter Lab processes
jupyter_processes: dict = {}

# PID file paths for process persistence
JUPYTER_PID_DIR = BASE_PATH / "logs" / "pids"
TENSORBOARD_PID_DIR = BASE_PATH / "logs" / "pids"


def save_jupyter_pid(project_id: int, pid: int, port: int, token: str, url: str) -> None:
    """Save Jupyter process info to a PID file for persistence across restarts."""
    import json
    JUPYTER_PID_DIR.mkdir(parents=True, exist_ok=True)
    pid_file = JUPYTER_PID_DIR / f"jupyter_{project_id}.json"
    with open(pid_file, "w") as f:
        json.dump({
            "pid": pid,
            "port": port,
            "token": token,
            "url": url,
            "project_id": project_id
        }, f)


def load_jupyter_pid(project_id: int) -> Optional[dict]:
    """Load Jupyter process info from PID file."""
    import json
    pid_file = JUPYTER_PID_DIR / f"jupyter_{project_id}.json"
    if pid_file.exists():
        try:
            with open(pid_file, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return None
    return None


def remove_jupyter_pid(project_id: int) -> None:
    """Remove Jupyter PID file."""
    pid_file = JUPYTER_PID_DIR / f"jupyter_{project_id}.json"
    try:
        pid_file.unlink(missing_ok=True)
    except OSError:
        pass


def save_tensorboard_pid(key: str, pid: int, port: int, url: str, log_dir: str) -> None:
    """Save TensorBoard process info to a PID file for persistence across restarts."""
    import json
    TENSORBOARD_PID_DIR.mkdir(parents=True, exist_ok=True)
    # Sanitize key for filename (replace : with _)
    safe_key = key.replace(":", "_")
    pid_file = TENSORBOARD_PID_DIR / f"tensorboard_{safe_key}.json"
    with open(pid_file, "w") as f:
        json.dump({
            "pid": pid,
            "port": port,
            "url": url,
            "log_dir": log_dir,
            "key": key
        }, f)


def load_tensorboard_pid(key: str) -> Optional[dict]:
    """Load TensorBoard process info from PID file."""
    import json
    safe_key = key.replace(":", "_")
    pid_file = TENSORBOARD_PID_DIR / f"tensorboard_{safe_key}.json"
    if pid_file.exists():
        try:
            with open(pid_file, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return None
    return None


def remove_tensorboard_pid(key: str) -> None:
    """Remove TensorBoard PID file."""
    safe_key = key.replace(":", "_")
    pid_file = TENSORBOARD_PID_DIR / f"tensorboard_{safe_key}.json"
    try:
        pid_file.unlink(missing_ok=True)
    except OSError:
        pass


def is_process_alive(pid: int) -> bool:
    """Check if a process with given PID is still running using psutil."""
    try:
        import psutil
        return psutil.pid_exists(pid) and psutil.Process(pid).is_running()
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return False


def restore_jupyter_processes() -> None:
    """
    Restore Jupyter process state from PID files on startup.
    Verifies processes are still alive and rebuilds in-memory state.
    """
    import subprocess
    JUPYTER_PID_DIR.mkdir(parents=True, exist_ok=True)

    for pid_file in JUPYTER_PID_DIR.glob("jupyter_*.json"):
        try:
            import json
            with open(pid_file, "r") as f:
                data = json.load(f)

            project_id = data.get("project_id")
            pid = data.get("pid")

            if project_id is None or pid is None:
                pid_file.unlink(missing_ok=True)
                continue

            if is_process_alive(pid):
                # Process is still running, restore to memory
                # Create a dummy process object to track it
                print(f"[INFO] Restored Jupyter process for project {project_id} (PID: {pid})")
                jupyter_processes[project_id] = {
                    "process": None,  # Can't restore subprocess.Popen object
                    "pid": pid,
                    "port": data.get("port"),
                    "token": data.get("token"),
                    "url": data.get("url"),
                    "restored": True
                }
            else:
                # Process is dead, clean up PID file
                print(f"[INFO] Cleaning up stale Jupyter PID file for project {project_id}")
                pid_file.unlink(missing_ok=True)
        except Exception as e:
            print(f"[WARN] Error restoring Jupyter process from {pid_file}: {e}")
            try:
                pid_file.unlink(missing_ok=True)
            except:
                pass


def restore_tensorboard_processes() -> None:
    """
    Restore TensorBoard process state from PID files on startup.
    Verifies processes are still alive and rebuilds in-memory state.
    """
    TENSORBOARD_PID_DIR.mkdir(parents=True, exist_ok=True)

    for pid_file in TENSORBOARD_PID_DIR.glob("tensorboard_*.json"):
        try:
            import json
            with open(pid_file, "r") as f:
                data = json.load(f)

            key = data.get("key")
            pid = data.get("pid")

            if key is None or pid is None:
                pid_file.unlink(missing_ok=True)
                continue

            if is_process_alive(pid):
                # Process is still running, restore to memory
                print(f"[INFO] Restored TensorBoard process {key} (PID: {pid})")
                tensorboard_processes[key] = {
                    "process": None,  # Can't restore subprocess.Popen object
                    "pid": pid,
                    "port": data.get("port"),
                    "url": data.get("url"),
                    "log_dir": data.get("log_dir"),
                    "restored": True
                }
            else:
                # Process is dead, clean up PID file
                print(f"[INFO] Cleaning up stale TensorBoard PID file for {key}")
                pid_file.unlink(missing_ok=True)
        except Exception as e:
            print(f"[WARN] Error restoring TensorBoard process from {pid_file}: {e}")
            try:
                pid_file.unlink(missing_ok=True)
            except:
                pass


@app.get("/projects/{project_id}/notebook/render")
async def render_notebook(
    project_id: int,
    path: str,
    session: Session = Depends(get_session)
):
    """
    Render a Jupyter notebook as HTML for preview.

    Args:
        project_id: Project ID
        path: Relative path to the .ipynb file
    """
    from nbconvert import HTMLExporter
    import nbformat

    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    manager = get_process_manager()
    workspace = Path(project.workspace_path)

    try:
        notebook_path = manager.validate_path(workspace, path)

        if not notebook_path.exists():
            raise HTTPException(status_code=404, detail="Notebook not found")

        if not notebook_path.suffix.lower() == '.ipynb':
            raise HTTPException(status_code=400, detail="File is not a Jupyter notebook")

        # Read and convert notebook
        with open(notebook_path, 'r', encoding='utf-8') as f:
            notebook_content = nbformat.read(f, as_version=4)

        # Configure HTML exporter
        html_exporter = HTMLExporter()
        html_exporter.template_name = 'classic'
        html_exporter.exclude_input_prompt = False
        html_exporter.exclude_output_prompt = False

        # Convert to HTML
        (body, resources) = html_exporter.from_notebook_node(notebook_content)

        return {
            "html": body,
            "notebook_name": notebook_path.name
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error rendering notebook: {str(e)}")


@app.get("/projects/{project_id}/notebooks")
def list_notebooks(
    project_id: int,
    session: Session = Depends(get_session)
):
    """
    List all Jupyter notebooks in a project.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    workspace = Path(project.workspace_path)
    notebooks = []

    # Find all .ipynb files, excluding checkpoints
    for nb_path in workspace.rglob("*.ipynb"):
        # Skip checkpoint files
        if ".ipynb_checkpoints" in str(nb_path):
            continue

        rel_path = nb_path.relative_to(workspace)
        notebooks.append({
            "name": nb_path.name,
            "path": str(rel_path),
            "size": nb_path.stat().st_size,
            "modified": nb_path.stat().st_mtime
        })

    # Sort by path
    notebooks.sort(key=lambda x: x["path"])

    return {"notebooks": notebooks}


class RunNotebookRequest(BaseModel):
    """Request body for running a notebook."""
    notebook_path: str
    parameters: dict = {}


@app.post("/projects/{project_id}/notebook/run", response_model=JobRead)
async def run_notebook(
    project_id: int,
    request: RunNotebookRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session)
):
    """
    Execute a Jupyter notebook using Papermill.

    Args:
        project_id: Project ID
        notebook_path: Relative path to the input notebook
        parameters: Optional parameters to inject into the notebook
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.status == ProjectStatus.RUNNING:
        raise HTTPException(status_code=400, detail="Project is already running")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    workspace = Path(project.workspace_path)
    manager = get_process_manager()

    try:
        notebook_path = manager.validate_path(workspace, request.notebook_path)
        if not notebook_path.exists():
            raise HTTPException(status_code=404, detail="Notebook not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Create job for notebook execution
    job = Job(
        project_id=project_id,
        status=JobStatus.PENDING,
        command_name="notebook",
        command_executed=f"papermill {request.notebook_path}"
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    # Run notebook in background
    async def run_notebook_task():
        await broadcast_status_update("job_started", {
            "job_id": job.id,
            "project_id": project_id,
            "project_name": project.name,
            "command_name": "notebook"
        })

        with Session(engine) as bg_session:
            proj = bg_session.get(Project, project_id)
            j = bg_session.get(Job, job.id)
            manager = get_process_manager()
            await manager.run_notebook(proj, j, request.notebook_path, request.parameters, bg_session)

            j_updated = bg_session.get(Job, job.id)
            await broadcast_status_update("job_finished", {
                "job_id": job.id,
                "project_id": project_id,
                "status": j_updated.status.value if j_updated else "unknown"
            })

    background_tasks.add_task(run_notebook_task)

    return job


def find_free_port(start: int = 8888, end: int = 8920) -> int:
    """Find a free port in the given range."""
    import socket
    for port in range(start, end):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('', port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"No free port found in range {start}-{end}")


@app.post("/projects/{project_id}/jupyter/start")
async def start_jupyter_lab(
    project_id: int,
    session: Session = Depends(get_session)
):
    """
    Start a Jupyter Lab server for a project.

    Returns the URL to access Jupyter Lab.
    """
    import subprocess
    import secrets

    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    workspace = Path(project.workspace_path)

    # Check if already running for this project
    if project_id in jupyter_processes:
        proc_info = jupyter_processes[project_id]
        # Handle restored processes (no subprocess.Popen object)
        if proc_info.get("restored"):
            pid = proc_info.get("pid")
            if pid and is_process_alive(pid):
                return {
                    "status": "already_running",
                    "url": proc_info["url"],
                    "port": proc_info["port"]
                }
            else:
                # Process died, clean up
                del jupyter_processes[project_id]
                remove_jupyter_pid(project_id)
        else:
            proc = proc_info["process"]
            if proc.poll() is None:  # Still running
                return {
                    "status": "already_running",
                    "url": proc_info["url"],
                    "port": proc_info["port"]
                }
            else:
                # Process died, clean up
                del jupyter_processes[project_id]
                remove_jupyter_pid(project_id)

    # Find a free port
    try:
        port = find_free_port()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    # Generate a token for authentication
    token = secrets_module.token_urlsafe(32)

    # Get the venv python path if it exists
    venv_path = workspace / "venv"
    if venv_path.exists():
        jupyter_cmd = str(venv_path / "bin" / "jupyter")
        # Check if jupyter exists in venv
        if not Path(jupyter_cmd).exists():
            # Fall back to system jupyter
            jupyter_cmd = "jupyter"
    else:
        jupyter_cmd = "jupyter"

    # Start Jupyter Lab
    cmd = [
        jupyter_cmd, "lab",
        f"--port={port}",
        "--ip=0.0.0.0",
        f"--notebook-dir={workspace}",
        f"--IdentityProvider.token={token}",
        "--no-browser",
        "--ServerApp.allow_origin=*",
        "--ServerApp.disable_check_xsrf=True"
    ]

    try:
        process = subprocess.Popen(
            cmd,
            cwd=workspace,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True
        )

        # Wait a moment to check if it started
        import time
        time.sleep(2)

        if process.poll() is not None:
            # Process exited, get error
            stderr = process.stderr.read().decode() if process.stderr else "Unknown error"
            raise HTTPException(status_code=500, detail=f"Jupyter Lab failed to start: {stderr}")

        # Build the URL using Tailscale-aware hostname detection
        hostname = get_accessible_hostname()
        url = f"http://{hostname}:{port}/lab?token={token}"

        # Store process info in memory
        jupyter_processes[project_id] = {
            "process": process,
            "pid": process.pid,
            "port": port,
            "token": token,
            "url": url
        }

        # Persist PID to file for recovery after restart
        save_jupyter_pid(project_id, process.pid, port, token, url)

        return {
            "status": "started",
            "url": url,
            "port": port
        }

    except FileNotFoundError:
        # Return 404 with specific error code for frontend handling
        raise HTTPException(
            status_code=404,
            detail="JUPYTER_NOT_INSTALLED"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error starting Jupyter Lab: {str(e)}")


@app.post("/projects/{project_id}/jupyter/stop")
async def stop_jupyter_lab(
    project_id: int,
    session: Session = Depends(get_session)
):
    """
    Stop the Jupyter Lab server for a project.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project_id not in jupyter_processes:
        return {"status": "not_running"}

    proc_info = jupyter_processes[project_id]
    import signal

    # Handle restored processes (no subprocess.Popen object)
    if proc_info.get("restored"):
        pid = proc_info.get("pid")
        if pid and is_process_alive(pid):
            try:
                safe_kill_process_group(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    else:
        proc = proc_info["process"]
        if proc.poll() is None:  # Still running
            safe_kill_process_group(proc.pid, signal.SIGTERM)

    del jupyter_processes[project_id]
    remove_jupyter_pid(project_id)

    return {"status": "stopped"}


@app.get("/projects/{project_id}/jupyter/status")
def get_jupyter_status(
    project_id: int,
    session: Session = Depends(get_session)
):
    """
    Get the status of Jupyter Lab for a project.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project_id not in jupyter_processes:
        return {"running": False}

    proc_info = jupyter_processes[project_id]

    # Handle restored processes (no subprocess.Popen object)
    if proc_info.get("restored"):
        pid = proc_info.get("pid")
        if pid and is_process_alive(pid):
            return {
                "running": True,
                "url": proc_info["url"],
                "port": proc_info["port"]
            }
        else:
            # Process died, clean up
            del jupyter_processes[project_id]
            remove_jupyter_pid(project_id)
            return {"running": False}
    else:
        proc = proc_info["process"]
        if proc.poll() is None:  # Still running
            return {
                "running": True,
                "url": proc_info["url"],
                "port": proc_info["port"]
            }
        else:
            # Process died, clean up
            del jupyter_processes[project_id]
            remove_jupyter_pid(project_id)
            return {"running": False}


# ============================================================================
# TENSORBOARD ENDPOINTS
# ============================================================================

# Track running TensorBoard processes
tensorboard_processes: dict = {}

@app.get("/projects/{project_id}/tensorboard/detect")
def detect_tensorboard_dirs(
    project_id: int,
    session: Session = Depends(get_session)
):
    """
    Detect TensorBoard log directories in a project.

    Looks for common directory names: runs, logs, tensorboard, tb_logs
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    workspace = Path(project.workspace_path)
    tb_dirs = []

    # Common TensorBoard directory names
    tb_patterns = ['runs', 'logs', 'tensorboard', 'tb_logs', 'lightning_logs', 'mlruns']

    for pattern in tb_patterns:
        dir_path = workspace / pattern
        if dir_path.exists() and dir_path.is_dir():
            # Check if it has any content
            has_content = any(dir_path.iterdir())
            if has_content:
                tb_dirs.append({
                    "name": pattern,
                    "path": str(dir_path.relative_to(workspace)),
                    "full_path": str(dir_path)
                })

    # Also check for event files in subdirectories
    for event_file in workspace.glob("**/events.out.tfevents.*"):
        parent = event_file.parent
        rel_path = str(parent.relative_to(workspace))
        # Avoid duplicates
        if not any(d["path"] == rel_path for d in tb_dirs):
            tb_dirs.append({
                "name": parent.name,
                "path": rel_path,
                "full_path": str(parent)
            })

    return {"directories": tb_dirs}


@app.post("/projects/{project_id}/tensorboard/start")
async def start_tensorboard(
    project_id: int,
    log_dir: str = "runs",
    port: int = 6006,
    session: Session = Depends(get_session)
):
    """
    Start a TensorBoard server for a project.

    Args:
        project_id: Project ID
        log_dir: Log directory relative to project workspace
        port: Port to run TensorBoard on (default 6006)
    """
    import subprocess

    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    workspace = Path(project.workspace_path)
    full_log_dir = workspace / log_dir

    if not full_log_dir.exists():
        raise HTTPException(status_code=400, detail=f"Log directory '{log_dir}' does not exist")

    # Check if already running for this project
    key = f"{project_id}:{log_dir}"
    if key in tensorboard_processes:
        proc_info = tensorboard_processes[key]
        # Handle restored processes (no subprocess.Popen object)
        if proc_info.get("restored"):
            pid = proc_info.get("pid")
            if pid and is_process_alive(pid):
                return {
                    "status": "already_running",
                    "url": proc_info["url"],
                    "port": proc_info["port"]
                }
            else:
                # Process died, clean up
                del tensorboard_processes[key]
                remove_tensorboard_pid(key)
        else:
            proc = proc_info["process"]
            if proc.poll() is None:  # Still running
                return {
                    "status": "already_running",
                    "url": proc_info["url"],
                    "port": proc_info["port"]
                }
            else:
                # Process died, clean up
                del tensorboard_processes[key]
                remove_tensorboard_pid(key)

    # Find an available port starting from the requested one
    import socket
    def is_port_available(p):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('localhost', p))
                return True
            except OSError:
                return False

    actual_port = port
    for _ in range(10):
        if is_port_available(actual_port):
            break
        actual_port += 1
    else:
        raise HTTPException(status_code=500, detail="Could not find available port")

    # Start TensorBoard process
    try:
        # Use the project's venv if tensorboard is installed there, otherwise system
        venv_tb = workspace / "venv" / "bin" / "tensorboard"
        tb_cmd = str(venv_tb) if venv_tb.exists() else "tensorboard"

        proc = subprocess.Popen(
            [tb_cmd, "--logdir", str(full_log_dir), "--port", str(actual_port), "--bind_all"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=workspace
        )

        # Give it a moment to start
        import time
        time.sleep(2)

        if proc.poll() is not None:
            stderr = proc.stderr.read().decode() if proc.stderr else ""
            raise HTTPException(status_code=500, detail=f"TensorBoard failed to start: {stderr}")

        # Build URL using Tailscale-aware hostname detection
        hostname = get_accessible_hostname()
        url = f"http://{hostname}:{actual_port}"
        tensorboard_processes[key] = {
            "process": proc,
            "pid": proc.pid,
            "port": actual_port,
            "url": url,
            "log_dir": log_dir
        }

        # Persist PID to file for recovery after restart
        save_tensorboard_pid(key, proc.pid, actual_port, url, log_dir)

        return {
            "status": "started",
            "url": url,
            "port": actual_port
        }

    except FileNotFoundError:
        raise HTTPException(status_code=400, detail="TensorBoard not installed. Run: pip install tensorboard")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/projects/{project_id}/tensorboard/stop")
async def stop_tensorboard(
    project_id: int,
    log_dir: str = "runs",
    session: Session = Depends(get_session)
):
    """
    Stop a running TensorBoard server.
    """
    import signal

    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    key = f"{project_id}:{log_dir}"
    if key not in tensorboard_processes:
        return {"status": "not_running"}

    proc_info = tensorboard_processes[key]

    # Handle restored processes (no subprocess.Popen object)
    if proc_info.get("restored"):
        pid = proc_info.get("pid")
        if pid and is_process_alive(pid):
            try:
                os.kill(pid, signal.SIGTERM)
                # Wait for graceful shutdown
                import time
                for _ in range(10):  # 5 second timeout
                    time.sleep(0.5)
                    if not is_process_alive(pid):
                        break
                else:
                    # Force kill if still running
                    os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    else:
        proc = proc_info["process"]
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except:
                proc.kill()

    del tensorboard_processes[key]
    remove_tensorboard_pid(key)
    return {"status": "stopped"}


@app.get("/projects/{project_id}/tensorboard/status")
def get_tensorboard_status(
    project_id: int,
    session: Session = Depends(get_session)
):
    """
    Get status of TensorBoard servers for a project.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    running = []
    for key, info in list(tensorboard_processes.items()):
        if key.startswith(f"{project_id}:"):
            # Handle restored processes (no subprocess.Popen object)
            if info.get("restored"):
                pid = info.get("pid")
                if pid and is_process_alive(pid):
                    running.append({
                        "log_dir": info["log_dir"],
                        "url": info["url"],
                        "port": info["port"]
                    })
                else:
                    # Clean up dead processes
                    del tensorboard_processes[key]
                    remove_tensorboard_pid(key)
            else:
                proc = info["process"]
                if proc.poll() is None:  # Still running
                    running.append({
                        "log_dir": info["log_dir"],
                        "url": info["url"],
                        "port": info["port"]
                    })
                else:
                    # Clean up dead processes
                    del tensorboard_processes[key]
                    remove_tensorboard_pid(key)

    return {"running": running}


# ============================================================================
# TERMINAL ENDPOINTS
# ============================================================================

@app.post("/terminal/start")
def start_terminal(
    admin: User = Depends(require_admin)
):
    """
    Start a new general terminal session.
    Returns session_id to use with WebSocket.
    Admin only - interactive terminal is a privileged operation.
    """
    manager = get_process_manager()
    session_id = manager.create_terminal_session()
    return {"session_id": session_id}


@app.get("/terminal/{session_id}/status")
def get_terminal_status(session_id: int):
    """
    Check if a terminal session is still alive.
    Returns session status and whether it can be reconnected.
    """
    manager = get_process_manager()
    pty_session = manager.get_pty_session(session_id)

    if not pty_session:
        return {"alive": False, "message": "Session not found"}

    if pty_session.is_alive():
        return {"alive": True, "session_id": session_id}
    else:
        return {"alive": False, "message": "Session is no longer alive"}


@app.websocket("/ws/terminal/{session_id}")
async def websocket_terminal(websocket: WebSocket, session_id: int):
    """
    WebSocket endpoint for interactive terminal.

    Protocol:
    - Client sends: {"type": "command", "data": "command string"}
    - Server sends: {"type": "output", "data": "output line"}
    - Server sends: {"type": "exit", "code": exit_code}
    - Server sends: {"type": "error", "data": "error message"}
    """
    await handle_terminal(websocket, session_id)


# ============================================================================
# WEBSOCKET ENDPOINT
# ============================================================================

@app.websocket("/ws/logs/{job_id}")
async def websocket_logs(websocket: WebSocket, job_id: int):
    """
    WebSocket endpoint for real-time log streaming.

    Connect to this endpoint with a job_id to receive log lines in real-time.
    Messages are JSON formatted:
    - {"type": "log", "data": "log line content"}
    - {"type": "end", "message": "completion message"}
    - {"type": "error", "message": "error message"}
    """
    await stream_logs(websocket, job_id)


@app.websocket("/ws/status")
async def websocket_status(websocket: WebSocket):
    """
    WebSocket endpoint for global status updates.

    Connect here to receive real-time notifications about:
    - Job status changes (started, stopped, completed, failed)
    - Project status changes
    - New projects created

    This eliminates the need for polling.
    Messages are JSON formatted:
    - {"type": "initial_state", "data": {...}}
    - {"type": "job_started", "data": {...}}
    - {"type": "job_completed", "data": {...}}
    - {"type": "project_updated", "data": {...}}
    """
    await handle_status_websocket(websocket)


# ============================================================================
# SYSTEM STATUS & HEALTH CHECK
# ============================================================================

@app.get("/system/status")
async def get_system_status():
    """
    Get current system resource usage.

    Returns CPU, memory, and GPU (if available) usage stats
    for the resource monitor widget.
    """
    import psutil
    import subprocess
    import platform

    # CPU usage (percentage)
    cpu_percent = psutil.cpu_percent(interval=0.1)
    cpu_count = psutil.cpu_count()

    # Memory usage
    memory = psutil.virtual_memory()
    memory_total_gb = memory.total / (1024 ** 3)
    memory_used_gb = memory.used / (1024 ** 3)
    memory_percent = memory.percent

    # Disk usage for workspace
    disk = psutil.disk_usage('/')
    disk_total_gb = disk.total / (1024 ** 3)
    disk_used_gb = disk.used / (1024 ** 3)
    disk_percent = disk.percent

    # GPU detection (macOS Apple Silicon or NVIDIA)
    gpu_info = None
    system = platform.system()

    if system == "Darwin":
        # macOS - try to get GPU info via system_profiler
        try:
            result = subprocess.run(
                ["system_profiler", "SPDisplaysDataType", "-json"],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                import json
                data = json.loads(result.stdout)
                displays = data.get("SPDisplaysDataType", [])
                if displays:
                    gpu_name = displays[0].get("sppci_model", "Unknown GPU")
                    # For Apple Silicon, we can't get utilization easily
                    # but we can indicate it's available
                    gpu_info = {
                        "name": gpu_name,
                        "available": True,
                        "utilization": None,  # Not easily accessible on macOS
                        "memory_used": None,
                        "memory_total": None
                    }
        except Exception:
            pass
    else:
        # Linux/Windows - try nvidia-smi for NVIDIA GPUs
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total",
                 "--format=csv,noheader,nounits"],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                lines = result.stdout.strip().split('\n')
                if lines and lines[0]:
                    parts = lines[0].split(', ')
                    if len(parts) >= 4:
                        gpu_info = {
                            "name": parts[0].strip(),
                            "available": True,
                            "utilization": float(parts[1].strip()),
                            "memory_used": float(parts[2].strip()),
                            "memory_total": float(parts[3].strip())
                        }
        except Exception:
            pass

    # Additional memory details
    swap = psutil.swap_memory()
    swap_total_gb = swap.total / (1024 ** 3)
    swap_used_gb = swap.used / (1024 ** 3)

    # For macOS, get memory pressure if available
    memory_pressure = None
    if system == "Darwin":
        try:
            # Try to get memory pressure from vm_stat
            result = subprocess.run(
                ["vm_stat"],
                capture_output=True,
                text=True,
                timeout=2
            )
            if result.returncode == 0:
                # Parse vm_stat output to calculate pressure
                lines = result.stdout.strip().split('\n')
                stats = {}
                for line in lines[1:]:
                    if ':' in line:
                        key, value = line.split(':')
                        # Remove dots and convert to int
                        value = value.strip().rstrip('.')
                        if value.isdigit():
                            stats[key.strip()] = int(value)

                # Calculate approximate pressure based on page states
                pages_active = stats.get('Pages active', 0)
                pages_wired = stats.get('Pages wired down', 0)
                pages_compressed = stats.get('Pages occupied by compressor', 0)
                pages_free = stats.get('Pages free', 0)

                total_pages = pages_active + pages_wired + pages_compressed + pages_free
                if total_pages > 0:
                    # Higher compressed pages = higher pressure
                    pressure_ratio = (pages_compressed / total_pages) * 100
                    if pressure_ratio > 30:
                        memory_pressure = "critical"
                    elif pressure_ratio > 15:
                        memory_pressure = "warning"
                    else:
                        memory_pressure = "normal"
        except Exception:
            pass

    return {
        "cpu": {
            "percent": cpu_percent,
            "count": cpu_count
        },
        "memory": {
            "percent": memory_percent,
            "used_gb": round(memory_used_gb, 1),
            "total_gb": round(memory_total_gb, 1),
            "available_gb": round(memory.available / (1024 ** 3), 1),
            "pressure": memory_pressure
        },
        "swap": {
            "percent": swap.percent,
            "used_gb": round(swap_used_gb, 1),
            "total_gb": round(swap_total_gb, 1)
        },
        "disk": {
            "percent": disk_percent,
            "used_gb": round(disk_used_gb, 1),
            "total_gb": round(disk_total_gb, 1)
        },
        "gpu": gpu_info,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


# ============================================================================
# SCHEDULER ENDPOINTS
# ============================================================================

@app.get("/scheduler/status")
async def scheduler_status():
    """Get the current scheduler status."""
    return get_scheduler_status()


@app.get("/scheduler/presets")
async def get_cron_presets():
    """Get available cron expression presets for the UI."""
    return CRON_PRESETS


@app.get("/scheduler/tasks", response_model=List[ScheduledTaskRead])
async def list_scheduled_tasks(
    project_id: Optional[int] = None,
    session: Session = Depends(get_session)
):
    """
    List all scheduled tasks, optionally filtered by project.
    """
    if project_id:
        statement = select(ScheduledTask).where(ScheduledTask.project_id == project_id)
    else:
        statement = select(ScheduledTask)

    tasks = session.exec(statement).all()
    return tasks


@app.get("/scheduler/tasks/{task_id}", response_model=ScheduledTaskRead)
async def get_scheduled_task(
    task_id: int,
    session: Session = Depends(get_session)
):
    """Get a specific scheduled task."""
    task = session.get(ScheduledTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Scheduled task not found")
    return task


@app.post("/scheduler/tasks", response_model=ScheduledTaskRead)
async def create_scheduled_task(
    task_data: ScheduledTaskCreate,
    session: Session = Depends(get_session)
):
    """
    Create a new scheduled task.

    The task will be automatically added to the scheduler if enabled.
    """
    # Verify project exists
    project = session.get(Project, task_data.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Validate cron expression (basic check)
    cron_parts = task_data.cron_expression.strip().split()
    if len(cron_parts) != 5:
        raise HTTPException(
            status_code=400,
            detail="Invalid cron expression. Format: 'minute hour day month day_of_week'"
        )

    # Create the task
    task = ScheduledTask.model_validate(task_data)
    session.add(task)
    session.commit()
    session.refresh(task)

    # Add to scheduler if enabled
    if task.enabled:
        if not add_scheduled_job(task):
            # Task created but failed to schedule
            task.enabled = False
            session.add(task)
            session.commit()
            session.refresh(task)

    return task


@app.patch("/scheduler/tasks/{task_id}", response_model=ScheduledTaskRead)
async def update_scheduled_task_endpoint(
    task_id: int,
    task_update: ScheduledTaskUpdate,
    session: Session = Depends(get_session)
):
    """
    Update a scheduled task.

    The scheduler will be updated if the cron expression or enabled status changes.
    """
    task = session.get(ScheduledTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Scheduled task not found")

    # Validate cron if provided
    if task_update.cron_expression:
        cron_parts = task_update.cron_expression.strip().split()
        if len(cron_parts) != 5:
            raise HTTPException(
                status_code=400,
                detail="Invalid cron expression. Format: 'minute hour day month day_of_week'"
            )

    # Update fields
    update_data = task_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(task, key, value)

    session.add(task)
    session.commit()
    session.refresh(task)

    # Update scheduler
    update_scheduled_job(task)

    return task


@app.delete("/scheduler/tasks/{task_id}")
async def delete_scheduled_task(
    task_id: int,
    session: Session = Depends(get_session)
):
    """Delete a scheduled task."""
    task = session.get(ScheduledTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Scheduled task not found")

    # Remove from scheduler
    remove_scheduled_job(task_id)

    # Delete from database
    session.delete(task)
    session.commit()

    return {"status": "deleted", "task_id": task_id}


@app.post("/scheduler/tasks/{task_id}/run")
async def run_scheduled_task_now(
    task_id: int,
    session: Session = Depends(get_session)
):
    """
    Run a scheduled task immediately (manual trigger).
    """
    from .scheduler import execute_scheduled_task

    task = session.get(ScheduledTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Scheduled task not found")

    # Execute the task asynchronously
    asyncio.create_task(execute_scheduled_task(task_id))

    return {"status": "triggered", "task_id": task_id, "task_name": task.name}


# ============================================================================
# SYSTEM SCRIPTS ENDPOINTS
# ============================================================================

from .manager import list_system_scripts, run_system_script


@app.get("/system-scripts")
async def get_system_scripts(
    admin: User = Depends(require_admin)
):
    """
    List all available system scripts.
    Admin only.

    Returns scripts from the backend/system_scripts folder.
    """
    scripts = list_system_scripts()
    return {"scripts": scripts}


@app.post("/system-scripts/run/{script_name}")
async def execute_system_script(
    script_name: str,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin)
):
    """
    Execute a system script.
    Admin only.

    Args:
        script_name: Name of the script file (e.g., "clean_docker.sh")

    Returns:
        Script execution result with output and exit code.
    """
    try:
        return_code, output = await run_system_script(script_name)

        # Log the activity
        log_activity(
            session,
            username=admin.username,
            action="run_system_script",
            target=script_name,
            details=f"exit_code={return_code}"
        )

        return {
            "script_name": script_name,
            "success": return_code == 0,
            "exit_code": return_code,
            "output": output
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error executing script: {str(e)}")


# ============================================================================
# USER MANAGEMENT ENDPOINTS (Admin Only)
# ============================================================================

class PasswordChangeRequest(BaseModel):
    """Request body for changing password."""
    current_password: str
    new_password: str


@app.post("/admin/users/", response_model=UserRead)
def create_user(
    user_data: UserCreate,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin)
):
    """
    Create a new user. Admin only.
    """
    # Check if username already exists
    existing_user = session.get(User, user_data.username)
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already exists")

    # Create the user
    new_user = User(
        username=user_data.username,
        hashed_password=hash_password(user_data.password),
        role=user_data.role
    )
    session.add(new_user)
    session.commit()
    session.refresh(new_user)

    # Log the activity
    log_activity(
        session,
        username=admin.username,
        action="create_user",
        target=user_data.username,
        details=f"role={user_data.role.value}"
    )

    return new_user


@app.get("/admin/users/", response_model=List[UserRead])
def list_users(
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin)
):
    """
    List all users. Admin only.
    """
    users = session.exec(select(User)).all()
    return users


@app.delete("/admin/users/{username}")
def delete_user(
    username: str,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin)
):
    """
    Delete a user. Admin only.
    Cannot delete yourself.
    """
    if username == admin.username:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    user = session.get(User, username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    session.delete(user)
    session.commit()

    # Log the activity
    log_activity(
        session,
        username=admin.username,
        action="delete_user",
        target=username
    )

    return {"status": "deleted", "username": username}


@app.post("/users/me/change-password")
def change_password(
    request: PasswordChangeRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    Change the current user's password.
    Requires current password for verification.
    """
    # Verify current password
    if not verify_password(request.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    # Update password
    current_user.hashed_password = hash_password(request.new_password)
    session.add(current_user)
    session.commit()

    # Log the activity
    log_activity(
        session,
        username=current_user.username,
        action="change_password",
        target=current_user.username
    )

    return {"status": "password_changed"}


@app.get("/users/me", response_model=UserRead)
def get_current_user_info(
    current_user: User = Depends(get_current_user)
):
    """
    Get the current authenticated user's info.
    """
    return current_user


# ============================================================================
# LOGIN ENDPOINT
# ============================================================================

@app.post("/auth/login", response_model=UserRead)
def login(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    Login endpoint - validates credentials and returns user info.
    Use HTTP Basic Auth header: Authorization: Basic base64(username:password)

    Returns user info if credentials are valid, 401 if invalid.
    """
    # Log the login activity
    log_activity(
        session,
        username=current_user.username,
        action="login",
        target=current_user.username
    )
    return current_user


@app.get("/auth/check")
def check_auth(
    current_user: User = Depends(get_current_user)
):
    """
    Quick auth check endpoint - returns 200 if authenticated, 401 if not.
    Useful for frontend to verify stored credentials are still valid.
    """
    return {
        "authenticated": True,
        "username": current_user.username,
        "role": current_user.role.value
    }


# ============================================================================
# AUDIT LOG ENDPOINTS (Admin Only)
# ============================================================================

@app.get("/admin/audit-logs", response_model=List[AuditLogRead])
def get_audit_logs(
    limit: int = Query(default=100, le=1000),
    offset: int = Query(default=0, ge=0),
    username: Optional[str] = None,
    action: Optional[str] = None,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin)
):
    """
    Get audit logs. Admin only.
    Supports filtering by username and action, with pagination.
    """
    statement = select(AuditLog).order_by(AuditLog.timestamp.desc())

    if username:
        statement = statement.where(AuditLog.username == username)
    if action:
        statement = statement.where(AuditLog.action == action)

    statement = statement.offset(offset).limit(limit)
    logs = session.exec(statement).all()

    return logs


@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "MacRunner"}
