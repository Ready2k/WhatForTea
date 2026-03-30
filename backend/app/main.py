import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import settings
from app.errors import register_exception_handlers
from app.logging_config import setup_logging
from app.api.v1.health import router as health_router
from app.api.v1.ingredients import router as ingredients_router

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
    docs_url="/docs",
    redoc_url="/redoc",
)

register_exception_handlers(app)

app.include_router(health_router, tags=["health"])
app.include_router(ingredients_router)
