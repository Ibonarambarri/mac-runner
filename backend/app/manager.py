"""
MacRunner - Process Manager
Handles Git cloning, virtual environment setup, and async subprocess execution.

CRITICAL: Uses PYTHONUNBUFFERED=1 to ensure real-time log streaming.
"""

import asyncio
import os
import re
import signal
import shlex
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, AsyncGenerator
from collections import defaultdict

from sqlmodel import Session

from .models import Project, Job, ProjectStatus, JobStatus


def validate_repo_url(url: str) -> bool:
    """
    Validate that a repository URL is safe and properly formatted.
    Only allows HTTPS GitHub/GitLab URLs or SSH git URLs.
    """
    # Pattern for HTTPS URLs (GitHub, GitLab, Bitbucket, etc.)
    https_pattern = r'^https://[\w.-]+/[\w.-]+/[\w.-]+(?:\.git)?$'
    # Pattern for SSH URLs
    ssh_pattern = r'^git@[\w.-]+:[\w.-]+/[\w.-]+(?:\.git)?$'

    return bool(re.match(https_pattern, url) or re.match(ssh_pattern, url))


def sanitize_command(command: str) -> str:
    """
    Basic sanitization of commands - removes obviously dangerous patterns.
    Note: This is defense in depth, not a complete solution.
    """
    # Remove command chaining attempts that could break out
    dangerous_patterns = [
        r';\s*rm\s',
        r'&&\s*rm\s',
        r'\|\s*rm\s',
        r'`.*`',  # Backtick command substitution
        r'\$\(.*\)',  # $() command substitution
    ]

    for pattern in dangerous_patterns:
        if re.search(pattern, command, re.IGNORECASE):
            raise ValueError(f"Command contains potentially dangerous pattern")

    return command


