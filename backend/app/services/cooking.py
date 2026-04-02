"""
Cooking session service — create, update, and end cooking sessions.

A session tracks a user's progress through a recipe's steps so they can
resume if they leave the cooking mode mid-way.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.recipe import Recipe
from app.models.session import CookingSession as CookingSessionModel
from app.schemas.session import CookingSession, CookingSessionPatch

logger = logging.getLogger(__name__)


async def create_session(recipe_id: uuid.UUID, db: AsyncSession) -> CookingSession:
    """Create a new cooking session for the given recipe."""
    recipe = await db.get(Recipe, recipe_id)
    if recipe is None:
        raise ValueError(f"Recipe {recipe_id} not found")

    session = CookingSessionModel(
        recipe_id=recipe_id,
        current_step=1,
        completed_steps=[],
        timers={},
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    result = CookingSession.model_validate(session)
    result.recipe_title = recipe.title
    logger.info("cooking session created", extra={"session_id": str(session.id), "recipe_id": str(recipe_id)})
    return result


async def get_active_session(db: AsyncSession) -> Optional[CookingSession]:
    """
    Return the most recent non-ended cooking session, or None.
    Joins the recipe to populate recipe_title.
    """
    stmt = (
        select(CookingSessionModel)
        .where(CookingSessionModel.ended_at.is_(None))
        .order_by(CookingSessionModel.started_at.desc())
        .limit(1)
    )
    session = (await db.execute(stmt)).scalar_one_or_none()
    if session is None:
        return None

    recipe = await db.get(Recipe, session.recipe_id)
    result = CookingSession.model_validate(session)
    result.recipe_title = recipe.title if recipe else None
    return result


async def patch_session(
    session_id: uuid.UUID,
    data: CookingSessionPatch,
    db: AsyncSession,
) -> CookingSession:
    """Partially update a cooking session's progress state."""
    session = await db.get(CookingSessionModel, session_id)
    if session is None:
        raise ValueError(f"Cooking session {session_id} not found")
    if session.ended_at is not None:
        raise ValueError("Cannot update an ended cooking session")

    if data.current_step is not None:
        session.current_step = data.current_step
    if data.completed_steps is not None:
        session.completed_steps = data.completed_steps
    if data.timers is not None:
        session.timers = data.timers

    await db.commit()
    await db.refresh(session)

    recipe = await db.get(Recipe, session.recipe_id)
    result = CookingSession.model_validate(session)
    result.recipe_title = recipe.title if recipe else None
    return result


async def end_session(session_id: uuid.UUID, db: AsyncSession) -> CookingSession:
    """Mark a cooking session as ended."""
    session = await db.get(CookingSessionModel, session_id)
    if session is None:
        raise ValueError(f"Cooking session {session_id} not found")

    session.ended_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(session)

    recipe = await db.get(Recipe, session.recipe_id)
    result = CookingSession.model_validate(session)
    result.recipe_title = recipe.title if recipe else None
    logger.info("cooking session ended", extra={"session_id": str(session_id)})
    return result
