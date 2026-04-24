"""
Authentication endpoints.

POST /api/auth/login            — verify credentials against users table, set httpOnly cookies
POST /api/auth/refresh          — rotate access token using refresh cookie
POST /api/auth/logout           — clear cookies
GET  /api/auth/me               — current user profile (requires valid access token)
POST /api/auth/forgot-password  — send one-time reset link to user's email
POST /api/auth/reset-password   — consume reset token and set new password
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import logging

from app.config import settings
from app.database import get_db
from app.errors import AppError, ErrorCode

logger = logging.getLogger("whatsfortea.audit")
from app.schemas.user import ForgotPasswordRequest, ResetPasswordRequest, UserProfile
from app.services.email import send_password_reset

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


_BRUTE_FORCE_LIMIT = 10      # max failures allowed
_BRUTE_FORCE_WINDOW = 600    # seconds (10 minutes)


def _brute_force_key(username: str) -> str:
    # Hash the username so the Redis key doesn't log the raw value
    return "auth:failures:" + hashlib.sha256(username.lower().encode()).hexdigest()[:16]


@router.post("/login")
async def login(body: LoginRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    from app.models.user import User

    redis = getattr(request.app.state, "redis", None)
    bf_key = _brute_force_key(body.username)

    # Reject immediately if already locked out
    if redis is not None:
        count = await redis.get(bf_key)
        if count and int(count) >= _BRUTE_FORCE_LIMIT:
            logger.warning("auth.brute_force_blocked", extra={"username": body.username})
            raise AppError(
                ErrorCode.UNAUTHORIZED,
                "Too many failed attempts. Try again in 10 minutes.",
                status_code=429,
            )

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
        logger.warning("auth.login_failed", extra={"username": body.username})
        if redis is not None:
            new_count = await redis.incr(bf_key)
            if new_count == 1:
                await redis.expire(bf_key, _BRUTE_FORCE_WINDOW)
        raise AppError(ErrorCode.UNAUTHORIZED, "Invalid credentials", status_code=401)

    # Successful login — clear any accumulated failure count
    if redis is not None:
        await redis.delete(bf_key)

    if user:
        user_id = str(user.id)
        household_id = str(user.household_id)
    else:
        user_id = "household"
        household_id = "household"

    logger.info("auth.login_success", extra={"user_id": user_id, "username": body.username})
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
async def logout(request: Request, response: Response):
    user_id = getattr(request.state, "user_id", None)
    logger.info("auth.logout", extra={"user_id": str(user_id) if user_id else "unknown"})
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth/refresh")
    return {"ok": True}


@router.post("/forgot-password", status_code=200)
async def forgot_password(
    body: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    from app.models.user import PasswordResetToken, User

    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    # Always return 200 to avoid leaking whether the email is registered
    if user is None:
        return {"ok": True}

    # Invalidate any existing unused tokens for this user
    existing = await db.execute(
        select(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used.is_(False),
        )
    )
    for token in existing.scalars().all():
        token.used = True

    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    reset_token = PasswordResetToken(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    db.add(reset_token)
    await db.commit()

    background_tasks.add_task(send_password_reset, user.email, raw_token)
    return {"ok": True}


@router.post("/reset-password", status_code=200)
async def reset_password(body: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    from app.models.user import PasswordResetToken, User

    if len(body.new_password) < 8:
        raise AppError(ErrorCode.VALIDATION_ERROR, "Password must be at least 8 characters", status_code=422)

    token_hash = hashlib.sha256(body.token.encode()).hexdigest()
    result = await db.execute(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash)
    )
    reset_token = result.scalar_one_or_none()

    if reset_token is None or reset_token.used:
        raise AppError(ErrorCode.NOT_FOUND, "Invalid or already used reset token", status_code=404)

    if reset_token.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise AppError(ErrorCode.VALIDATION_ERROR, "Reset token has expired", status_code=422)

    user = await db.get(User, reset_token.user_id)
    if user is None:
        raise AppError(ErrorCode.NOT_FOUND, "User not found", status_code=404)

    user.password_hash = _ph.hash(body.new_password)
    reset_token.used = True
    await db.commit()
    logger.info("auth.password_reset", extra={"user_id": str(user.id), "username": user.username})
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
