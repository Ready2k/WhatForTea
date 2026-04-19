"""
Request logging middleware.

Emits one structured JSON log line per request:
  { "route": "GET /api/v1/recipes/", "status": 200, "duration_ms": 42 }
"""
import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request

logger = logging.getLogger("whatsfortea.access")

# Paths too noisy to log (health polling, metrics scraping)
_SILENT_PATHS = {"/health", "/metrics"}


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.monotonic()
        response = await call_next(request)
        duration_ms = round((time.monotonic() - start) * 1000)

        if request.url.path not in _SILENT_PATHS:
            user_id = getattr(request.state, "user_id", None)
            extra: dict = {
                "route": f"{request.method} {request.url.path}",
                "status": response.status_code,
                "duration_ms": duration_ms,
            }
            if user_id:
                extra["user_id"] = str(user_id)
            level = logging.WARNING if response.status_code >= 400 else logging.INFO
            logger.log(level, "request", extra=extra)

        return response
