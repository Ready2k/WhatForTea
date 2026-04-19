from fastapi import APIRouter
from app.config import settings

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    checks: dict[str, str] = {}

    # Database
    try:
        from sqlalchemy import text
        from app.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        checks["db"] = "ok"
    except Exception as exc:
        checks["db"] = f"error: {exc}"

    # Redis
    try:
        from redis.asyncio import Redis
        r = Redis.from_url(settings.redis_url, decode_responses=False, socket_connect_timeout=2)
        try:
            await r.ping()
            checks["redis"] = "ok"
        finally:
            await r.aclose()
    except Exception as exc:
        checks["redis"] = f"error: {exc}"

    degraded = any(v != "ok" for v in checks.values())
    return {
        "status": "degraded" if degraded else "ok",
        "checks": checks,
    }
