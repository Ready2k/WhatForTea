"""
APScheduler setup — embedded in the FastAPI process (no Celery needed).

Jobs:
  - daily_decay   : 03:00 every day — recalculates pantry confidence values
  - llm_output_cleanup : 04:00 every day — deletes expired llm_outputs rows

The scheduler is started/stopped in main.py's lifespan context manager.
"""
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)


async def _daily_decay_job() -> None:
    """APScheduler entry point for confidence decay. Creates its own DB session."""
    from app.database import AsyncSessionLocal
    from app.services.pantry import apply_decay_all

    async with AsyncSessionLocal() as db:
        updated = await apply_decay_all(db)
    logger.info("scheduled decay complete", extra={"items_updated": updated})


async def _llm_output_cleanup_job() -> None:
    """Delete expired llm_outputs rows (expires_at < now)."""
    from sqlalchemy import delete, func
    from app.database import AsyncSessionLocal
    from app.models.ingest import LlmOutput

    async with AsyncSessionLocal() as db:
        stmt = delete(LlmOutput).where(LlmOutput.expires_at < func.now())
        result = await db.execute(stmt)
        await db.commit()
    logger.info(
        "llm_output cleanup complete",
        extra={"deleted": result.rowcount},
    )


def create_scheduler() -> AsyncIOScheduler:
    """Build and configure the APScheduler instance (does not start it)."""
    scheduler = AsyncIOScheduler()

    scheduler.add_job(
        _daily_decay_job,
        trigger=CronTrigger(hour=3, minute=0),
        id="daily_decay",
        name="Pantry confidence decay",
        replace_existing=True,
        misfire_grace_time=3600,  # run up to 1 hour late if the process was down
    )

    scheduler.add_job(
        _llm_output_cleanup_job,
        trigger=CronTrigger(hour=4, minute=0),
        id="llm_output_cleanup",
        name="LLM output expiry cleanup",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    return scheduler
