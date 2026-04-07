import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator

from app.config import settings
from app.errors import register_exception_handlers
from app.logging_config import setup_logging
from app.api.v1.auth import router as auth_router
from app.api.v1.chat import router as chat_router
from app.api.v1.cooking import router as cooking_router
from app.api.v1.health import router as health_router
from app.api.v1.ingredients import router as ingredients_router
from app.api.v1.matcher import router as matcher_router
from app.api.v1.pantry import router as pantry_router
from app.api.v1.planner import router as planner_router
from app.api.v1.recipes import router as recipes_router
from app.api.v1.barcode import router as barcode_router
from app.api.v1.collections import router as collections_router
from app.api.v1.users import router as users_router
from app.api.v1.voice import router as voice_router
from app.middleware.auth import AuthMiddleware
from app.middleware.logging import RequestLoggingMiddleware
from app.services.scheduler import create_scheduler

setup_logging(settings.log_level)
logger = logging.getLogger(__name__)


async def _seed_default_user() -> None:
    """
    On first startup, if the users table is empty and env credentials are set,
    create a default household + admin user so the legacy env-based login is
    seamlessly migrated to the new multi-user system.
    """
    from sqlalchemy import text
    from app.database import AsyncSessionLocal
    from app.models.user import Household, User
    import secrets
    if not settings.household_username or not settings.household_password_hash:
        return

    async with AsyncSessionLocal() as db:
        count = (await db.execute(text("SELECT COUNT(*) FROM users"))).scalar()
        if count and count > 0:
            return

        household = Household(
            name="Home",
            invite_code=secrets.token_urlsafe(12),
        )
        db.add(household)
        await db.flush()

        admin = User(
            household_id=household.id,
            username=settings.household_username,
            display_name=settings.household_username.capitalize(),
            password_hash=settings.household_password_hash,
            is_admin=True,
        )
        db.add(admin)
        await db.commit()
        logger.info("Default admin user seeded", extra={"username": settings.household_username})


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("WhatsForTea API starting", extra={"version": app.version})

    try:
        await _seed_default_user()
    except Exception as exc:
        logger.warning("Default user seed skipped", extra={"reason": str(exc)})

    scheduler = create_scheduler()
    scheduler.start()
    logger.info("APScheduler started", extra={"jobs": [j.id for j in scheduler.get_jobs()]})

    yield

    scheduler.shutdown(wait=False)
    logger.info("WhatsForTea API shutting down")


app = FastAPI(
    title="WhatsForTea API",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    redirect_slashes=False,
)

register_exception_handlers(app)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(AuthMiddleware)

# Prometheus metrics at GET /metrics (exempt from auth middleware — scraped internally)
Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)

app.include_router(auth_router)
app.include_router(chat_router)
app.include_router(health_router, tags=["health"])
app.include_router(cooking_router)
app.include_router(ingredients_router)
app.include_router(pantry_router)
app.include_router(planner_router)
# matcher_router must come before recipes_router: /recipes/match before /recipes/{id}
app.include_router(matcher_router)
app.include_router(recipes_router)
app.include_router(barcode_router)
app.include_router(collections_router)
app.include_router(users_router)
app.include_router(voice_router)
