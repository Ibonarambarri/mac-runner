"""
MacRunner - FastAPI Application
REST API endpoints and WebSocket routes for the task orchestration system.
"""

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List

from fastapi import FastAPI, HTTPException, Depends, WebSocket, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from sqlmodel import Session, select

from .database import create_db_and_tables, get_session, engine
from .models import (
    Project, ProjectCreate, ProjectRead, ProjectUpdate,
    Job, JobRead, JobStatus, ProjectStatus,
    CommandTemplate, CommandTemplateCreate, CommandTemplateRead, CommandTemplateUpdate,
    FileInfo
)
from .manager import init_process_manager, get_process_manager
from .websockets import stream_logs, handle_terminal


# Application base path (parent of /app)
BASE_PATH = Path(__file__).parent.parent


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan handler.
    Initializes database and process manager on startup.
    """
    # Startup
    create_db_and_tables()
    init_process_manager(BASE_PATH)
    print("🚀 MacRunner initialized")
    print(f"   Workspaces: {BASE_PATH / 'workspaces'}")
    print(f"   Logs: {BASE_PATH / 'logs'}")

    yield

    # Shutdown - stop all running processes
    manager = get_process_manager()
    for job_id in list(manager.running_processes.keys()):
        await manager.stop_job(job_id)
    print("👋 MacRunner shutdown complete")


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
def list_projects(session: Session = Depends(get_session)):
    """List all projects."""
    projects = session.exec(select(Project)).all()
    return projects


@app.get("/projects/{project_id}", response_model=ProjectRead)
def get_project(project_id: int, session: Session = Depends(get_session)):
    """Get a specific project by ID."""
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
        with Session(engine) as bg_session:
            proj = bg_session.get(Project, project_id)
            j = bg_session.get(Job, job.id)
            manager = get_process_manager()
            await manager.git_pull(proj, j, bg_session)

    background_tasks.add_task(pull_task)

    return job


@app.post("/projects/{project_id}/install", response_model=JobRead)
async def install_project(
    project_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session)
):
    """
    Run the install/build command for a project.
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

    # Run install in background
    async def install_task():
        with Session(engine) as bg_session:
            proj = bg_session.get(Project, project_id)
            j = bg_session.get(Job, job.id)
            manager = get_process_manager()
            await manager.run_command(proj, j, proj.install_command, bg_session)

    background_tasks.add_task(install_task)

    return job


@app.post("/projects/{project_id}/run", response_model=JobRead)
async def run_project(
    project_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session)
):
    """
    Run the main command for a project.
    Creates a new job and streams logs via WebSocket.

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

    # Run job in background
    async def run_task():
        with Session(engine) as bg_session:
            proj = bg_session.get(Project, project_id)
            j = bg_session.get(Job, job.id)
            manager = get_process_manager()
            await manager.run_command(proj, j, proj.run_command, bg_session)

    background_tasks.add_task(run_task)

    return job


@app.get("/projects/{project_id}/jobs", response_model=List[JobRead])
def list_project_jobs(project_id: int, session: Session = Depends(get_session)):
    """List all jobs for a project."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    jobs = session.exec(
        select(Job).where(Job.project_id == project_id).order_by(Job.start_time.desc())
    ).all()

    return jobs


@app.get("/jobs/{job_id}", response_model=JobRead)
def get_job(job_id: int, session: Session = Depends(get_session)):
    """Get a specific job by ID."""
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.post("/jobs/{job_id}/stop")
async def stop_job(job_id: int, session: Session = Depends(get_session)):
    """
    Stop a running job by terminating its process.
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
def list_command_templates(project_id: int, session: Session = Depends(get_session)):
    """List all command templates for a project."""
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
    session: Session = Depends(get_session)
):
    """Create a new command template for a project."""
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
    session: Session = Depends(get_session)
):
    """Update a command template."""
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
    session: Session = Depends(get_session)
):
    """Delete a command template."""
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
    session: Session = Depends(get_session)
):
    """
    Execute a command template.
    Creates a new job and streams logs via WebSocket.
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

    # Run command in background
    async def run_task():
        with Session(engine) as bg_session:
            proj = bg_session.get(Project, project_id)
            j = bg_session.get(Job, job.id)
            manager = get_process_manager()
            await manager.run_command(proj, j, template.command, bg_session)

    background_tasks.add_task(run_task)

    return job


# ============================================================================
# FILE EXPLORER ENDPOINTS
# ============================================================================

@app.get("/projects/{project_id}/files", response_model=List[FileInfo])
def list_files(
    project_id: int,
    path: str = "",
    session: Session = Depends(get_session)
):
    """
    List files and directories at a given path within the project workspace.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project workspace not ready")

    manager = get_process_manager()
    try:
        files = manager.list_directory(project_id, path)
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
    session: Session = Depends(get_session)
):
    """
    Download a folder as a ZIP archive.
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
        return FileResponse(
            path=zip_path,
            filename=f"{folder_name}.zip",
            media_type="application/zip",
            background=None  # Don't delete immediately, let client finish download
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================================
# TERMINAL ENDPOINTS
# ============================================================================

@app.post("/terminal/start")
def start_terminal():
    """
    Start a new general terminal session.
    Returns session_id to use with WebSocket.
    """
    manager = get_process_manager()
    session_id = manager.create_terminal_session()
    return {"session_id": session_id}


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


# ============================================================================
# HEALTH CHECK
# ============================================================================

@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "MacRunner"}
