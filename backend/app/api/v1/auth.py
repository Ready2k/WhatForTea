"""
Authentication endpoints.

POST /api/auth/login   — verify credentials, set httpOnly cookies
POST /api/auth/refresh — rotate access token using refresh cookie
POST /api/auth/logout  — clear cookies
"""
from datetime import datetime, timedelta, timezone

import bcrypt as _bcrypt
from fastapi import APIRouter, Response, Request
from jose import jwt, JWTError
from pydantic import BaseModel

from app.config import settings
from app.errors import AppError, ErrorCode

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ── Token config ──────────────────────────────────────────────────────────────

ACCESS_TTL_MINUTES = 15
REFRESH_TTL_DAYS = 7
ALGORITHM = "HS256"

ACCESS_COOKIE = "whatsfortea_access"
REFRESH_COOKIE = "whatsfortea_refresh"


def _make_token(sub: str, expires_delta: timedelta) -> str:
    payload = {
        "sub": sub,
        "exp": datetime.now(timezone.utc) + expires_delta,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def _set_access_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=ACCESS_COOKIE,
        value=token,
        httponly=True,
        secure=False,          # set True when behind TLS; local NAS uses plain HTTP
        samesite="strict",
        max_age=ACCESS_TTL_MINUTES * 60,
        path="/",
    )


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=token,
        httponly=True,
        secure=False,
        samesite="strict",
        max_age=REFRESH_TTL_DAYS * 86400,
        path="/api/auth/refresh",  # only sent to the refresh endpoint
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(body: LoginRequest, response: Response):
    valid_username = (body.username == settings.household_username)
    valid_password = (
        bool(settings.household_password_hash)
        and _bcrypt.checkpw(body.password.encode(), settings.household_password_hash.encode())
    )
    if not valid_username or not valid_password:
        raise AppError(ErrorCode.UNAUTHORIZED, "Invalid credentials", status_code=401)

    access = _make_token("household", timedelta(minutes=ACCESS_TTL_MINUTES))
    refresh = _make_token("household", timedelta(days=REFRESH_TTL_DAYS))
    _set_access_cookie(response, access)
    _set_refresh_cookie(response, refresh)
    return {"ok": True}


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise AppError(ErrorCode.UNAUTHORIZED, "No refresh token", status_code=401)
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
        sub = payload.get("sub")
    except JWTError:
        raise AppError(ErrorCode.TOKEN_EXPIRED, "Refresh token invalid or expired", status_code=401)

    new_access = _make_token(sub, timedelta(minutes=ACCESS_TTL_MINUTES))
    _set_access_cookie(response, new_access)
    return {"ok": True}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth/refresh")
    return {"ok": True}
