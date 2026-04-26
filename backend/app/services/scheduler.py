"""
APScheduler setup — embedded in the FastAPI process (no Celery needed).

Jobs:
  - daily_decay        : 03:00 every day — recalculates pantry confidence values
  - llm_output_cleanup : 04:00 every day — deletes expired llm_outputs rows
  - nightly_backup     : 02:00 every day — runs scripts/backup.sh via subprocess

The scheduler is started/stopped in main.py's lifespan context manager.
"""
import asyncio
import logging
import subprocess  # nosec B404 — used only to call a hardcoded version-controlled script
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)

# Backup script is at /app/../scripts/backup.sh inside the container
_BACKUP_SCRIPT = Path(__file__).parent.parent.parent.parent / "scripts" / "backup.sh"


async def _daily_decay_job() -> None:
    """APScheduler entry point for confidence decay. Creates its own DB session."""
    try:
        from app.database import AsyncSessionLocal
        from app.services.pantry import apply_decay_all

        async with AsyncSessionLocal() as db:
            updated = await apply_decay_all(db)
        logger.info("scheduled decay complete", extra={"items_updated": updated})
    except Exception as exc:
        logger.error("daily_decay_job failed", extra={"error": str(exc)}, exc_info=True)


async def _llm_output_cleanup_job() -> None:
    """Delete expired llm_outputs rows (expires_at < now)."""
    try:
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
    except Exception as exc:
        logger.error("llm_output_cleanup_job failed", extra={"error": str(exc)}, exc_info=True)


async def _expiry_check_job() -> None:
    """Log and push-notify expiring pantry items (within 3 days), grouped by household."""
    try:
        from app.database import AsyncSessionLocal
        from app.services.pantry import get_expiring_soon
        from app.services.push import send_to_household

        async with AsyncSessionLocal() as db:
            items = await get_expiring_soon(db, days=3)

        if not items:
            logger.info("expiry check: no items expiring within 3 days")
            return

        names = [
            f"{i.ingredient.canonical_name} (expires {i.expires_at})"
            for i in items
            if i.ingredient
        ]
        logger.warning("pantry items expiring soon", extra={"count": len(items), "items": names})

        # Group by household_id and fire one push per household
        from collections import defaultdict
        by_household: dict = defaultdict(list)
        for item in items:
            if item.ingredient:
                by_household[str(item.household_id)].append(item.ingredient.canonical_name)

        for household_id, ingredient_names in by_household.items():
            if len(ingredient_names) == 1:
                body = f"{ingredient_names[0]} is expiring soon — check your pantry."
            else:
                body = f"{ingredient_names[0]} and {len(ingredient_names) - 1} other item(s) are expiring soon."
            await send_to_household(
                household_id,
                {
                    "title": "Use it up! 🥦",
                    "body": body,
                    "url": "/pantry",
                    "tag": "expiry",
                },
            )
    except Exception as exc:
        logger.error("expiry_check_job failed", extra={"error": str(exc)}, exc_info=True)


async def _empty_plan_check_job() -> None:
    """Monday morning: notify households whose current week plan is empty."""
    try:
        from datetime import date
        from sqlalchemy import select, func
        from app.database import AsyncSessionLocal
        from app.models.plan import MealPlan, MealPlanEntry
        from app.models.user import Household
        from app.services.push import send_to_household

        today = date.today()
        # Monday = 0 in weekday(), only run on Mondays (cron already targets Mon but guard anyway)
        if today.weekday() != 0:
            return

        week_start = today.isoformat()

        async with AsyncSessionLocal() as db:
            all_households = (await db.execute(select(Household.id))).scalars().all()
            for hh_id in all_households:
                plan = await db.execute(
                    select(MealPlan).where(
                        MealPlan.household_id == hh_id,
                        MealPlan.week_start == week_start,
                    )
                )
                meal_plan = plan.scalar_one_or_none()
                has_entries = False
                if meal_plan:
                    count_result = await db.execute(
                        select(func.count()).where(MealPlanEntry.meal_plan_id == meal_plan.id)
                    )
                    has_entries = (count_result.scalar() or 0) > 0

                if not has_entries:
                    await send_to_household(
                        str(hh_id),
                        {
                            "title": "What's for tea this week? 🍽",
                            "body": "Your weekly meal plan is empty — tap to fill it.",
                            "url": "/planner",
                            "tag": "empty-plan",
                        },
                    )
        logger.info("empty plan check complete")
    except Exception as exc:
        logger.error("empty_plan_check_job failed", extra={"error": str(exc)}, exc_info=True)


async def _nightly_backup_job() -> None:
    """Run scripts/backup.sh in a subprocess (non-blocking via thread executor)."""
    if not _BACKUP_SCRIPT.exists():
        logger.warning("backup script not found", extra={"path": str(_BACKUP_SCRIPT)})
        return

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            lambda: subprocess.run(  # nosec B603 B607 — fixed path, no user input
                ["bash", str(_BACKUP_SCRIPT)],
                capture_output=True,
                text=True,
                timeout=300,
            ),
        )
        if result.returncode == 0:
            logger.info("nightly backup complete", extra={"stdout": result.stdout[-500:]})
        else:
            logger.error("nightly backup failed", extra={"stderr": result.stderr[-500:]})
    except Exception as exc:
        logger.error("nightly backup exception", extra={"error": str(exc)})


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

    scheduler.add_job(
        _expiry_check_job,
        trigger=CronTrigger(hour=3, minute=5),
        id="expiry_check",
        name="Pantry expiry check",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    scheduler.add_job(
        _empty_plan_check_job,
        trigger=CronTrigger(day_of_week="mon", hour=8, minute=0),
        id="empty_plan_check",
        name="Monday empty-plan push notification",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    scheduler.add_job(
        _nightly_backup_job,
        trigger=CronTrigger(hour=2, minute=0),
        id="nightly_backup",
        name="Nightly data backup",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    return scheduler
