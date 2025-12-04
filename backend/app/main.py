"""
MacRunner - FastAPI Application
REST API endpoints and WebSocket routes for the task orchestration system.
"""

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List

from fastapi import FastAPI, HTTPException, Depends, WebSocket, BackgroundTasks, Query
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
from .websockets import stream_logs, handle_terminal, handle_status_websocket, broadcast_status_update


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


from pydantic import BaseModel

class OneOffCommandRequest(BaseModel):
    """Request body for one-off command execution."""
    command: str


@app.post("/projects/{project_id}/run-command", response_model=JobRead)
async def run_one_off_command(
    project_id: int,
    request: OneOffCommandRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session)
):
    """
    Execute a one-off command without saving it as a template.
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


@app.get("/projects/{project_id}/files/download-batch")
def download_batch_files(
    project_id: int,
    paths: List[str] = Query(...),
    session: Session = Depends(get_session)
):
    """
    Download multiple selected files/folders as a single ZIP archive.

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
        return FileResponse(
            path=zip_path,
            filename=f"{project.name}_selected.zip",
            media_type="application/zip",
            background=None
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================================
# JUPYTER NOTEBOOK ENDPOINTS
# ============================================================================

# Track running Jupyter Lab processes
jupyter_processes: dict = {}


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

    # Find a free port
    try:
        port = find_free_port()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    # Generate a token for authentication
    token = secrets.token_urlsafe(32)

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

        # Build the URL
        import socket
        hostname = socket.gethostname()
        url = f"http://{hostname}:{port}/lab?token={token}"

        # Store process info
        jupyter_processes[project_id] = {
            "process": process,
            "port": port,
            "token": token,
            "url": url
        }

        return {
            "status": "started",
            "url": url,
            "port": port
        }

    except FileNotFoundError:
        raise HTTPException(
            status_code=500,
            detail="Jupyter Lab not found. Please install it with: pip install jupyterlab"
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
    proc = proc_info["process"]

    if proc.poll() is None:  # Still running
        import os
        import signal
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)

    del jupyter_processes[project_id]

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
        proc = tensorboard_processes[key]["process"]
        if proc.poll() is None:  # Still running
            return {
                "status": "already_running",
                "url": tensorboard_processes[key]["url"],
                "port": tensorboard_processes[key]["port"]
            }

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

        url = f"http://localhost:{actual_port}"
        tensorboard_processes[key] = {
            "process": proc,
            "port": actual_port,
            "url": url,
            "log_dir": log_dir
        }

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
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    key = f"{project_id}:{log_dir}"
    if key not in tensorboard_processes:
        return {"status": "not_running"}

    proc = tensorboard_processes[key]["process"]
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except:
            proc.kill()

    del tensorboard_processes[key]
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

    return {"running": running}


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

    return {
        "cpu": {
            "percent": cpu_percent,
            "count": cpu_count
        },
        "memory": {
            "percent": memory_percent,
            "used_gb": round(memory_used_gb, 1),
            "total_gb": round(memory_total_gb, 1)
        },
        "disk": {
            "percent": disk_percent,
            "used_gb": round(disk_used_gb, 1),
            "total_gb": round(disk_total_gb, 1)
        },
        "gpu": gpu_info
    }


@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "MacRunner"}
