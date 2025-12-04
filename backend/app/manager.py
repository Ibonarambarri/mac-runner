"""
MacRunner - Process Manager
Handles Git cloning, virtual environment setup, and async subprocess execution.

CRITICAL: Uses PYTHONUNBUFFERED=1 to ensure real-time log streaming.
"""

import asyncio
import fcntl
import os
import pty
import re
import signal
import shlex
import shutil
import struct
import termios
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
    Command pass-through for trusted environment.

    SECURITY NOTE: Sanitization disabled for single-user, trusted network deployment.
    This allows complex chained commands (&&, ||, ;), file operations, and
    command substitution needed for ML/DS workflows.

    Original patterns that were blocked:
    - Command chaining with rm (;rm, &&rm, |rm)
    - Backtick command substitution
    - $() command substitution
    """
    # Pass through all commands in trusted environment
    return command


class PTYSession:
    """
    Manages a persistent PTY (pseudo-terminal) session.

    This allows for stateful shell interactions where commands like `cd`
    persist across multiple inputs, and supports interactive programs
    like vim, htop, etc.
    """

    def __init__(self, session_id: int):
        self.session_id = session_id
        self.master_fd: Optional[int] = None
        self.slave_fd: Optional[int] = None
        self.pid: Optional[int] = None
        self.closed = False
        self._output_queues: List[asyncio.Queue] = []
        self._reader_task: Optional[asyncio.Task] = None

    def _detect_shell(self) -> str:
        """Detect available shell, preferring zsh on macOS."""
        for shell in ['/bin/zsh', '/bin/bash', '/bin/sh']:
            if os.path.exists(shell):
                return shell
        return '/bin/sh'

    def start(self) -> bool:
        """
        Start the PTY session by forking a new process.

        Returns:
            True if successful, False otherwise
        """
        if self.master_fd is not None:
            return True  # Already started

        try:
            # Create PTY pair
            self.master_fd, self.slave_fd = pty.openpty()

            # Fork process
            self.pid = os.fork()

            if self.pid == 0:
                # Child process
                os.close(self.master_fd)

                # Create new session and set controlling terminal
                os.setsid()

                # Set slave as controlling terminal
                fcntl.ioctl(self.slave_fd, termios.TIOCSCTTY, 0)

                # Redirect stdio to slave
                os.dup2(self.slave_fd, 0)  # stdin
                os.dup2(self.slave_fd, 1)  # stdout
                os.dup2(self.slave_fd, 2)  # stderr

                if self.slave_fd > 2:
                    os.close(self.slave_fd)

                # Set up environment
                env = os.environ.copy()
                env['TERM'] = 'xterm-256color'
                env['COLORTERM'] = 'truecolor'
                env['LANG'] = 'en_US.UTF-8'

                # Execute shell
                shell = self._detect_shell()
                os.execve(shell, [shell, '-l'], env)

            else:
                # Parent process
                os.close(self.slave_fd)
                self.slave_fd = None

                # Set master to non-blocking
                flags = fcntl.fcntl(self.master_fd, fcntl.F_GETFL)
                fcntl.fcntl(self.master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

                # Set initial size (80x24)
                self.resize(80, 24)

                return True

        except Exception as e:
            print(f"PTY start error: {e}")
            self.close()
            return False

        return False

    def resize(self, cols: int, rows: int) -> bool:
        """
        Resize the PTY window.

        Args:
            cols: Number of columns
            rows: Number of rows

        Returns:
            True if successful
        """
        if self.master_fd is None:
            return False

        try:
            # Pack the window size struct: rows, cols, xpixel, ypixel
            winsize = struct.pack('HHHH', rows, cols, 0, 0)
            fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
            return True
        except Exception as e:
            print(f"PTY resize error: {e}")
            return False

    def write(self, data: bytes) -> bool:
        """
        Write data to the PTY master fd.

        Args:
            data: Raw bytes to write

        Returns:
            True if successful
        """
        if self.master_fd is None or self.closed:
            return False

        try:
            os.write(self.master_fd, data)
            return True
        except Exception as e:
            print(f"PTY write error: {e}")
            return False

    def read(self, size: int = 4096) -> Optional[bytes]:
        """
        Read data from the PTY master fd (non-blocking).

        Args:
            size: Maximum bytes to read

        Returns:
            Bytes read, or None if no data available
        """
        if self.master_fd is None or self.closed:
            return None

        try:
            return os.read(self.master_fd, size)
        except BlockingIOError:
            return None
        except OSError as e:
            if e.errno == 5:  # EIO - child process terminated
                self.closed = True
            return None

    def subscribe(self, queue: asyncio.Queue) -> None:
        """Subscribe a queue to receive output."""
        self._output_queues.append(queue)

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        """Unsubscribe a queue from output."""
        try:
            self._output_queues.remove(queue)
        except ValueError:
            pass

    async def broadcast(self, data: bytes) -> None:
        """Broadcast data to all subscribed queues."""
        for queue in self._output_queues:
            try:
                await queue.put(data)
            except Exception:
                pass

    def close(self) -> None:
        """Close the PTY session and terminate the child process."""
        self.closed = True

        if self._reader_task:
            self._reader_task.cancel()
            self._reader_task = None

        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None

        if self.slave_fd is not None:
            try:
                os.close(self.slave_fd)
            except OSError:
                pass
            self.slave_fd = None

        if self.pid is not None:
            try:
                os.kill(self.pid, signal.SIGTERM)
                # Give it a moment to terminate gracefully
                try:
                    os.waitpid(self.pid, os.WNOHANG)
                except ChildProcessError:
                    pass
            except ProcessLookupError:
                pass
            except Exception:
                pass
            self.pid = None

    def is_alive(self) -> bool:
        """Check if the PTY session is still alive."""
        if self.closed or self.pid is None:
            return False

        try:
            pid, status = os.waitpid(self.pid, os.WNOHANG)
            if pid == self.pid:
                self.closed = True
                return False
            return True
        except ChildProcessError:
            self.closed = True
            return False


class ProcessManager:
    """
    Manages project workspaces, git operations, and subprocess execution.

    Key features:
    - Async subprocess handling with real-time output capture
    - Virtual environment creation and management
    - Log streaming via async generators
    - General terminal for system-wide commands
    - Job concurrency queue (configurable max concurrent jobs)
    """

    def __init__(self, base_path: Path, max_concurrent_jobs: int = 2):
        """
        Initialize the process manager.

        Args:
            base_path: Root directory for workspaces and logs
            max_concurrent_jobs: Maximum number of jobs to run concurrently
        """
        self.workspaces_path = base_path / "workspaces"
        self.logs_path = base_path / "logs"
        self.terminal_workspace = Path("/")  # Start terminal at system root

        # Ensure directories exist
        self.workspaces_path.mkdir(parents=True, exist_ok=True)
        self.logs_path.mkdir(parents=True, exist_ok=True)

        # Track running processes by job_id
        self.running_processes: Dict[int, asyncio.subprocess.Process] = {}

        # Log queues for real-time streaming (job_id -> list of connected queues)
        self.log_queues: Dict[int, list[asyncio.Queue]] = defaultdict(list)

        # Terminal session counter
        self._terminal_session_counter = 0

        # Terminal output queues (session_id -> list of connected queues)
        self.terminal_queues: Dict[int, list[asyncio.Queue]] = defaultdict(list)

        # PTY sessions (session_id -> PTYSession)
        self.pty_sessions: Dict[int, PTYSession] = {}

        # Job concurrency control
        self.max_concurrent_jobs = max_concurrent_jobs
        self._job_semaphore = asyncio.Semaphore(max_concurrent_jobs)
        self._job_queue: List[dict] = []  # Queue of waiting jobs
        self._active_jobs: int = 0

    def get_project_workspace(self, project_id: int) -> Path:
        """Get the workspace directory for a project."""
        return self.workspaces_path / f"project_{project_id}"

    def get_job_log_path(self, job_id: int) -> Path:
        """Get the log file path for a job."""
        return self.logs_path / f"job_{job_id}.log"

    def detect_package_manager(self, workspace: Path) -> dict:
        """
        Detect the package manager based on project files.

        Returns a dict with:
        - type: 'uv', 'conda', 'pip', or 'unknown'
        - install_command: Suggested install command
        - files_found: List of detected config files
        """
        files_found = []

        # Check for various package manager config files
        pyproject = workspace / "pyproject.toml"
        environment_yml = workspace / "environment.yml"
        environment_yaml = workspace / "environment.yaml"
        requirements_txt = workspace / "requirements.txt"
        setup_py = workspace / "setup.py"
        poetry_lock = workspace / "poetry.lock"

        if pyproject.exists():
            files_found.append("pyproject.toml")
            # Check if it's a uv/poetry project
            content = pyproject.read_text()
            if "[tool.poetry]" in content:
                files_found.append("(poetry project)")
                return {
                    "type": "poetry",
                    "install_command": "poetry install",
                    "files_found": files_found
                }
            elif "[project]" in content or "[tool.uv]" in content:
                return {
                    "type": "uv",
                    "install_command": "uv pip install -e .",
                    "files_found": files_found
                }

        if environment_yml.exists() or environment_yaml.exists():
            files_found.append("environment.yml" if environment_yml.exists() else "environment.yaml")
            return {
                "type": "conda",
                "install_command": "conda env update --file environment.yml",
                "files_found": files_found
            }

        if requirements_txt.exists():
            files_found.append("requirements.txt")
            return {
                "type": "pip",
                "install_command": "pip install -r requirements.txt",
                "files_found": files_found
            }

        if setup_py.exists():
            files_found.append("setup.py")
            return {
                "type": "pip",
                "install_command": "pip install -e .",
                "files_found": files_found
            }

        return {
            "type": "unknown",
            "install_command": "pip install -r requirements.txt",
            "files_found": files_found
        }

    async def clone_repository(
        self,
        project: Project,
        session: Session
    ) -> bool:
        """
        Clone a GitHub repository into the project workspace.

        Also detects the package manager and suggests install commands.

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

            # Detect package manager and update install command if still default
            pkg_info = self.detect_package_manager(workspace)
            if pkg_info["type"] != "unknown":
                # Only update if using default command
                if project.install_command == "pip install -r requirements.txt":
                    project.install_command = pkg_info["install_command"]
                    print(f"Detected {pkg_info['type']} project, suggesting: {pkg_info['install_command']}")

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

    def load_env_file(self, workspace: Path) -> dict:
        """
        Load environment variables from a .env file in the workspace.

        Returns a dict of key-value pairs.
        """
        env_path = workspace / ".env"
        env_vars = {}

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
                            key = key.strip()
                            value = value.strip()
                            # Remove quotes if present
                            if (value.startswith('"') and value.endswith('"')) or \
                               (value.startswith("'") and value.endswith("'")):
                                value = value[1:-1]
                            # Unescape quotes
                            value = value.replace('\\"', '"')
                            env_vars[key] = value
            except Exception as e:
                print(f"Warning: Could not load .env file: {e}")

        return env_vars

    def get_queue_status(self) -> dict:
        """
        Get current job queue status.

        Returns:
            Dict with active_jobs, max_concurrent, and queue_length
        """
        return {
            "active_jobs": len(self.running_processes),
            "max_concurrent": self.max_concurrent_jobs,
            "queue_length": len(self._job_queue)
        }

    async def run_command(
        self,
        project: Project,
        job: Job,
        command: str,
        session: Session
    ) -> None:
        """
        Execute any command as an async subprocess with concurrency control.

        This is the generic method used by all command execution (run, install, custom templates).

        CRITICAL IMPLEMENTATION NOTES:
        1. PYTHONUNBUFFERED=1 ensures Python output is not buffered
        2. stdout/stderr are read line-by-line for real-time streaming
        3. Lines are pushed to queues AND written to log file
        4. Environment variables from .env file are loaded automatically
        5. Job concurrency is controlled by semaphore (max N concurrent jobs)

        Args:
            project: Project with workspace configuration
            job: Job to track execution
            command: The command string to execute
            session: Database session
        """
        workspace = Path(project.workspace_path)
        venv_path = workspace / "venv"
        log_path = self.get_job_log_path(job.id)

        # Wait for semaphore slot (limits concurrent jobs)
        queue_position = len(self.running_processes)
        if queue_position >= self.max_concurrent_jobs:
            # Write queued status to log
            with open(log_path, "w") as log_file:
                queue_msg = f"[QUEUED] Job is waiting in queue (position {queue_position - self.max_concurrent_jobs + 1})...\n"
                log_file.write(queue_msg)
                for queue in self.log_queues[job.id]:
                    await queue.put(queue_msg)

        async with self._job_semaphore:
            # Build the activation + command
            # We source the venv and run the command in a single shell
            activate_cmd = f'source "{venv_path}/bin/activate"'
            full_command = f"{activate_cmd} && {command}"

            # Environment variables - CRITICAL for real-time output
            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"  # Force unbuffered Python output
            env["FORCE_COLOR"] = "1"  # Enable colored output if supported

            # Load project-specific environment variables from .env file
            project_env = self.load_env_file(workspace)
            env.update(project_env)

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

                # Open log file for writing (append mode if queued message was written)
                mode = "a" if queue_position >= self.max_concurrent_jobs else "w"
                with open(log_path, mode) as log_file:
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

    async def get_existing_logs(
        self,
        job_id: int,
        max_bytes: int = 50 * 1024,  # 50KB default
        max_lines: int = 1000
    ) -> AsyncGenerator[str, None]:
        """
        Generator that yields existing log lines from file with tail optimization.

        For large log files, only reads the last `max_bytes` or `max_lines`
        to prevent memory issues with huge training logs.

        Args:
            job_id: Job ID to get logs for
            max_bytes: Maximum bytes to read from end of file (default 50KB)
            max_lines: Maximum number of lines to return (default 1000)

        Yields:
            Log lines from the file
        """
        log_path = self.get_job_log_path(job_id)

        if not log_path.exists():
            return

        file_size = log_path.stat().st_size

        # For small files, read everything
        if file_size <= max_bytes:
            with open(log_path, "r") as f:
                for line in f:
                    yield line
            return

        # For large files, read only the tail
        # First, yield a truncation notice
        yield f"[LOG TRUNCATED - Showing last {max_bytes // 1024}KB of {file_size // 1024}KB]\n"
        yield "=" * 50 + "\n"

        with open(log_path, "rb") as f:
            # Seek to position near end of file
            f.seek(-max_bytes, 2)  # 2 = SEEK_END

            # Read to end
            content = f.read().decode("utf-8", errors="replace")

            # Skip partial first line (we likely landed mid-line)
            first_newline = content.find("\n")
            if first_newline != -1:
                content = content[first_newline + 1:]

            # Split into lines and limit
            lines = content.split("\n")
            if len(lines) > max_lines:
                yield f"[... {len(lines) - max_lines} more lines above ...]\n"
                lines = lines[-max_lines:]

            # Yield each line
            for line in lines:
                if line:  # Skip empty lines from split
                    yield line + "\n"

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

    async def run_notebook(
        self,
        project: Project,
        job: Job,
        notebook_path: str,
        parameters: dict,
        session: Session
    ) -> None:
        """
        Execute a Jupyter notebook using Papermill.

        Args:
            project: Project with workspace configuration
            job: Job to track execution
            notebook_path: Relative path to the input notebook
            parameters: Parameters to inject into the notebook
            session: Database session
        """
        workspace = Path(project.workspace_path)
        log_path = self.get_job_log_path(job.id)

        # Input and output notebook paths
        input_nb = workspace / notebook_path
        output_dir = self.logs_path / "notebooks"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_nb = output_dir / f"notebook_output_{job.id}.ipynb"

        # Update job status
        job.status = JobStatus.RUNNING
        job.log_path = str(log_path)
        project.status = ProjectStatus.RUNNING
        session.add(job)
        session.add(project)
        session.commit()

        # Build environment with venv if available
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"

        venv_path = workspace / "venv"
        if venv_path.exists():
            venv_bin = venv_path / "bin"
            env["PATH"] = f"{venv_bin}:{env.get('PATH', '')}"
            env["VIRTUAL_ENV"] = str(venv_path)
            papermill_cmd = str(venv_bin / "papermill")
            # Fall back to system papermill if not in venv
            if not Path(papermill_cmd).exists():
                papermill_cmd = "papermill"
        else:
            papermill_cmd = "papermill"

        # Build command
        cmd = [
            papermill_cmd,
            str(input_nb),
            str(output_nb),
            f"--cwd={workspace}",
            "--progress-bar"
        ]

        # Add parameters if any
        for key, value in parameters.items():
            import json
            cmd.extend(["-p", key, json.dumps(value)])

        try:
            # Open log file for writing
            with open(log_path, "w") as log_file:
                # Write header
                header = f"$ papermill {notebook_path}\n{'='*50}\n"
                header += f"Input:  {input_nb}\n"
                header += f"Output: {output_nb}\n"
                header += f"{'='*50}\n\n"
                log_file.write(header)
                for queue in self.log_queues[job.id]:
                    await queue.put(header)

                # Execute papermill
                process = await asyncio.create_subprocess_exec(
                    *cmd,
                    cwd=workspace,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=env
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
                end_msg = f"\n{'='*50}\n"
                if return_code == 0:
                    end_msg += f"Notebook execution completed successfully!\n"
                    end_msg += f"Output saved to: {output_nb}\n"
                else:
                    end_msg += f"Notebook execution failed with exit code: {return_code}\n"
                log_file.write(end_msg)
                for queue in self.log_queues[job.id]:
                    await queue.put(end_msg)
                    await queue.put(None)  # Signal end of stream

            # Update final status
            job.status = JobStatus.COMPLETED if return_code == 0 else JobStatus.FAILED
            job.end_time = datetime.now(timezone.utc)
            project.status = ProjectStatus.IDLE
            session.add(job)
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
            project.status = ProjectStatus.ERROR
            session.add(job)
            session.add(project)
            session.commit()

        finally:
            # Cleanup
            self.running_processes.pop(job.id, None)

    def validate_path(self, workspace: Path, relative_path: str, allow_external: bool = False) -> Path:
        """
        Validate and resolve a path, optionally allowing access outside workspace.

        SECURITY NOTE: For trusted single-user environment, external path access
        can be enabled to access global datasets, shared models, etc.

        Args:
            workspace: The project workspace root
            relative_path: Relative path from workspace root (or absolute if allow_external)
            allow_external: If True, allows absolute paths and .. navigation outside workspace

        Returns:
            Resolved absolute path

        Raises:
            ValueError: If path doesn't exist (when checking external paths)
        """
        # Handle empty path as workspace root
        if not relative_path or relative_path == ".":
            return workspace

        # Check if it's an absolute path
        if relative_path.startswith('/'):
            if allow_external:
                full_path = Path(relative_path).resolve()
                if not full_path.exists():
                    raise ValueError(f"Path does not exist: {full_path}")
                return full_path
            else:
                # For non-external requests, treat absolute paths as relative to workspace
                relative_path = relative_path.lstrip('/')

        # Resolve the full path
        full_path = (workspace / relative_path).resolve()

        # In trusted mode with allow_external, permit .. navigation
        if allow_external:
            if not full_path.exists():
                raise ValueError(f"Path does not exist: {full_path}")
            return full_path

        # Default: ensure the path is within the workspace
        try:
            full_path.relative_to(workspace.resolve())
        except ValueError:
            raise ValueError("Path is outside workspace (use allow_external=True for external access)")

        return full_path

    def list_directory(self, project_id: int, relative_path: str = "", allow_external: bool = False, show_hidden: bool = False) -> List[dict]:
        """
        List contents of a directory, optionally allowing external paths.

        SECURITY NOTE: For trusted single-user environment, external path access
        allows browsing global datasets, shared models, system directories.

        Args:
            project_id: Project ID
            relative_path: Relative path within workspace (or absolute if allow_external)
            allow_external: If True, allows absolute paths and .. navigation
            show_hidden: If True, shows hidden files (starting with .)

        Returns:
            List of FileInfo dictionaries
        """
        workspace = self.get_project_workspace(project_id)

        if not workspace.exists() and not allow_external:
            raise ValueError("Project workspace does not exist")

        target_path = self.validate_path(workspace, relative_path, allow_external=allow_external)

        if not target_path.exists():
            raise ValueError("Path does not exist")

        if not target_path.is_dir():
            raise ValueError("Path is not a directory")

        files = []
        for item in sorted(target_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            # Skip hidden files unless show_hidden is True
            if not show_hidden and item.name.startswith('.'):
                continue
            # Always skip venv and __pycache__ for cleaner listings
            if item.name == 'venv' or item.name == '__pycache__':
                continue

            # For external paths, use absolute path; otherwise relative to workspace
            if allow_external or not str(target_path).startswith(str(workspace)):
                rel_path = str(item)
            else:
                try:
                    rel_path = str(item.relative_to(workspace))
                except ValueError:
                    rel_path = str(item)

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

    def create_batch_zip_archive(self, project_id: int, relative_paths: List[str]) -> Path:
        """
        Create a ZIP archive containing multiple selected files/folders.

        Args:
            project_id: Project ID
            relative_paths: List of relative paths to include in the ZIP

        Returns:
            Path to temporary ZIP file
        """
        workspace = self.get_project_workspace(project_id)

        if not workspace.exists():
            raise ValueError("Project workspace does not exist")

        if not relative_paths:
            raise ValueError("No paths provided")

        # Create temporary file for ZIP
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        temp_path = Path(temp_file.name)
        temp_file.close()

        # Create ZIP archive
        with zipfile.ZipFile(temp_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for rel_path in relative_paths:
                target_path = self.validate_path(workspace, rel_path)

                if not target_path.exists():
                    continue  # Skip non-existent paths

                if target_path.is_file():
                    # Add single file
                    arcname = target_path.relative_to(workspace)
                    zf.write(target_path, arcname)
                elif target_path.is_dir():
                    # Add directory recursively
                    for file_path in target_path.rglob("*"):
                        # Skip hidden files, venv, and __pycache__
                        rel_parts = file_path.relative_to(target_path).parts
                        if any(part.startswith('.') or part == 'venv' or part == '__pycache__' for part in rel_parts):
                            continue

                        if file_path.is_file():
                            arcname = file_path.relative_to(workspace)
                            zf.write(file_path, arcname)

        return temp_path

    # =========================================================================
    # PTY TERMINAL METHODS (Persistent Shell Sessions)
    # =========================================================================

    def create_terminal_session(self) -> int:
        """
        Create a new PTY terminal session.

        Returns:
            Session ID
        """
        self._terminal_session_counter += 1
        session_id = self._terminal_session_counter

        # Create and start PTY session
        pty_session = PTYSession(session_id)
        if pty_session.start():
            self.pty_sessions[session_id] = pty_session
        else:
            raise RuntimeError("Failed to start PTY session")

        return session_id

    def get_pty_session(self, session_id: int) -> Optional[PTYSession]:
        """Get a PTY session by ID."""
        return self.pty_sessions.get(session_id)

    def subscribe_to_terminal(self, session_id: int) -> asyncio.Queue:
        """
        Subscribe to terminal output for a session.

        Returns an asyncio.Queue that will receive raw bytes.
        """
        queue = asyncio.Queue()
        pty_session = self.pty_sessions.get(session_id)
        if pty_session:
            pty_session.subscribe(queue)
        self.terminal_queues[session_id].append(queue)
        return queue

    def unsubscribe_from_terminal(self, session_id: int, queue: asyncio.Queue) -> None:
        """Remove a queue from the terminal subscribers."""
        pty_session = self.pty_sessions.get(session_id)
        if pty_session:
            pty_session.unsubscribe(queue)

        if session_id in self.terminal_queues:
            try:
                self.terminal_queues[session_id].remove(queue)
            except ValueError:
                pass

            # Clean up empty lists
            if not self.terminal_queues[session_id]:
                del self.terminal_queues[session_id]

    def close_terminal_session(self, session_id: int) -> None:
        """Close a PTY terminal session."""
        pty_session = self.pty_sessions.pop(session_id, None)
        if pty_session:
            pty_session.close()

        # Clean up queues
        if session_id in self.terminal_queues:
            del self.terminal_queues[session_id]

    def write_to_terminal(self, session_id: int, data: bytes) -> bool:
        """
        Write raw bytes to the PTY terminal.

        Args:
            session_id: Terminal session ID
            data: Raw bytes to write

        Returns:
            True if successful
        """
        pty_session = self.pty_sessions.get(session_id)
        if pty_session:
            return pty_session.write(data)
        return False

    def resize_terminal(self, session_id: int, cols: int, rows: int) -> bool:
        """
        Resize the PTY terminal window.

        Args:
            session_id: Terminal session ID
            cols: Number of columns
            rows: Number of rows

        Returns:
            True if successful
        """
        pty_session = self.pty_sessions.get(session_id)
        if pty_session:
            return pty_session.resize(cols, rows)
        return False

    async def execute_terminal_command(
        self,
        session_id: int,
        command: str
    ) -> None:
        """
        Execute a command in the general terminal workspace (legacy method).

        This method is kept for backward compatibility but the PTY-based
        approach should be used instead via write_to_terminal.

        Args:
            session_id: Terminal session ID
            command: Command to execute
        """
        # For backward compatibility, write the command to PTY
        pty_session = self.pty_sessions.get(session_id)
        if pty_session:
            # Add newline to execute command
            pty_session.write((command + '\n').encode('utf-8'))
        else:
            # Fallback to old behavior if no PTY session
            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"
            env["FORCE_COLOR"] = "1"

            try:
                cmd_msg = f"$ {command}\n"
                for queue in self.terminal_queues[session_id]:
                    await queue.put({"type": "output", "data": cmd_msg})

                process = await asyncio.create_subprocess_shell(
                    command,
                    cwd=self.terminal_workspace,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=env,
                    start_new_session=True
                )

                async def read_stream(stream, is_stderr=False):
                    while True:
                        line = await stream.readline()
                        if not line:
                            break
                        decoded_line = line.decode("utf-8", errors="replace")
                        prefix = "[stderr] " if is_stderr else ""
                        formatted_line = f"{prefix}{decoded_line}"
                        for queue in self.terminal_queues[session_id]:
                            await queue.put({"type": "output", "data": formatted_line})

                await asyncio.gather(
                    read_stream(process.stdout),
                    read_stream(process.stderr, is_stderr=True)
                )

                return_code = await process.wait()

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
