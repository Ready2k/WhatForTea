"""
Cooking Session API — create, track, end, and review cooking history.
"""
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
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
    """Return the most recent active (non-ended) cooking session, or null."""
    return await get_active_session(db)


@router.get("/history", response_model=list[CookingSession])
async def get_cooking_history(
    recipe_id: Optional[uuid.UUID] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """
    Return confirmed cooking sessions, newest first.
    Optionally filter by recipe_id.
    """
    return await get_history(db, recipe_id=recipe_id, limit=limit)


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


@router.post("/sessions/{session_id}/end", response_model=CookingSession)
async def finish_cooking_session(
    session_id: uuid.UUID,
    body: CookingSessionEnd = CookingSessionEnd(),
    db: AsyncSession = Depends(get_db),
):
    """
    End a cooking session.
    Pass confirmed=true to consume pantry ingredients and record as a cook.
    """
    try:
        return await end_session(session_id, body, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
