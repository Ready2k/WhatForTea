import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import settings
from app.errors import register_exception_handlers
from app.logging_config import setup_logging
from app.api.v1.health import router as health_router

setup_logging(settings.log_level)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("WhatsForTea API starting", extra={"version": app.version})
    yield
    logger.info("WhatsForTea API shutting down")


app = FastAPI(
    title="WhatsForTea API",
    version="0.1.0",
    lifespan=lifespan,
    # Disable the built-in /docs in production if needed; keep on for dev
    docs_url="/docs",
    redoc_url="/redoc",
)

register_exception_handlers(app)

# Routes — all API endpoints are under /api/v1/
app.include_router(health_router, tags=["health"])
