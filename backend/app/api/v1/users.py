"""
User and household management endpoints.

PATCH  /api/v1/users/me                          — update display name / email
POST   /api/v1/users/me/password                 — change password (clears force_password_change)
GET    /api/v1/household                         — household info + invite code (admin only)
POST   /api/v1/household/invite                  — rotate invite code (admin only)
GET    /api/v1/household/members                 — list all household members
DELETE /api/v1/household/members/{user_id}       — admin: remove a member from the household
POST   /api/v1/household/join                    — join a household with invite code (creates new user)
POST   /api/v1/admin/users/{user_id}/reset-password — admin: set temp password, force change on next login
"""
import logging
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

logger = logging.getLogger("whatsfortea.audit")

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

    if body.email is not None:
        email = body.email.strip().lower() or None
        if email:
            existing = await db.execute(
                select(User).where(User.email == email, User.id != uid)
            )
            if existing.scalar_one_or_none() is not None:
                raise AppError(ErrorCode.VALIDATION_ERROR, "Email already in use", status_code=409)
        user.email = email

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
    user.force_password_change = False
    await db.commit()
    logger.info("auth.password_changed", extra={"user_id": str(uid), "username": user.username})


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


@router.delete("/household/members/{user_id}", status_code=204)
async def remove_member(user_id: _uuid.UUID, request: Request, db: AsyncSession = Depends(get_db)):
    from app.models.user import User

    caller_id = _require_user_id(request)
    caller_hid = _require_household_id(request)

    caller = await db.get(User, caller_id)
    if caller is None or not caller.is_admin:
        raise AppError(ErrorCode.UNAUTHORIZED, "Admin access required", status_code=403)

    if user_id == caller_id:
        raise AppError(ErrorCode.VALIDATION_ERROR, "Cannot remove yourself from the household", status_code=400)

    target = await db.get(User, user_id)
    if target is None or target.household_id != caller_hid:
        raise AppError(ErrorCode.NOT_FOUND, "User not found", status_code=404)

    # Prevent removing the last admin
    if target.is_admin:
        result = await db.execute(
            select(User).where(User.household_id == caller_hid, User.is_admin)
        )
        admin_count = len(result.scalars().all())
        if admin_count <= 1:
            raise AppError(ErrorCode.VALIDATION_ERROR, "Cannot remove the last admin from the household", status_code=400)

    await db.delete(target)
    await db.commit()
    logger.warning(
        "auth.member_removed",
        extra={"admin_id": str(caller_id), "removed_user_id": str(user_id), "removed_username": target.username},
    )


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

    email = body.email.strip().lower() if body.email else None
    if email:
        taken = await db.execute(select(User).where(User.email == email))
        if taken.scalar_one_or_none() is not None:
            raise AppError(ErrorCode.VALIDATION_ERROR, "Email already in use", status_code=409)

    new_user = User(
        household_id=household.id,
        username=body.username.strip(),
        display_name=body.display_name.strip(),
        email=email,
        password_hash=_ph.hash(body.password),
        is_admin=False,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return UserProfile.model_validate(new_user)


# ── Admin endpoints ───────────────────────────────────────────────────────────

@router.post("/admin/users/{user_id}/reset-password")
async def admin_reset_password(user_id: _uuid.UUID, request: Request, db: AsyncSession = Depends(get_db)):
    from app.models.user import User

    caller_id = _require_user_id(request)
    caller_hid = _require_household_id(request)

    caller = await db.get(User, caller_id)
    if caller is None or not caller.is_admin:
        raise AppError(ErrorCode.UNAUTHORIZED, "Admin access required", status_code=403)

    target = await db.get(User, user_id)
    if target is None or target.household_id != caller_hid:
        raise AppError(ErrorCode.NOT_FOUND, "User not found", status_code=404)

    if target.id == caller_id:
        raise AppError(ErrorCode.VALIDATION_ERROR, "Cannot reset your own password via admin endpoint", status_code=400)

    temp_password = secrets.token_urlsafe(12)
    target.password_hash = _ph.hash(temp_password)
    target.force_password_change = True
    await db.commit()
    logger.warning(
        "auth.admin_password_reset",
        extra={"admin_id": str(caller_id), "target_user_id": str(user_id), "target_username": target.username},
    )
    return {"temp_password": temp_password}
