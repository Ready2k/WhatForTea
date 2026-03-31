"""
Hangry Matcher API — scores recipes against current pantry availability.

Route: GET /api/v1/recipes/match

IMPORTANT: This router uses prefix="/api/v1/recipes" and must be registered
in main.py BEFORE the recipes router, so "match" is not parsed as a UUID.
"""
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.matcher import RecipeMatchResult
from app.services.matcher import score_all_recipes

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/recipes", tags=["matcher"])


@router.get("/match", response_model=list[RecipeMatchResult])
async def match_recipes(
    category: Optional[Literal["cook_now", "almost_there", "planner"]] = Query(
        default=None,
        description="Filter to a specific category. Omit to return all.",
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Score every recipe against current pantry availability.

    Returns recipes sorted by score descending (Cook Now first).
    Optionally filter by category: cook_now (≥90), almost_there (50–89), planner (<50).

    Uses live confidence-decayed availability — never stale pantry data.
    """
    results = await score_all_recipes(db)

    if category:
        results = [r for r in results if r.category == category]

    return results