class ProcessManager:
    """
    Manages project workspaces, git operations, and subprocess execution.

    Key features:
    - Async subprocess handling with real-time output capture
    - Virtual environment creation and management
    - Log streaming via async generators
    """

    def __init__(self, base_path: Path):
        """
        Initialize the process manager.

        Args:
            base_path: Root directory for workspaces and logs
        """
        self.workspaces_path = base_path / "workspaces"
        self.logs_path = base_path / "logs"

        # Ensure directories exist
        self.workspaces_path.mkdir(parents=True, exist_ok=True)
        self.logs_path.mkdir(parents=True, exist_ok=True)

        # Track running processes by job_id
        self.running_processes: Dict[int, asyncio.subprocess.Process] = {}

        # Log queues for real-time streaming (job_id -> list of connected queues)
        self.log_queues: Dict[int, list[asyncio.Queue]] = defaultdict(list)

    def get_project_workspace(self, project_id: int) -> Path:
        """Get the workspace directory for a project."""
        return self.workspaces_path / f"project_{project_id}"

    def get_job_log_path(self, job_id: int) -> Path:
        """Get the log file path for a job."""
        return self.logs_path / f"job_{job_id}.log"

    async def clone_repository(
        self,
        project: Project,
        session: Session
    ) -> bool:
        """
        Clone a GitHub repository into the project workspace.

        Args:
            project: Project model with repo_url
            session: Database session for status updates

        Returns:
            True if successful, False otherwise
        """
        workspace = self.get_project_workspace(project.id)

        # Clean existing workspace if present
        if workspace.exists():
            shutil.rmtree(workspace)

        workspace.mkdir(parents=True, exist_ok=True)

        # Update status to cloning
        project.status = ProjectStatus.CLONING
        project.workspace_path = str(workspace)
        session.add(project)
        session.commit()

        try:
            # Validate repo URL to prevent command injection
            if not validate_repo_url(project.repo_url):
                print(f"Invalid repository URL: {project.repo_url}")
                project.status = ProjectStatus.ERROR
                session.add(project)
                session.commit()
                return False

            # Execute git clone using subprocess with list args (safer than shell)
            process = await asyncio.create_subprocess_exec(
                "git", "clone", project.repo_url, ".",
                cwd=workspace,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )

            stdout, stderr = await process.communicate()

            if process.returncode != 0:
                print(f"Git clone failed: {stderr.decode()}")
                project.status = ProjectStatus.ERROR
                session.add(project)
                session.commit()
                return False

            # Create virtual environment
            venv_path = workspace / "venv"
            process = await asyncio.create_subprocess_exec(
                "python3", "-m", "venv", str(venv_path),
                cwd=workspace,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )

            await process.communicate()

            if process.returncode != 0:
                print("Failed to create virtual environment")
                project.status = ProjectStatus.ERROR
                session.add(project)
                session.commit()
                return False

            # Success - set to idle
            project.status = ProjectStatus.IDLE
            session.add(project)
            session.commit()

            return True

        except Exception as e:
            print(f"Clone error: {e}")
            project.status = ProjectStatus.ERROR
            session.add(project)
            session.commit()
            return False

    async def run_command(
        self,
        project: Project,
        job: Job,
        command: str,
        session: Session
    ) -> None:
        """
        Execute any command as an async subprocess.

        This is the generic method used by all command execution (run, install, custom templates).

        CRITICAL IMPLEMENTATION NOTES:
        1. PYTHONUNBUFFERED=1 ensures Python output is not buffered
        2. stdout/stderr are read line-by-line for real-time streaming
        3. Lines are pushed to queues AND written to log file

        Args:
            project: Project with workspace configuration
            job: Job to track execution
            command: The command string to execute
            session: Database session
        """
        workspace = Path(project.workspace_path)
        venv_path = workspace / "venv"
        log_path = self.get_job_log_path(job.id)

        # Build the activation + command
        # We source the venv and run the command in a single shell
        activate_cmd = f'source "{venv_path}/bin/activate"'
        full_command = f"{activate_cmd} && {command}"

        # Environment variables - CRITICAL for real-time output
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"  # Force unbuffered Python output
        env["FORCE_COLOR"] = "1"  # Enable colored output if supported

        # Update job status
        job.status = JobStatus.RUNNING
        job.log_path = str(log_path)
        session.add(job)
        session.commit()

        # Update project status
        project.status = ProjectStatus.RUNNING
        session.add(project)
        session.commit()

        try:
            # Create subprocess with piped stdout/stderr
            # Using shell=True via create_subprocess_shell to handle complex commands
            process = await asyncio.create_subprocess_shell(
                full_command,
                cwd=workspace,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                # Start new process group for clean termination
                start_new_session=True
            )

            # Store process and PID for potential stopping
            self.running_processes[job.id] = process
            job.pid = process.pid
            session.add(job)
            session.commit()

            # Open log file for writing
            with open(log_path, "w") as log_file:
                # Write command being executed as header
                header = f"$ {command}\n{'='*50}\n"
                log_file.write(header)
                for queue in self.log_queues[job.id]:
                    await queue.put(header)

                # Process stdout and stderr concurrently
                # This ensures we capture all output in real-time
                async def read_stream(stream, prefix=""):
                    """Read stream line by line and broadcast to queues."""
                    while True:
                        line = await stream.readline()
                        if not line:
                            break

                        decoded_line = line.decode("utf-8", errors="replace")
                        formatted_line = f"{prefix}{decoded_line}"

                        # Write to log file
                        log_file.write(formatted_line)
                        log_file.flush()  # Ensure immediate write

                        # Broadcast to all connected WebSocket queues
                        for queue in self.log_queues[job.id]:
                            await queue.put(formatted_line)

                # Run both stream readers concurrently
                await asyncio.gather(
                    read_stream(process.stdout),
                    read_stream(process.stderr, prefix="[stderr] ")
                )

                # Wait for process to complete
                return_code = await process.wait()

                # Final status message
                end_msg = f"\n{'='*50}\nProcess finished with exit code: {return_code}\n"
                log_file.write(end_msg)
                for queue in self.log_queues[job.id]:
                    await queue.put(end_msg)
                    await queue.put(None)  # Signal end of stream

            # Update final status
            job.status = JobStatus.COMPLETED if return_code == 0 else JobStatus.FAILED
            job.end_time = datetime.now(timezone.utc)
            session.add(job)

            project.status = ProjectStatus.IDLE
            session.add(project)
            session.commit()

        except asyncio.CancelledError:
            # Job was stopped
            job.status = JobStatus.STOPPED
            job.end_time = datetime.now(timezone.utc)
            session.add(job)

            project.status = ProjectStatus.IDLE
            session.add(project)
            session.commit()

        except Exception as e:
            error_msg = f"\n[ERROR] {str(e)}\n"

            # Write error to log
            with open(log_path, "a") as log_file:
                log_file.write(error_msg)

            # Broadcast error
            for queue in self.log_queues[job.id]:
                await queue.put(error_msg)
                await queue.put(None)

            job.status = JobStatus.FAILED
            job.end_time = datetime.now(timezone.utc)
            session.add(job)

            project.status = ProjectStatus.ERROR
            session.add(project)
            session.commit()

        finally:
            # Cleanup
            self.running_processes.pop(job.id, None)

    async def stop_job(self, job_id: int) -> bool:
        """
        Stop a running job by sending SIGTERM to its process group.

        Args:
            job_id: ID of the job to stop

        Returns:
            True if process was stopped, False if not found
        """
        process = self.running_processes.get(job_id)

        if process is None:
            return False

        try:
            # Send SIGTERM to the entire process group
            # This ensures child processes are also terminated
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)

            # Wait a bit for graceful shutdown
            try:
                await asyncio.wait_for(process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                # Force kill if still running
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)

            return True

        except ProcessLookupError:
            # Process already dead
            return True
        except Exception as e:
            print(f"Error stopping job {job_id}: {e}")
            return False

    def subscribe_to_logs(self, job_id: int) -> asyncio.Queue:
        """
        Subscribe to real-time logs for a job.

        Returns an asyncio.Queue that will receive log lines.
        """
        queue = asyncio.Queue()
        self.log_queues[job_id].append(queue)
        return queue

    def unsubscribe_from_logs(self, job_id: int, queue: asyncio.Queue) -> None:
        """Remove a queue from the log subscribers."""
        if job_id in self.log_queues:
            try:
                self.log_queues[job_id].remove(queue)
            except ValueError:
                pass

            # Clean up empty lists
            if not self.log_queues[job_id]:
                del self.log_queues[job_id]

    async def get_existing_logs(self, job_id: int) -> AsyncGenerator[str, None]:
        """
        Generator that yields existing log lines from file.
        Used when connecting to a job that already has logs.
        """
        log_path = self.get_job_log_path(job_id)

        if not log_path.exists():
            return

        with open(log_path, "r") as f:
            for line in f:
                yield line


# Global process manager instance
# Initialized in main.py with proper paths
process_manager: Optional[ProcessManager] = None


def get_process_manager() -> ProcessManager:
    """Get the global process manager instance."""
    if process_manager is None:
        raise RuntimeError("ProcessManager not initialized")
    return process_manager


def init_process_manager(base_path: Path) -> ProcessManager:
    """Initialize the global process manager."""
    global process_manager
    process_manager = ProcessManager(base_path)
    return process_manager
