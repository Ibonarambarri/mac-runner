"""
MacRunner - Task Scheduler
APScheduler integration for cron-based recurring tasks.
"""

import asyncio
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.jobstores.memory import MemoryJobStore
from sqlmodel import Session, select

from .models import ScheduledTask, Project, Job, JobStatus
from .database import engine


# Global scheduler instance
_scheduler: Optional[AsyncIOScheduler] = None
_process_manager = None


def get_scheduler() -> AsyncIOScheduler:
    """Get the global scheduler instance."""
    global _scheduler
    if _scheduler is None:
        raise RuntimeError("Scheduler not initialized. Call init_scheduler() first.")
    return _scheduler


def init_scheduler(process_manager) -> AsyncIOScheduler:
    """
    Initialize the APScheduler with AsyncIO support.

    Args:
        process_manager: The ProcessManager instance for running jobs

    Returns:
        The initialized scheduler
    """
    global _scheduler, _process_manager

    _process_manager = process_manager

    # Configure job stores
    jobstores = {
        'default': MemoryJobStore()
    }

    # Create scheduler
    _scheduler = AsyncIOScheduler(
        jobstores=jobstores,
        timezone='UTC'
    )

    return _scheduler


def start_scheduler():
    """Start the scheduler and load all enabled tasks from database."""
    global _scheduler

    if _scheduler is None:
        raise RuntimeError("Scheduler not initialized")

    # Load all enabled scheduled tasks from database
    with Session(engine) as session:
        statement = select(ScheduledTask).where(ScheduledTask.enabled == True)
        tasks = session.exec(statement).all()

        for task in tasks:
            try:
                add_scheduled_job(task)
                print(f"[INFO] Loaded scheduled task: {task.name} (cron: {task.cron_expression})")
            except Exception as e:
                print(f"[WARN] Failed to load task {task.name}: {e}")

    _scheduler.start()
    print(f"[INFO] Scheduler started with {len(_scheduler.get_jobs())} jobs")


def shutdown_scheduler():
    """Gracefully shutdown the scheduler."""
    global _scheduler

    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        print("[INFO] Scheduler stopped")


async def execute_scheduled_task(task_id: int):
    """
    Execute a scheduled task by creating a new job.

    This is called by APScheduler when a cron trigger fires.
    """
    global _process_manager

    if _process_manager is None:
        print(f"[WARN] ProcessManager not available, skipping task {task_id}")
        return

    # Extract IDs and command within session scope, then run in background
    project_id = None
    job_id = None
    command = None
    task_name = None
    project_name = None

    with Session(engine) as session:
        # Get the scheduled task
        task = session.get(ScheduledTask, task_id)
        if not task or not task.enabled:
            return

        # Get the project
        project = session.get(Project, task.project_id)
        if not project:
            print(f"[WARN] Project {task.project_id} not found for task {task_id}")
            return

        # Store values for background task
        project_id = project.id
        command = task.command
        task_name = task.name
        project_name = project.name

        # Create a new job
        job = Job(
            project_id=project.id,
            status=JobStatus.PENDING,
            command_name=f"[Scheduled] {task.name}",
            command_executed=task.command
        )
        session.add(job)
        session.commit()
        session.refresh(job)

        job_id = job.id

        # Update task's last_run and last_job_id
        task.last_run = datetime.now(timezone.utc)
        task.last_job_id = job.id

        # Calculate next run time
        scheduler = get_scheduler()
        apscheduler_job = scheduler.get_job(f"task_{task_id}")
        if apscheduler_job:
            task.next_run = apscheduler_job.next_run_time

        session.add(task)
        session.commit()

    print(f"[Scheduler] Running task '{task_name}' for project {project_name}")

    # Execute the command in a background task with its own session
    asyncio.create_task(
        _run_job_background(project_id, job_id, command)
    )


