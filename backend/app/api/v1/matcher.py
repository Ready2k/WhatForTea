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
from app.services.matcher import score_all_recipes, score_all_recipes_use_it_up

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/recipes", tags=["matcher"])


@router.get("/match", response_model=list[RecipeMatchResult])
async def match_recipes(
    category: Optional[Literal["cook_now", "almost_there", "planner"]] = Query(
        default=None,
        description="Filter to a specific category. Omit to return all.",
    ),
    sort: Optional[Literal["use_it_up"]] = Query(
        default=None,
        description="Sort by urgency (recipes that use low-confidence pantry items first).",
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Score every recipe against current pantry availability.

    Returns recipes sorted by score descending (Cook Now first) unless sort=use_it_up,
    which re-sorts by urgency to prioritise items going off.
    """
    if sort == "use_it_up":
        results = await score_all_recipes_use_it_up(db)
    else:
        results = await score_all_recipes(db)

    if category:
        results = [r for r in results if r.category == category]

    return results
