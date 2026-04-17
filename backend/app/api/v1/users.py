"""
User and household management endpoints.

PATCH  /api/v1/users/me           — update display name
POST   /api/v1/users/me/password  — change password
GET    /api/v1/household          — household info + invite code (admin only)
POST   /api/v1/household/invite   — rotate invite code (admin only)
GET    /api/v1/household/members  — list all household members
POST   /api/v1/household/join     — join a household with invite code (creates new user)
"""
import secrets
import uuid as _uuid

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.errors import AppError, ErrorCode
from app.schemas.user import HouseholdInfo, JoinRequest, PasswordChange, UserProfile, UserUpdate

_ph = PasswordHasher()

router = APIRouter(prefix="/api/v1", tags=["users"])


def _require_user_id(request: Request) -> _uuid.UUID:
    user_id = getattr(request.state, "user_id", None)
    if not user_id or user_id == "household":
        raise AppError(ErrorCode.UNAUTHORIZED, "Multi-user auth required", status_code=401)
    try:
        return _uuid.UUID(user_id)
    except ValueError:
        raise AppError(ErrorCode.UNAUTHORIZED, "Invalid user token", status_code=401)


def _require_household_id(request: Request) -> _uuid.UUID:
    household_id = getattr(request.state, "household_id", None)
    if not household_id or household_id == "household":
        raise AppError(ErrorCode.UNAUTHORIZED, "Multi-user auth required", status_code=401)
    try:
        return _uuid.UUID(household_id)
    except ValueError:
        raise AppError(ErrorCode.UNAUTHORIZED, "Invalid household token", status_code=401)


# ── User endpoints ────────────────────────────────────────────────────────────

@router.patch("/users/me", response_model=UserProfile)
async def update_me(body: UserUpdate, request: Request, db: AsyncSession = Depends(get_db)):
    from app.models.user import User

    uid = _require_user_id(request)
    user = await db.get(User, uid)
    if user is None:
        raise AppError(ErrorCode.NOT_FOUND, "User not found", status_code=404)

    if body.display_name is not None:
        user.display_name = body.display_name.strip()

    await db.commit()
    await db.refresh(user)
    return UserProfile.model_validate(user)


@router.post("/users/me/password", status_code=204)
async def change_password(body: PasswordChange, request: Request, db: AsyncSession = Depends(get_db)):
    from app.models.user import User

    uid = _require_user_id(request)
    user = await db.get(User, uid)
    if user is None:
        raise AppError(ErrorCode.NOT_FOUND, "User not found", status_code=404)

    try:
        _ph.verify(user.password_hash, body.current_password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        raise AppError(ErrorCode.UNAUTHORIZED, "Current password is incorrect", status_code=401)

    user.password_hash = _ph.hash(body.new_password)
    await db.commit()


# ── Household endpoints ───────────────────────────────────────────────────────

@router.get("/household", response_model=HouseholdInfo)
async def get_household(request: Request, db: AsyncSession = Depends(get_db)):
    from app.models.user import Household, User

    _require_user_id(request)
    hid = _require_household_id(request)

    household = await db.get(Household, hid)
    if household is None:
        raise AppError(ErrorCode.NOT_FOUND, "Household not found", status_code=404)

    result = await db.execute(
        select(User).where(User.household_id == hid)
    )
    member_count = len(result.scalars().all())

    return HouseholdInfo(
        id=household.id,
        name=household.name,
        invite_code=household.invite_code,
        member_count=member_count,
    )


@router.post("/household/invite", response_model=HouseholdInfo)
async def rotate_invite_code(request: Request, db: AsyncSession = Depends(get_db)):
    from app.models.user import Household, User

    uid = _require_user_id(request)
    hid = _require_household_id(request)

    # Only admins may rotate invite codes
    user = await db.get(User, uid)
    if user is None or not user.is_admin:
        raise AppError(ErrorCode.UNAUTHORIZED, "Admin access required", status_code=403)

    household = await db.get(Household, hid)
    if household is None:
        raise AppError(ErrorCode.NOT_FOUND, "Household not found", status_code=404)

    household.invite_code = secrets.token_urlsafe(12)
    await db.commit()
    await db.refresh(household)

    result = await db.execute(select(User).where(User.household_id == hid))
    member_count = len(result.scalars().all())

    return HouseholdInfo(
        id=household.id,
        name=household.name,
        invite_code=household.invite_code,
        member_count=member_count,
    )


@router.get("/household/members", response_model=list[UserProfile])
async def list_members(request: Request, db: AsyncSession = Depends(get_db)):
    from app.models.user import User

    _require_user_id(request)
    hid = _require_household_id(request)

    result = await db.execute(
        select(User).where(User.household_id == hid).order_by(User.created_at)
    )
    users = result.scalars().all()
    return [UserProfile.model_validate(u) for u in users]


@router.post("/household/join", response_model=UserProfile, status_code=201)
async def join_household(body: JoinRequest, db: AsyncSession = Depends(get_db)):
    from app.models.user import Household, User

    # Find household by invite code
    result = await db.execute(
        select(Household).where(Household.invite_code == body.invite_code)
    )
    household = result.scalar_one_or_none()
    if household is None:
        raise AppError(ErrorCode.NOT_FOUND, "Invalid invite code", status_code=404)

    # Check username not taken in this household
    existing = await db.execute(
        select(User).where(User.username == body.username)
    )
    if existing.scalar_one_or_none() is not None:
        raise AppError(ErrorCode.VALIDATION_ERROR, "Username already taken", status_code=409)

    new_user = User(
        household_id=household.id,
        username=body.username.strip(),
        display_name=body.display_name.strip(),
        password_hash=_ph.hash(body.password),
        is_admin=False,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return UserProfile.model_validate(new_user)
