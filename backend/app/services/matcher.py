"""
"Hangry" Matcher — scores every recipe against the current pantry.

Scoring is continuous, not binary: a recipe where you have half of every
ingredient scores ~50%, not 0%. This surfaces "almost there" recipes that
only need one or two top-ups.

Algorithm per recipe:
  for each ingredient:
    s = min(available_qty / required_qty, 1.0)   # 0.0 if missing/unresolvable
  recipe_score = mean(scores) × 100

Categories:
  ≥ 90  → cook_now
  50–89 → almost_there
  < 50  → planner
"""
import logging
import uuid
from statistics import mean
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.ingredient import UnitConversion
from app.models.recipe import Recipe, RecipeIngredient
from app.schemas.matcher import IngredientMatchDetail, RecipeMatchResult
from app.schemas.pantry import PantryAvailability
from app.schemas.recipe import RecipeSummary

logger = logging.getLogger(__name__)

_LOW_CONFIDENCE_THRESHOLD = 0.7


# ── Pure helpers ──────────────────────────────────────────────────────────────

def ingredient_score(available_qty: float, required_qty: float) -> float:
    """
    Continuous ingredient score in [0.0, 1.0].
    Returns 0.0 if required_qty is 0 or available_qty is 0.
    """
    if required_qty <= 0 or available_qty <= 0:
        return 0.0
    return min(available_qty / required_qty, 1.0)


def get_category(score: float) -> str:
    """Map a recipe score (0–100) to its display category."""
    if score >= 90:
        return "cook_now"
    if score >= 50:
        return "almost_there"
    return "planner"


# ── Unit conversion ───────────────────────────────────────────────────────────

async def _conversion_factor(
    from_unit: Optional[str],
    to_unit: Optional[str],
    db: AsyncSession,
) -> Optional[float]:
    """
    Return the factor to convert `from_unit` → `to_unit`, or None if unknown.
    Treats None/empty as "count" (dimensionless).
    """
    f = (from_unit or "count").lower().strip()
    t = (to_unit or "count").lower().strip()
    if f == t:
        return 1.0
    stmt = select(UnitConversion).where(
        UnitConversion.from_unit == f,
        UnitConversion.to_unit == t,
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    return float(row.factor) if row else None


# ── Core scoring ──────────────────────────────────────────────────────────────

async def score_recipe(
    recipe: Recipe,
    avail_map: dict[uuid.UUID, PantryAvailability],
    db: AsyncSession,
) -> RecipeMatchResult:
    """Score a single recipe against the availability map."""
    scores: list[float] = []
    hard_missing: list[IngredientMatchDetail] = []
    partial: list[IngredientMatchDetail] = []
    low_confidence: list[IngredientMatchDetail] = []
    full: list[IngredientMatchDetail] = []

    for ri in recipe.ingredients:
        avail = avail_map.get(ri.ingredient_id) if ri.ingredient_id else None

        required_qty = float(ri.normalized_quantity or ri.quantity)
        required_unit = ri.normalized_unit or ri.unit

        if avail is None:
            # Ingredient not in pantry at all
            detail = IngredientMatchDetail(
                ingredient_id=ri.ingredient_id,
                raw_name=ri.raw_name,
                required_qty=required_qty,
                required_unit=required_unit,
                available_qty=0.0,
                score=0.0,
                confidence=0.0,
            )
            scores.append(0.0)
            hard_missing.append(detail)
            continue

        # Convert required qty to pantry unit for comparison
        factor = await _conversion_factor(required_unit, avail.unit, db)
        if factor is None:
            logger.warning(
                "unit conversion not found for matching — treating as missing",
                extra={
                    "raw_name": ri.raw_name,
                    "from": required_unit,
                    "to": avail.unit,
                },
            )
            detail = IngredientMatchDetail(
                ingredient_id=ri.ingredient_id,
                raw_name=ri.raw_name,
                required_qty=required_qty,
                required_unit=required_unit,
                available_qty=avail.available_quantity,
                score=0.0,
                confidence=avail.confidence,
            )
            scores.append(0.0)
            hard_missing.append(detail)
            continue

        required_in_pantry_units = required_qty * factor
        s = ingredient_score(avail.available_quantity, required_in_pantry_units)

        detail = IngredientMatchDetail(
            ingredient_id=ri.ingredient_id,
            raw_name=ri.raw_name,
            required_qty=required_in_pantry_units,
            required_unit=avail.unit,
            available_qty=avail.available_quantity,
            score=s,
            confidence=avail.confidence,
        )
        scores.append(s)

        if s == 0.0:
            hard_missing.append(detail)
        elif s < 1.0:
            partial.append(detail)
        elif avail.confidence < _LOW_CONFIDENCE_THRESHOLD:
            low_confidence.append(detail)
        else:
            full.append(detail)

    recipe_score = (mean(scores) * 100) if scores else 0.0

    return RecipeMatchResult(
        recipe=RecipeSummary.model_validate(recipe),
        score=round(recipe_score, 1),
        category=get_category(recipe_score),
        hard_missing=hard_missing,
        partial=partial,
        low_confidence=low_confidence,
        full=full,
    )


async def score_all_recipes(db: AsyncSession) -> list[RecipeMatchResult]:
    """
    Score every recipe in the database against the current pantry availability.
    Returns results sorted by score descending (Cook Now first).
    """
    from app.services.pantry import get_available

    # Build availability map keyed by ingredient_id
    availability = await get_available(db)
    avail_map: dict[uuid.UUID, PantryAvailability] = {
        a.ingredient.id: a for a in availability
    }

    # Load all recipes with ingredients eagerly
    stmt = select(Recipe).options(selectinload(Recipe.ingredients))
    recipes = (await db.execute(stmt)).scalars().all()

    results = []
    for recipe in recipes:
        result = await score_recipe(recipe, avail_map, db)
        results.append(result)

    results.sort(key=lambda r: r.score, reverse=True)
    return results
