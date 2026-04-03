"""
Authentication endpoints.

POST /api/auth/login   — verify credentials against users table, set httpOnly cookies
POST /api/auth/refresh — rotate access token using refresh cookie
POST /api/auth/logout  — clear cookies
GET  /api/auth/me      — current user profile (requires valid access token)
"""
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import APIRouter, Depends, Request, Response
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.errors import AppError, ErrorCode
from app.schemas.user import UserProfile

_ph = PasswordHasher()

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ── Token config ──────────────────────────────────────────────────────────────

ACCESS_TTL_MINUTES = 15
REFRESH_TTL_DAYS = 7
ALGORITHM = "HS256"

ACCESS_COOKIE = "whatsfortea_access"
REFRESH_COOKIE = "whatsfortea_refresh"


def _make_token(user_id: str, household_id: str, expires_delta: timedelta) -> str:
    payload = {
        "sub": user_id,
        "household_id": household_id,
        "exp": datetime.now(timezone.utc) + expires_delta,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def _set_access_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=ACCESS_COOKIE,
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        max_age=ACCESS_TTL_MINUTES * 60,
        path="/",
    )


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        max_age=REFRESH_TTL_DAYS * 86400,
        path="/api/auth/refresh",
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(body: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    from app.models.user import User

    stmt = select(User).where(User.username == body.username)
    user = (await db.execute(stmt)).scalar_one_or_none()

    valid = False
    if user:
        try:
            valid = _ph.verify(user.password_hash, body.password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            valid = False
    else:
        # Backwards-compatible fallback: allow legacy env-based credentials
        # (used during migration period before any user records exist)
        if (
            body.username == settings.household_username
            and settings.household_password_hash
        ):
            try:
                valid = _ph.verify(settings.household_password_hash, body.password)
            except (VerifyMismatchError, VerificationError, InvalidHashError):
                valid = False

    if not valid:
        raise AppError(ErrorCode.UNAUTHORIZED, "Invalid credentials", status_code=401)

    if user:
        user_id = str(user.id)
        household_id = str(user.household_id)
    else:
        # Fallback: synthetic IDs for env-only mode
        user_id = "household"
        household_id = "household"

    access = _make_token(user_id, household_id, timedelta(minutes=ACCESS_TTL_MINUTES))
    refresh = _make_token(user_id, household_id, timedelta(days=REFRESH_TTL_DAYS))
    _set_access_cookie(response, access)
    _set_refresh_cookie(response, refresh)
    return {"ok": True, "user_id": user_id}


@router.post("/refresh")
async def refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise AppError(ErrorCode.UNAUTHORIZED, "No refresh token", status_code=401)
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        household_id = payload.get("household_id", "household")
    except JWTError:
        raise AppError(ErrorCode.TOKEN_EXPIRED, "Refresh token invalid or expired", status_code=401)

    # If we have a real user UUID, verify it still exists
    if user_id and user_id != "household":
        from app.models.user import User
        import uuid as _uuid
        try:
            uid = _uuid.UUID(user_id)
            user = await db.get(User, uid)
            if user:
                household_id = str(user.household_id)
        except (ValueError, Exception):
            pass

    new_access = _make_token(user_id, household_id, timedelta(minutes=ACCESS_TTL_MINUTES))
    _set_access_cookie(response, new_access)
    return {"ok": True}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth/refresh")
    return {"ok": True}


@router.get("/me", response_model=UserProfile)
async def get_me(request: Request, db: AsyncSession = Depends(get_db)):
    """Return the current authenticated user's profile."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id or user_id == "household":
        raise AppError(ErrorCode.UNAUTHORIZED, "No user profile in legacy auth mode", status_code=404)

    from app.models.user import User
    import uuid as _uuid

    try:
        uid = _uuid.UUID(user_id)
    except ValueError:
        raise AppError(ErrorCode.UNAUTHORIZED, "Invalid user token", status_code=401)

    user = await db.get(User, uid)
    if user is None:
        raise AppError(ErrorCode.UNAUTHORIZED, "User not found", status_code=404)

    return UserProfile.model_validate(user)
