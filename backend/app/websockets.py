"""
MacRunner - WebSocket Handlers
Real-time log streaming via WebSockets.
"""

import asyncio
from fastapi import WebSocket, WebSocketDisconnect
from sqlmodel import Session, select

from .models import Job, JobStatus
from .manager import get_process_manager
from .database import engine


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
