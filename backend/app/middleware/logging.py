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
            logger.info(
                "request",
                extra={
                    "route": f"{request.method} {request.url.path}",
                    "status": response.status_code,
                    "duration_ms": duration_ms,
                },
            )

        return response
