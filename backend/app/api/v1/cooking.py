"""
Cooking Session API — create, track, end, and review cooking history.
"""
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.session import CookingSession, CookingSessionCreate, CookingSessionEnd, CookingSessionPatch
from app.services.cooking import (
    create_session,
    end_session,
    get_active_session,
    get_history,
    patch_session,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/cooking", tags=["cooking"])


def _get_user_uuid(request: Request) -> Optional[uuid.UUID]:
    """Extract user UUID from request state, returning None for legacy/household tokens."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id or user_id == "household":
        return None
    try:
        return uuid.UUID(user_id)
    except ValueError:
        return None


@router.post("/sessions", response_model=CookingSession, status_code=status.HTTP_201_CREATED)
async def start_cooking_session(
    body: CookingSessionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a new cooking session for a recipe."""
    try:
        return await create_session(body.recipe_id, db, user_id=_get_user_uuid(request))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/sessions/active", response_model=CookingSession | None)
async def get_active_cooking_session(db: AsyncSession = Depends(get_db)):
    """Return the most recent active (non-ended) cooking session, or null."""
    return await get_active_session(db)


@router.get("/history", response_model=list[CookingSession])
async def get_cooking_history(
    recipe_id: Optional[uuid.UUID] = Query(None),
    mine: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
    request: Request = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Return confirmed cooking sessions, newest first.
    Optionally filter by recipe_id or mine=true (current user's sessions only).
    """
    filter_user_id = _get_user_uuid(request) if mine else None
    return await get_history(db, recipe_id=recipe_id, user_id=filter_user_id, limit=limit)


@router.patch("/sessions/{session_id}", response_model=CookingSession)
async def update_cooking_session(
    session_id: uuid.UUID,
    body: CookingSessionPatch,
    db: AsyncSession = Depends(get_db),
):
    """Update step progress, notes, or rating for an active cooking session."""
    try:
        return await patch_session(session_id, body, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


def _get_household_uuid(request: Request) -> Optional[uuid.UUID]:
    """Extract household UUID from request state, returning None if absent or invalid."""
    hid = getattr(request.state, "household_id", None)
    if not hid or hid == "household":
        return None
    try:
        return uuid.UUID(hid)
    except (ValueError, AttributeError):
        return None


@router.post("/sessions/{session_id}/end", response_model=CookingSession)
async def finish_cooking_session(
    session_id: uuid.UUID,
    request: Request,
    body: CookingSessionEnd = CookingSessionEnd(),
    db: AsyncSession = Depends(get_db),
):
    """
    End a cooking session.
    Pass confirmed=true to consume pantry ingredients and record as a cook.
    """
    try:
        return await end_session(session_id, body, db, household_id=_get_household_uuid(request))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
