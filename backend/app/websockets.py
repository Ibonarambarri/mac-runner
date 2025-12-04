"""
MacRunner - WebSocket Handlers
Real-time log streaming and status updates via WebSockets.
"""

import asyncio
import json
from typing import List, Set
from fastapi import WebSocket, WebSocketDisconnect
from sqlmodel import Session, select

from .models import Job, JobStatus, Project
from .manager import get_process_manager
from .database import engine


# Global status WebSocket connections
status_connections: Set[WebSocket] = set()


async def broadcast_status_update(event_type: str, data: dict):
    """
    Broadcast a status update to all connected status WebSocket clients.

    Args:
        event_type: Type of event (job_started, job_stopped, job_completed, job_failed, project_updated)
        data: Event data to send
    """
    if not status_connections:
        return

    message = {
        "type": event_type,
        "data": data
    }

    # Send to all connected clients
    disconnected = []
    for ws in status_connections:
        try:
            await ws.send_json(message)
        except Exception:
            disconnected.append(ws)

    # Clean up disconnected clients
    for ws in disconnected:
        status_connections.discard(ws)


async def handle_status_websocket(websocket: WebSocket):
    """
    WebSocket handler for global status updates.

    Clients connect here to receive real-time notifications when:
    - Jobs start/stop/complete/fail
    - Project status changes
    - New projects are created

    This eliminates the need for polling /projects every 3 seconds.
    """
    await websocket.accept()
    status_connections.add(websocket)

    try:
        # Send initial state
        with Session(engine) as session:
            projects = session.exec(select(Project)).all()
            await websocket.send_json({
                "type": "initial_state",
                "data": {
                    "projects": [
                        {
                            "id": p.id,
                            "name": p.name,
                            "status": p.status.value
                        }
                        for p in projects
                    ]
                }
            })

        # Keep connection alive and handle incoming messages
        while True:
            try:
                # Wait for messages (primarily for keep-alive)
                data = await asyncio.wait_for(websocket.receive_json(), timeout=30.0)
                # Handle ping/pong
                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                # Send periodic ping to keep connection alive
                try:
                    await websocket.send_json({"type": "ping"})
                except:
                    break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Status WebSocket error: {e}")
    finally:
        status_connections.discard(websocket)


async def stream_logs(websocket: WebSocket, job_id: int):
    """
    WebSocket handler for streaming job logs in real-time.

    Flow:
    1. Send existing logs from file (if any)
    2. Subscribe to live log queue
    3. Stream new lines as they arrive
    4. Handle disconnection gracefully

    Args:
        websocket: FastAPI WebSocket connection
        job_id: ID of the job to stream logs for
    """
    await websocket.accept()

    manager = get_process_manager()
    queue = None

    # First, check if job exists
    with Session(engine) as session:
        job = session.get(Job, job_id)
        if not job:
            await websocket.send_json({
                "type": "error",
                "message": f"Job {job_id} not found"
            })
            await websocket.close()
            return

        job_status = job.status

    # Send existing logs from file
    try:
        async for line in manager.get_existing_logs(job_id):
            await websocket.send_json({
                "type": "log",
                "data": line
            })
    except Exception as e:
        print(f"Error reading existing logs: {e}")

    # If job is already finished, close connection
    if job_status in [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.STOPPED]:
        await websocket.send_json({
            "type": "end",
            "message": f"Job finished with status: {job_status.value}"
        })
        await websocket.close()
        return

    # Subscribe to live logs
    queue = manager.subscribe_to_logs(job_id)

    # Re-check job status after subscribing to avoid race condition
    with Session(engine) as session:
        job = session.get(Job, job_id)
        if job and job.status in [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.STOPPED]:
            manager.unsubscribe_from_logs(job_id, queue)
            await websocket.send_json({
                "type": "end",
                "message": f"Job finished with status: {job.status.value}"
            })
            await websocket.close()
            return

    try:
        while True:
            # Wait for new log line with timeout to periodically check job status
            try:
                line = await asyncio.wait_for(queue.get(), timeout=5.0)
            except asyncio.TimeoutError:
                # Check if job finished while waiting
                with Session(engine) as session:
                    job = session.get(Job, job_id)
                    if job and job.status in [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.STOPPED]:
                        await websocket.send_json({
                            "type": "end",
                            "message": f"Job finished with status: {job.status.value}"
                        })
                        break
                continue

            if line is None:
                # End of stream signal
                await websocket.send_json({
                    "type": "end",
                    "message": "Process completed"
                })
                break

            await websocket.send_json({
                "type": "log",
                "data": line
            })

    except WebSocketDisconnect:
        print(f"WebSocket disconnected for job {job_id}")
    except Exception as e:
        print(f"WebSocket error for job {job_id}: {e}")
    finally:
        if queue:
            manager.unsubscribe_from_logs(job_id, queue)
        try:
            await websocket.close()
        except:
            pass


