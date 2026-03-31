import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import settings
from app.errors import register_exception_handlers
from app.logging_config import setup_logging
from app.api.v1.auth import router as auth_router
from app.api.v1.health import router as health_router
from app.api.v1.ingredients import router as ingredients_router
from app.api.v1.matcher import router as matcher_router
from app.api.v1.pantry import router as pantry_router
from app.api.v1.planner import router as planner_router
from app.api.v1.recipes import router as recipes_router
from app.middleware.auth import AuthMiddleware
from app.services.scheduler import create_scheduler

setup_logging(settings.log_level)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("WhatsForTea API starting", extra={"version": app.version})

    scheduler = create_scheduler()
    scheduler.start()
    logger.info("APScheduler started", extra={"jobs": [j.id for j in scheduler.get_jobs()]})

    yield

    scheduler.shutdown(wait=False)
    logger.info("WhatsForTea API shutting down")


app = FastAPI(
    title="WhatsForTea API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

register_exception_handlers(app)
app.add_middleware(AuthMiddleware)

app.include_router(auth_router)
app.include_router(health_router, tags=["health"])
app.include_router(ingredients_router)
app.include_router(pantry_router)
app.include_router(planner_router)
# matcher_router must come before recipes_router: /recipes/match before /recipes/{id}
app.include_router(matcher_router)
app.include_router(recipes_router)
