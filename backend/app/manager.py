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
import zipfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, AsyncGenerator, List
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
    - General terminal for system-wide commands
    """

    def __init__(self, base_path: Path):
        """
        Initialize the process manager.

        Args:
            base_path: Root directory for workspaces and logs
        """
        self.workspaces_path = base_path / "workspaces"
        self.logs_path = base_path / "logs"
        self.terminal_workspace = base_path / "workspaces" / "_terminal"

        # Ensure directories exist
        self.workspaces_path.mkdir(parents=True, exist_ok=True)
        self.logs_path.mkdir(parents=True, exist_ok=True)
        self.terminal_workspace.mkdir(parents=True, exist_ok=True)

        # Track running processes by job_id
        self.running_processes: Dict[int, asyncio.subprocess.Process] = {}

        # Log queues for real-time streaming (job_id -> list of connected queues)
        self.log_queues: Dict[int, list[asyncio.Queue]] = defaultdict(list)

        # Terminal session counter
        self._terminal_session_counter = 0

        # Terminal output queues (session_id -> list of connected queues)
        self.terminal_queues: Dict[int, list[asyncio.Queue]] = defaultdict(list)

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

    async def git_pull(
        self,
        project: Project,
        job: Job,
        session: Session
    ) -> None:
        """
        Execute git pull in the project workspace.

        Args:
            project: Project with workspace configuration
            job: Job to track execution
            session: Database session
        """
        workspace = Path(project.workspace_path)
        log_path = self.get_job_log_path(job.id)

        # Update job status
        job.status = JobStatus.RUNNING
        job.log_path = str(log_path)
        session.add(job)
        session.commit()

        try:
            # Open log file for writing
            with open(log_path, "w") as log_file:
                # Write header
                header = f"$ git pull\n{'='*50}\n"
                log_file.write(header)
                for queue in self.log_queues[job.id]:
                    await queue.put(header)

                # Execute git pull using subprocess with list args (safer than shell)
                process = await asyncio.create_subprocess_exec(
                    "git", "pull",
                    cwd=workspace,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )

                # Store process for potential stopping
                self.running_processes[job.id] = process
                job.pid = process.pid
                session.add(job)
                session.commit()

                # Process stdout and stderr concurrently
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
                        log_file.flush()

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
                end_msg = f"\n{'='*50}\nGit pull finished with exit code: {return_code}\n"
                log_file.write(end_msg)
                for queue in self.log_queues[job.id]:
                    await queue.put(end_msg)
                    await queue.put(None)  # Signal end of stream

            # Update final status
            job.status = JobStatus.COMPLETED if return_code == 0 else JobStatus.FAILED
            job.end_time = datetime.now(timezone.utc)
            session.add(job)
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
            session.commit()

        finally:
            # Cleanup
            self.running_processes.pop(job.id, None)

    def validate_path(self, workspace: Path, relative_path: str) -> Path:
        """
        Validate and resolve a path within the workspace.
        Prevents directory traversal attacks.

        Args:
            workspace: The project workspace root
            relative_path: Relative path from workspace root

        Returns:
            Resolved absolute path

        Raises:
            ValueError: If path is outside workspace
        """
        # Handle empty path as workspace root
        if not relative_path or relative_path == ".":
            return workspace

        # Resolve the full path
        full_path = (workspace / relative_path).resolve()

        # Ensure the path is within the workspace
        try:
            full_path.relative_to(workspace.resolve())
        except ValueError:
            raise ValueError("Path is outside workspace")

        return full_path

    def list_directory(self, project_id: int, relative_path: str = "") -> List[dict]:
        """
        List contents of a directory in project workspace.

        Args:
            project_id: Project ID
            relative_path: Relative path within workspace

        Returns:
            List of FileInfo dictionaries
        """
        workspace = self.get_project_workspace(project_id)

        if not workspace.exists():
            raise ValueError("Project workspace does not exist")

        target_path = self.validate_path(workspace, relative_path)

        if not target_path.exists():
            raise ValueError("Path does not exist")

        if not target_path.is_dir():
            raise ValueError("Path is not a directory")

        files = []
        for item in sorted(target_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            # Skip hidden files and venv directory
            if item.name.startswith('.') or item.name == 'venv' or item.name == '__pycache__':
                continue

            rel_path = str(item.relative_to(workspace))
            is_dir = item.is_dir()

            file_info = {
                "name": item.name,
                "path": rel_path,
                "is_directory": is_dir,
                "size": item.stat().st_size if not is_dir else None,
                "extension": item.suffix[1:] if item.suffix and not is_dir else None
            }
            files.append(file_info)

        return files

    def get_file_content(self, project_id: int, relative_path: str) -> str:
        """
        Read and return file content.

        Args:
            project_id: Project ID
            relative_path: Relative path to file

        Returns:
            File content as string
        """
        workspace = self.get_project_workspace(project_id)

        if not workspace.exists():
            raise ValueError("Project workspace does not exist")

        file_path = self.validate_path(workspace, relative_path)

        if not file_path.exists():
            raise ValueError("File does not exist")

        if file_path.is_dir():
            raise ValueError("Path is a directory, not a file")

        # Limit file size to 1MB
        if file_path.stat().st_size > 1024 * 1024:
            raise ValueError("File is too large (max 1MB)")

        # Read file with error handling for binary files
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read()
        except UnicodeDecodeError:
            raise ValueError("Cannot read binary file as text")

    def get_file_path(self, project_id: int, relative_path: str) -> Path:
        """
        Get the absolute path to a file for download.

        Args:
            project_id: Project ID
            relative_path: Relative path to file

        Returns:
            Absolute file path
        """
        workspace = self.get_project_workspace(project_id)

        if not workspace.exists():
            raise ValueError("Project workspace does not exist")

        file_path = self.validate_path(workspace, relative_path)

        if not file_path.exists():
            raise ValueError("File does not exist")

        if file_path.is_dir():
            raise ValueError("Path is a directory, use download-zip for folders")

        return file_path

    def create_zip_archive(self, project_id: int, relative_path: str = "") -> Path:
        """
        Create a ZIP archive of a folder.

        Args:
            project_id: Project ID
            relative_path: Relative path to folder (empty for entire project)

        Returns:
            Path to temporary ZIP file
        """
        workspace = self.get_project_workspace(project_id)

        if not workspace.exists():
            raise ValueError("Project workspace does not exist")

        target_path = self.validate_path(workspace, relative_path)

        if not target_path.exists():
            raise ValueError("Path does not exist")

        if not target_path.is_dir():
            raise ValueError("Path is not a directory")

        # Create temporary file for ZIP
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        temp_path = Path(temp_file.name)
        temp_file.close()

        # Create ZIP archive
        with zipfile.ZipFile(temp_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for file_path in target_path.rglob("*"):
                # Skip hidden files, venv, and __pycache__
                rel_parts = file_path.relative_to(target_path).parts
                if any(part.startswith('.') or part == 'venv' or part == '__pycache__' for part in rel_parts):
                    continue

                if file_path.is_file():
                    arcname = file_path.relative_to(target_path)
                    zf.write(file_path, arcname)

        return temp_path

    # =========================================================================
    # GENERAL TERMINAL METHODS
    # =========================================================================

    def create_terminal_session(self) -> int:
        """
        Create a new terminal session.

        Returns:
            Session ID
        """
        self._terminal_session_counter += 1
        return self._terminal_session_counter

    def subscribe_to_terminal(self, session_id: int) -> asyncio.Queue:
        """
        Subscribe to terminal output for a session.

        Returns an asyncio.Queue that will receive output lines.
        """
        queue = asyncio.Queue()
        self.terminal_queues[session_id].append(queue)
        return queue

    def unsubscribe_from_terminal(self, session_id: int, queue: asyncio.Queue) -> None:
        """Remove a queue from the terminal subscribers."""
        if session_id in self.terminal_queues:
            try:
                self.terminal_queues[session_id].remove(queue)
            except ValueError:
                pass

            # Clean up empty lists
            if not self.terminal_queues[session_id]:
                del self.terminal_queues[session_id]

    async def execute_terminal_command(
        self,
        session_id: int,
        command: str
    ) -> None:
        """
        Execute a command in the general terminal workspace.

        Args:
            session_id: Terminal session ID
            command: Command to execute
        """
        # Environment variables
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["FORCE_COLOR"] = "1"

        try:
            # Broadcast the command being executed
            cmd_msg = f"$ {command}\n"
            for queue in self.terminal_queues[session_id]:
                await queue.put({"type": "output", "data": cmd_msg})

            # Create subprocess
            process = await asyncio.create_subprocess_shell(
                command,
                cwd=self.terminal_workspace,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                start_new_session=True
            )

            # Process stdout and stderr concurrently
            async def read_stream(stream, is_stderr=False):
                """Read stream line by line and broadcast to queues."""
                while True:
                    line = await stream.readline()
                    if not line:
                        break

                    decoded_line = line.decode("utf-8", errors="replace")
                    prefix = "[stderr] " if is_stderr else ""
                    formatted_line = f"{prefix}{decoded_line}"

                    # Broadcast to all connected queues
                    for queue in self.terminal_queues[session_id]:
                        await queue.put({"type": "output", "data": formatted_line})

            # Run both stream readers concurrently
            await asyncio.gather(
                read_stream(process.stdout),
                read_stream(process.stderr, is_stderr=True)
            )

            # Wait for process to complete
            return_code = await process.wait()

            # Send exit message
            for queue in self.terminal_queues[session_id]:
                await queue.put({"type": "exit", "code": return_code})

        except Exception as e:
            error_msg = f"[ERROR] {str(e)}\n"
            for queue in self.terminal_queues[session_id]:
                await queue.put({"type": "error", "data": error_msg})


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