async def _run_job_background(project_id: int, job_id: int, command: str):
    """
    Background task runner that creates its own database session.

    This avoids session lifecycle issues when running async tasks from the scheduler.

    Args:
        project_id: ID of the project to run the command in
        job_id: ID of the job to update
        command: The command string to execute
    """
    global _process_manager

    if _process_manager is None:
        print(f"[ERROR] ProcessManager not available for job {job_id}")
        return

    with Session(engine) as session:
        project = session.get(Project, project_id)
        job = session.get(Job, job_id)

        if not project or not job:
            print(f"[ERROR] Project or Job not found for scheduled task (project={project_id}, job={job_id})")
            return

        await _process_manager.run_command(project, job, command, session)


def add_scheduled_job(task: ScheduledTask) -> bool:
    """
    Add a scheduled task to APScheduler.

    Args:
        task: The ScheduledTask to add

    Returns:
        True if successful, False otherwise
    """
    global _scheduler

    if _scheduler is None:
        return False

    try:
        # Parse cron expression
        # Format: minute hour day month day_of_week
        parts = task.cron_expression.strip().split()

        if len(parts) == 5:
            trigger = CronTrigger(
                minute=parts[0],
                hour=parts[1],
                day=parts[2],
                month=parts[3],
                day_of_week=parts[4]
            )
        else:
            raise ValueError(f"Invalid cron expression: {task.cron_expression}")

        # Add job to scheduler
        job = _scheduler.add_job(
            execute_scheduled_task,
            trigger=trigger,
            args=[task.id],
            id=f"task_{task.id}",
            name=task.name,
            replace_existing=True
        )

        # Update next_run in database
        with Session(engine) as session:
            db_task = session.get(ScheduledTask, task.id)
            if db_task and job.next_run_time:
                db_task.next_run = job.next_run_time
                session.add(db_task)
                session.commit()

        return True

    except Exception as e:
        print(f"Error adding scheduled job {task.id}: {e}")
        return False


def remove_scheduled_job(task_id: int) -> bool:
    """
    Remove a scheduled task from APScheduler.

    Args:
        task_id: ID of the task to remove

    Returns:
        True if successful, False otherwise
    """
    global _scheduler

    if _scheduler is None:
        return False

    try:
        _scheduler.remove_job(f"task_{task_id}")
        return True
    except Exception:
        return False


def update_scheduled_job(task: ScheduledTask) -> bool:
    """
    Update a scheduled task in APScheduler.

    Removes the old job and adds the updated one.

    Args:
        task: The updated ScheduledTask

    Returns:
        True if successful, False otherwise
    """
    remove_scheduled_job(task.id)

    if task.enabled:
        return add_scheduled_job(task)
    return True


def get_scheduler_status() -> Dict[str, Any]:
    """
    Get the current scheduler status.

    Returns:
        Dictionary with scheduler status information
    """
    global _scheduler

    if _scheduler is None:
        return {"running": False, "jobs": 0}

    jobs = _scheduler.get_jobs()

    return {
        "running": _scheduler.running,
        "jobs": len(jobs),
        "job_list": [
            {
                "id": job.id,
                "name": job.name,
                "next_run": job.next_run_time.isoformat() if job.next_run_time else None
            }
            for job in jobs
        ]
    }


# Common cron presets for the frontend
CRON_PRESETS = {
    "every_hour": {
        "label": "Every hour",
        "cron": "0 * * * *",
        "description": "Runs at the start of every hour"
    },
    "every_6_hours": {
        "label": "Every 6 hours",
        "cron": "0 */6 * * *",
        "description": "Runs every 6 hours"
    },
    "daily_9am": {
        "label": "Daily at 9:00 AM",
        "cron": "0 9 * * *",
        "description": "Runs every day at 9:00 AM UTC"
    },
    "daily_midnight": {
        "label": "Daily at midnight",
        "cron": "0 0 * * *",
        "description": "Runs every day at midnight UTC"
    },
    "weekly_monday": {
        "label": "Weekly on Monday",
        "cron": "0 9 * * 1",
        "description": "Runs every Monday at 9:00 AM UTC"
    },
    "every_30_min": {
        "label": "Every 30 minutes",
        "cron": "*/30 * * * *",
        "description": "Runs every 30 minutes"
    }
}
