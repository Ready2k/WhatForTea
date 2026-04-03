"""
Cooking session service — create, update, and end cooking sessions.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.recipe import Recipe
from app.models.session import CookingSession as CookingSessionModel
from app.schemas.session import CookingSession, CookingSessionEnd, CookingSessionPatch

logger = logging.getLogger(__name__)


def _to_schema(
    session: CookingSessionModel,
    recipe_title: Optional[str] = None,
    user_display_name: Optional[str] = None,
) -> CookingSession:
    result = CookingSession.model_validate(session)
    result.recipe_title = recipe_title
    result.user_display_name = user_display_name
    return result


async def create_session(
    recipe_id: uuid.UUID,
    db: AsyncSession,
    user_id: Optional[uuid.UUID] = None,
) -> CookingSession:
    """Create a new cooking session for the given recipe."""
    recipe = await db.get(Recipe, recipe_id)
    if recipe is None:
        raise ValueError(f"Recipe {recipe_id} not found")

    session = CookingSessionModel(
        recipe_id=recipe_id,
        current_step=1,
        completed_steps=[],
        timers={},
        user_id=user_id,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    logger.info("cooking session created", extra={"session_id": str(session.id), "recipe_id": str(recipe_id)})
    return _to_schema(session, recipe.title)


async def get_active_session(db: AsyncSession) -> Optional[CookingSession]:
    """Return the most recent non-ended cooking session, or None."""
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
    return _to_schema(session, recipe.title if recipe else None)


async def patch_session(
    session_id: uuid.UUID,
    data: CookingSessionPatch,
    db: AsyncSession,
) -> CookingSession:
    """Partially update a cooking session's progress state, notes, or rating."""
    session = await db.get(CookingSessionModel, session_id)
    if session is None:
        raise ValueError(f"Cooking session {session_id} not found")

    if data.current_step is not None:
        session.current_step = data.current_step
    if data.completed_steps is not None:
        session.completed_steps = data.completed_steps
    if data.timers is not None:
        session.timers = data.timers
    if data.notes is not None:
        session.notes = data.notes
    if data.rating is not None:
        session.rating = data.rating

    await db.commit()
    await db.refresh(session)

    recipe = await db.get(Recipe, session.recipe_id)
    return _to_schema(session, recipe.title if recipe else None)


async def end_session(
    session_id: uuid.UUID,
    data: CookingSessionEnd,
    db: AsyncSession,
) -> CookingSession:
    """
    End a cooking session. If confirmed=True, consume pantry ingredients
    and mark the session as a confirmed cook.
    """
    session = await db.get(CookingSessionModel, session_id)
    if session is None:
        raise ValueError(f"Cooking session {session_id} not found")

    session.ended_at = datetime.now(timezone.utc)
    session.confirmed_cook = data.confirmed
    if data.servings_cooked is not None:
        session.servings_cooked = data.servings_cooked

    if data.confirmed:
        from app.services.pantry import consume_from_pantry
        await consume_from_pantry(session.recipe_id, db)

    await db.commit()
    await db.refresh(session)

    recipe = await db.get(Recipe, session.recipe_id)
    logger.info(
        "cooking session ended",
        extra={"session_id": str(session_id), "confirmed": data.confirmed},
    )
    return _to_schema(session, recipe.title if recipe else None)


async def get_history(
    db: AsyncSession,
    recipe_id: Optional[uuid.UUID] = None,
    user_id: Optional[uuid.UUID] = None,
    limit: int = 20,
) -> list[CookingSession]:
    """Return confirmed cooking sessions, newest first."""
    stmt = (
        select(CookingSessionModel)
        .where(
            CookingSessionModel.confirmed_cook.is_(True),
            CookingSessionModel.ended_at.isnot(None),
        )
        .order_by(CookingSessionModel.ended_at.desc())
        .limit(limit)
    )
    if recipe_id is not None:
        stmt = stmt.where(CookingSessionModel.recipe_id == recipe_id)
    if user_id is not None:
        stmt = stmt.where(CookingSessionModel.user_id == user_id)

    sessions = (await db.execute(stmt)).scalars().all()

    # Batch-load recipe titles and user display names
    recipe_ids = list({s.recipe_id for s in sessions})
    recipes: dict[uuid.UUID, str] = {}
    for rid in recipe_ids:
        r = await db.get(Recipe, rid)
        if r:
            recipes[rid] = r.title

    user_ids = list({s.user_id for s in sessions if s.user_id is not None})
    display_names: dict[uuid.UUID, str] = {}
    if user_ids:
        from app.models.user import User
        for uid in user_ids:
            u = await db.get(User, uid)
            if u:
                display_names[uid] = u.display_name

    return [
        _to_schema(s, recipes.get(s.recipe_id), display_names.get(s.user_id) if s.user_id else None)
        for s in sessions
    ]


async def get_recipe_stats(
    recipe_id: uuid.UUID,
    db: AsyncSession,
) -> dict:
    """Return aggregate cook stats for a recipe (total cooks, average rating, recent notes)."""
    stmt = (
        select(CookingSessionModel)
        .where(
            CookingSessionModel.recipe_id == recipe_id,
            CookingSessionModel.confirmed_cook.is_(True),
        )
        .order_by(CookingSessionModel.ended_at.desc())
    )
    sessions = (await db.execute(stmt)).scalars().all()

    total_cooks = len(sessions)
    ratings = [s.rating for s in sessions if s.rating is not None]
    average_rating = round(sum(ratings) / len(ratings), 1) if ratings else None
    recent_notes = [s.notes for s in sessions[:3] if s.notes]
    last_cooked_at = sessions[0].ended_at if sessions else None

    return {
        "total_cooks": total_cooks,
        "average_rating": average_rating,
        "recent_notes": recent_notes,
        "last_cooked_at": last_cooked_at,
    }
