"""
JWT authentication middleware.

Checks the `whatsfortea_access` httpOnly cookie on every request except:
  - GET /health
  - POST /api/auth/login
  - POST /api/auth/refresh

Returns 401 if missing or invalid.
"""
from fastapi import Request
from fastapi.responses import JSONResponse
from jose import jwt, JWTError
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.api.v1.auth import ACCESS_COOKIE, ALGORITHM

_SKIP_PATHS = {
    "/health",
    "/metrics",
    "/api/auth/login",
    "/api/auth/refresh",
    "/docs",
    "/redoc",
    "/openapi.json",
}


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path in _SKIP_PATHS:
            return await call_next(request)

        token = request.cookies.get(ACCESS_COOKIE)
        if not token:
            return JSONResponse(
                status_code=401,
                content={"error": {"code": "UNAUTHORIZED", "message": "Authentication required", "details": {}}},
            )

        try:
            payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
            request.state.user_id = payload.get("sub")
            request.state.household_id = payload.get("household_id", "household")
        except JWTError:
            return JSONResponse(
                status_code=401,
                content={"error": {"code": "TOKEN_EXPIRED", "message": "Token expired or invalid", "details": {}}},
            )

        return await call_next(request)