async def handle_terminal(websocket: WebSocket, session_id: int):
    """
    WebSocket handler for interactive PTY terminal.

    Protocol (binary mode for raw terminal I/O):
    - Client sends binary: Raw terminal input (keystrokes)
    - Client sends JSON: {"type": "resize", "cols": 80, "rows": 24}
    - Server sends binary: Raw terminal output (including ANSI escape codes)

    Args:
        websocket: FastAPI WebSocket connection
        session_id: Terminal session ID
    """
    await websocket.accept()

    manager = get_process_manager()
    pty_session = manager.get_pty_session(session_id)

    if not pty_session or not pty_session.is_alive():
        await websocket.send_bytes(b"Error: PTY session not found or not alive\r\n")
        await websocket.close()
        return

    queue = manager.subscribe_to_terminal(session_id)
    reader_task = None

    # Task to read from PTY and send to WebSocket
    async def read_pty_output():
        """Read PTY output using event loop and send to WebSocket."""
        loop = asyncio.get_event_loop()

        while not pty_session.closed:
            try:
                # Use loop.run_in_executor to read in a thread-safe way
                data = await loop.run_in_executor(
                    None,
                    lambda: pty_session.read(4096)
                )

                if data:
                    # Send raw bytes to WebSocket
                    await websocket.send_bytes(data)
                    # Also broadcast to queue for other listeners
                    await pty_session.broadcast(data)
                else:
                    # No data available, small delay
                    await asyncio.sleep(0.01)

            except asyncio.CancelledError:
                break
            except Exception as e:
                if not pty_session.closed:
                    print(f"PTY read error: {e}")
                break

    # Start the PTY reader task
    reader_task = asyncio.create_task(read_pty_output())

    try:
        while True:
            # Receive message from client (can be binary or text)
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                break

            if "bytes" in message:
                # Binary data - raw terminal input
                data = message["bytes"]
                pty_session.write(data)

            elif "text" in message:
                # JSON message - likely resize or other control
                try:
                    data = json.loads(message["text"])

                    if data.get("type") == "resize":
                        cols = data.get("cols", 80)
                        rows = data.get("rows", 24)
                        manager.resize_terminal(session_id, cols, rows)

                    elif data.get("type") == "input":
                        # Legacy text input support
                        text = data.get("data", "")
                        if text:
                            pty_session.write(text.encode("utf-8"))

                except json.JSONDecodeError:
                    # Treat as raw text input
                    pty_session.write(message["text"].encode("utf-8"))

    except WebSocketDisconnect:
        print(f"Terminal WebSocket disconnected for session {session_id}")
    except Exception as e:
        print(f"Terminal WebSocket error for session {session_id}: {e}")
    finally:
        if reader_task:
            reader_task.cancel()
            try:
                await reader_task
            except asyncio.CancelledError:
                pass

        manager.unsubscribe_from_terminal(session_id, queue)
        # Close the PTY session when WebSocket disconnects
        manager.close_terminal_session(session_id)

        try:
            await websocket.close()
        except:
            pass
