"""
arq worker — background job processor for WhatsForTea.

Run inside the api container:
  poetry run arq app.worker.WorkerSettings

The worker shares the same codebase as the API but runs as a separate process,
so it creates its own DB engine and Redis client on startup.
"""
import logging
import urllib.parse
import uuid

from arq.connections import RedisSettings
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.logging_config import setup_logging
from app.services.ingestion import _DEFAULT_RECIPES_DIR, run_ingestion
from app.services.nutrition import estimate_nutrition

setup_logging(settings.log_level)
logger = logging.getLogger(__name__)


def _redis_settings_from_url(url: str) -> RedisSettings:
    """Parse a redis:// URL into an arq RedisSettings object."""
    parsed = urllib.parse.urlparse(url)
    return RedisSettings(
        host=parsed.hostname or "localhost",
        port=parsed.port or 6379,
        password=parsed.password,
        database=int(parsed.path.lstrip("/") or "0"),
    )


# ── Lifecycle ─────────────────────────────────────────────────────────────────

async def startup(ctx: dict) -> None:
    engine = create_async_engine(settings.database_url, echo=False)
    ctx["engine"] = engine
    ctx["session_factory"] = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    ctx["redis"] = Redis.from_url(settings.redis_url, decode_responses=False)
    logger.info("arq worker started")


async def shutdown(ctx: dict) -> None:
    await ctx["engine"].dispose()
    await ctx["redis"].aclose()
    logger.info("arq worker stopped")


# ── Tasks ─────────────────────────────────────────────────────────────────────

async def task_process_ingest_job(ctx: dict, job_id: str, kit_brand: str = "auto") -> dict:
    """Process a recipe card ingestion job end-to-end."""
    logger.info("processing ingest job", extra={"job_id": job_id, "kit_brand": kit_brand})
    async with ctx["session_factory"]() as db:
        await run_ingestion(
            job_id=uuid.UUID(job_id),
            db=db,
            redis_client=ctx["redis"],
            recipes_dir=_DEFAULT_RECIPES_DIR,
            kit_brand=kit_brand,
        )
    return {"job_id": job_id}


async def task_estimate_nutrition(ctx: dict, recipe_id: str) -> dict:
    """Estimate and persist macro-nutrients for a recipe."""
    logger.info("estimating nutrition", extra={"recipe_id": recipe_id})
    async with ctx["session_factory"]() as db:
        result = await estimate_nutrition(uuid.UUID(recipe_id), db)
    return {"recipe_id": recipe_id, "success": result is not None}


# ── Worker config ─────────────────────────────────────────────────────────────

class WorkerSettings:
    functions = [task_process_ingest_job, task_estimate_nutrition]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = _redis_settings_from_url(settings.redis_url)
    max_jobs = 2        # process up to 2 cards concurrently
    job_timeout = 120   # seconds before a job is considered hung
