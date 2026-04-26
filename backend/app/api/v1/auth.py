"""
Authentication endpoints.

POST /api/auth/login              — verify credentials against users table, set httpOnly cookies
POST /api/auth/refresh            — rotate access token using refresh cookie
POST /api/auth/logout             — clear cookies
GET  /api/auth/me                 — current user profile (requires valid access token)
POST /api/auth/register           — create a new household + admin user (username/password)
POST /api/auth/forgot-password    — send one-time reset link to user's email
POST /api/auth/reset-password     — consume reset token and set new password
GET  /api/auth/google             — redirect to Google OAuth consent screen
GET  /api/auth/google/callback    — handle Google OAuth callback, set cookies
POST /api/auth/google/complete    — finalise Google signup after household setup choice
"""
import hashlib
import secrets
import urllib.parse
from datetime import datetime, timedelta, timezone

import httpx
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import logging

from app.config import settings
from app.database import get_db
from app.errors import AppError, ErrorCode

from app.schemas.user import ForgotPasswordRequest, GoogleCompleteRequest, RegisterRequest, ResetPasswordRequest, UserProfile
from app.services.email import send_password_reset

logger = logging.getLogger("whatsfortea.audit")

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


@router.post("/register", response_model=UserProfile, status_code=201)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    from app.models.user import Household, User

    if len(body.password) < 8:
        raise AppError(ErrorCode.VALIDATION_ERROR, "Password must be at least 8 characters", status_code=422)

    existing = (await db.execute(select(User).where(User.username == body.username))).scalar_one_or_none()
    if existing:
        raise AppError(ErrorCode.VALIDATION_ERROR, "Username already taken", status_code=409)

    email = body.email.strip().lower() if body.email else None
    if email:
        taken = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if taken:
            raise AppError(ErrorCode.VALIDATION_ERROR, "Email already in use", status_code=409)

    household = Household(
        name=body.household_name.strip(),
        invite_code=secrets.token_urlsafe(12),
    )
    db.add(household)
    await db.flush()

    user = User(
        household_id=household.id,
        username=body.username.strip(),
        display_name=body.display_name.strip(),
        email=email,
        password_hash=_ph.hash(body.password),
        is_admin=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    logger.info("auth.register", extra={"user_id": str(user.id), "household_id": str(household.id)})
    return UserProfile.model_validate(user)


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


_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"  # nosec B105
_GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
_OAUTH_STATE_TTL = 300  # seconds


@router.get("/google")
async def google_login(request: Request):
    if not settings.google_client_id:
        raise AppError(ErrorCode.VALIDATION_ERROR, "Google SSO is not configured", status_code=501)

    state = secrets.token_urlsafe(32)
    redis = getattr(request.app.state, "redis", None)
    if redis:
        await redis.setex(f"oauth:state:{state}", _OAUTH_STATE_TTL, "1")

    redirect_uri = f"{settings.app_url}/api/auth/google/callback"
    params = urllib.parse.urlencode({
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "offline",
        "prompt": "select_account",
    })
    return RedirectResponse(f"{_GOOGLE_AUTH_URL}?{params}", status_code=302)


@router.get("/google/callback")
async def google_callback(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    from app.models.user import Household, User

    code = request.query_params.get("code")
    state = request.query_params.get("state")
    error = request.query_params.get("error")

    frontend_url = settings.app_url

    if error or not code or not state:
        return RedirectResponse(f"{frontend_url}/login?error=oauth_cancelled", status_code=302)

    redis = getattr(request.app.state, "redis", None)
    if redis:
        stored = await redis.getdel(f"oauth:state:{state}")
        if not stored:
            return RedirectResponse(f"{frontend_url}/login?error=oauth_invalid_state", status_code=302)

    # Exchange code for tokens
    redirect_uri = f"{settings.app_url}/api/auth/google/callback"
    try:
        async with httpx.AsyncClient() as client:
            token_resp = await client.post(_GOOGLE_TOKEN_URL, data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            })
            token_resp.raise_for_status()
            access_token = token_resp.json()["access_token"]

            info_resp = await client.get(
                _GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            info_resp.raise_for_status()
            info = info_resp.json()
    except Exception:
        logger.exception("auth.google_callback_error")
        return RedirectResponse(f"{frontend_url}/login?error=oauth_failed", status_code=302)

    google_sub = info.get("id") or info.get("sub")
    google_email = (info.get("email") or "").lower().strip()
    google_name = info.get("name") or google_email.split("@")[0]

    if not google_sub or not google_email:
        return RedirectResponse(f"{frontend_url}/login?error=oauth_no_email", status_code=302)

    # Find existing user by oauth_sub first, then fall back to email
    user = (await db.execute(
        select(User).where(User.oauth_sub == google_sub)
    )).scalar_one_or_none()

    if user is None and google_email:
        user = (await db.execute(
            select(User).where(User.email == google_email)
        )).scalar_one_or_none()
        if user:
            # Link the Google identity to the existing account
            user.oauth_provider = "google"
            user.oauth_sub = google_sub
            await db.commit()

    if user is None:
        # First Google login — send to household setup page
        import json
        import uuid as _uuid
        redis = getattr(request.app.state, "redis", None)
        if redis:
            token = str(_uuid.uuid4())
            await redis.setex(
                f"google_pending:{token}",
                300,
                json.dumps({"sub": google_sub, "email": google_email, "name": google_name}),
            )
            logger.info("auth.google_pending_setup", extra={"email": google_email})
            return RedirectResponse(
                f"{frontend_url}/login?mode=google_setup&token={token}",
                status_code=302,
            )

        # Redis unavailable — fall back to auto-creating a household
        import re
        base_username = re.sub(r"[^a-z0-9._-]", "", google_email.split("@")[0].lower()) or "user"
        username = base_username
        suffix = 1
        while (await db.execute(select(User).where(User.username == username))).scalar_one_or_none():
            username = f"{base_username}{suffix}"
            suffix += 1

        household = Household(
            name=f"{google_name}'s Household",
            invite_code=secrets.token_urlsafe(6)[:8],
        )
        db.add(household)
        await db.flush()

        user = User(
            household_id=household.id,
            username=username,
            display_name=google_name,
            email=google_email,
            password_hash=None,
            oauth_provider="google",
            oauth_sub=google_sub,
            is_admin=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        logger.info("auth.google_new_user", extra={"user_id": str(user.id), "email": google_email})
    else:
        logger.info("auth.google_login", extra={"user_id": str(user.id), "email": google_email})

    user_id = str(user.id)
    household_id = str(user.household_id)
    access = _make_token(user_id, household_id, timedelta(minutes=ACCESS_TTL_MINUTES))
    refresh = _make_token(user_id, household_id, timedelta(days=REFRESH_TTL_DAYS))

    # Redirect response — set cookies on it directly
    redirect = RedirectResponse(url=f"{frontend_url}/", status_code=302)
    redirect.set_cookie(
        key=ACCESS_COOKIE, value=access, httponly=True,
        secure=settings.cookie_secure, samesite="strict",
        max_age=ACCESS_TTL_MINUTES * 60, path="/",
    )
    redirect.set_cookie(
        key=REFRESH_COOKIE, value=refresh, httponly=True,
        secure=settings.cookie_secure, samesite="strict",
        max_age=REFRESH_TTL_DAYS * 86400, path="/api/auth/refresh",
    )
    return redirect


@router.post("/google/complete")
async def google_complete(
    body: GoogleCompleteRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    import json
    from app.models.user import Household, User

    redis = getattr(request.app.state, "redis", None)
    if not redis:
        raise AppError(ErrorCode.INTERNAL_ERROR, "Setup flow unavailable", status_code=503)

    pending_json = await redis.getdel(f"google_pending:{body.google_token}")
    if not pending_json:
        raise AppError(ErrorCode.UNAUTHORIZED, "Setup token expired or invalid", status_code=401)

    pending = json.loads(pending_json)
    google_sub: str = pending["sub"]
    google_email: str = pending["email"]
    google_name: str = pending["name"]

    if body.mode == "create":
        if not body.household_name or not body.household_name.strip():
            raise AppError(ErrorCode.VALIDATION_ERROR, "Household name is required", status_code=422)
        household = Household(
            name=body.household_name.strip(),
            invite_code=secrets.token_urlsafe(12),
        )
        db.add(household)
        await db.flush()
        is_admin = True
    elif body.mode == "join":
        if not body.invite_code or not body.invite_code.strip():
            raise AppError(ErrorCode.VALIDATION_ERROR, "Invite code is required", status_code=422)
        household = (await db.execute(
            select(Household).where(Household.invite_code == body.invite_code.strip())
        )).scalar_one_or_none()
        if household is None:
            raise AppError(ErrorCode.NOT_FOUND, "Invalid invite code", status_code=404)
        is_admin = False
    else:
        raise AppError(ErrorCode.VALIDATION_ERROR, "mode must be 'create' or 'join'", status_code=422)

    import re
    base_username = re.sub(r"[^a-z0-9._-]", "", google_email.split("@")[0].lower()) or "user"
    username = base_username
    suffix = 1
    while (await db.execute(select(User).where(User.username == username))).scalar_one_or_none():
        username = f"{base_username}{suffix}"
        suffix += 1

    user = User(
        household_id=household.id,
        username=username,
        display_name=google_name,
        email=google_email,
        password_hash=None,
        oauth_provider="google",
        oauth_sub=google_sub,
        is_admin=is_admin,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    logger.info("auth.google_new_user", extra={"user_id": str(user.id), "email": google_email})

    user_id = str(user.id)
    household_id = str(user.household_id)
    access = _make_token(user_id, household_id, timedelta(minutes=ACCESS_TTL_MINUTES))
    refresh_tok = _make_token(user_id, household_id, timedelta(days=REFRESH_TTL_DAYS))
    _set_access_cookie(response, access)
    _set_refresh_cookie(response, refresh_tok)
    return {"ok": True, "user_id": user_id}


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
