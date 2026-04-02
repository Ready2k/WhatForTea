"""
Cooking Session API — create, track, and end cooking sessions.
"""
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.session import CookingSession, CookingSessionCreate, CookingSessionPatch
from app.services.cooking import (
    create_session,
    end_session,
    get_active_session,
    patch_session,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/cooking", tags=["cooking"])


@router.post("/sessions", response_model=CookingSession, status_code=status.HTTP_201_CREATED)
async def start_cooking_session(
    body: CookingSessionCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new cooking session for a recipe."""
    try:
        return await create_session(body.recipe_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/sessions/active", response_model=CookingSession | None)
async def get_active_cooking_session(db: AsyncSession = Depends(get_db)):
    """
    Return the most recent active (non-ended) cooking session, or null.
    Used on the dashboard to offer a resume prompt.
    """
    return await get_active_session(db)


@router.patch("/sessions/{session_id}", response_model=CookingSession)
async def update_cooking_session(
    session_id: uuid.UUID,
    body: CookingSessionPatch,
    db: AsyncSession = Depends(get_db),
):
    """Update step progress and timer state for an active cooking session."""
    try:
        return await patch_session(session_id, body, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/sessions/{session_id}/end", response_model=CookingSession)
async def finish_cooking_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Mark a cooking session as ended."""
    try:
        return await end_session(session_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
