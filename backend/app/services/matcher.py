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

from app.metrics import match_score_histogram
from app.models.ingredient import IngredientSubstitute, UnitConversion
from app.models.recipe import Recipe
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


# ── Substitute checking ───────────────────────────────────────────────────────

async def _check_substitutes(
    ingredient_id: Optional[uuid.UUID],
    raw_name: str,
    required_qty: float,
    required_unit: Optional[str],
    avail_map: dict[uuid.UUID, "PantryAvailability"],
    db: AsyncSession,
) -> Optional[IngredientMatchDetail]:
    """
    Look for a known substitute in the pantry when the primary ingredient is missing.
    Returns the best-scoring IngredientMatchDetail with penalty applied, or None.
    """
    if ingredient_id is None:
        return None

    sub_stmt = select(IngredientSubstitute).where(
        IngredientSubstitute.ingredient_id == ingredient_id
    )
    substitutes = (await db.execute(sub_stmt)).scalars().all()
    if not substitutes:
        return None

    best_score = 0.0
    best_detail: Optional[IngredientMatchDetail] = None

    for sub in substitutes:
        sub_avail = avail_map.get(sub.substitute_ingredient_id)
        if sub_avail is None:
            continue
        factor = await _conversion_factor(required_unit, sub_avail.unit, db)
        if factor is None:
            continue
        required_in_sub_units = required_qty * factor
        s = ingredient_score(sub_avail.available_quantity, required_in_sub_units)
        s_penalised = s * (1.0 - float(sub.penalty_score))
        if s_penalised > best_score:
            best_score = s_penalised
            best_detail = IngredientMatchDetail(
                ingredient_id=ingredient_id,
                raw_name=raw_name,
                required_qty=required_in_sub_units,
                required_unit=sub_avail.unit,
                available_qty=sub_avail.available_quantity,
                score=round(s_penalised, 4),
                confidence=sub_avail.confidence,
                substitute_used=sub_avail.ingredient.canonical_name,
            )

    return best_detail if best_score > 0.0 else None


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
            # Check for a known substitute in the pantry before marking as hard_missing
            substitute_detail = await _check_substitutes(
                ingredient_id=ri.ingredient_id,
                raw_name=ri.raw_name,
                required_qty=required_qty,
                required_unit=required_unit,
                avail_map=avail_map,
                db=db,
            )
            if substitute_detail is not None:
                scores.append(substitute_detail.score)
                partial.append(substitute_detail)
                continue

            # Truly missing — no substitute available
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
    match_score_histogram.observe(recipe_score)

    return RecipeMatchResult(
        recipe=RecipeSummary.model_validate(recipe),
        score=round(recipe_score, 1),
        category=get_category(recipe_score),
        hard_missing=hard_missing,
        partial=partial,
        low_confidence=low_confidence,
        full=full,
    )


async def score_all_recipes_use_it_up(db: AsyncSession) -> list[RecipeMatchResult]:
    """
    Score recipes by how many at-risk (low-confidence) pantry ingredients they consume.
    Returns results sorted by urgency_score descending.
    """
    from pathlib import Path
    import yaml

    settings_path = Path(__file__).parent.parent.parent / "agent_config" / "agent_settings.yaml"
    with open(settings_path) as f:
        cfg = yaml.safe_load(f)
    threshold = float(cfg.get("use_it_up_confidence_threshold", 0.5))

    from app.services.pantry import get_available
    availability = await get_available(db)
    avail_map: dict[uuid.UUID, PantryAvailability] = {a.ingredient.id: a for a in availability}

    # Identify at-risk ingredients
    at_risk: dict[uuid.UUID, PantryAvailability] = {
        iid: a for iid, a in avail_map.items() if a.confidence < threshold
    }

    stmt = select(Recipe).options(selectinload(Recipe.ingredients))
    recipes = (await db.execute(stmt)).scalars().all()

    results = []
    for recipe in recipes:
        result = await score_recipe(recipe, avail_map, db)

        # Compute urgency: which at-risk ingredients does this recipe use?
        hits = [
            ri for ri in recipe.ingredients
            if ri.ingredient_id and ri.ingredient_id in at_risk
        ]
        if not hits:
            result.urgency_score = 0.0
            result.at_risk_ingredients = []
        else:
            # Urgency = sum of (required / pantry_total) for at-risk ingredients, normalised to 100
            urgency = sum(
                min(float(ri.quantity) / max(at_risk[ri.ingredient_id].total_quantity, 0.001), 1.0)
                for ri in hits
                if ri.ingredient_id
            )
            result.urgency_score = round(min(urgency / len(hits) * 100, 100.0), 1)
            result.at_risk_ingredients = [ri.raw_name for ri in hits]

        results.append(result)

    # Sort by number of at-risk ingredients used (desc), then urgency score (desc)
    results.sort(key=lambda r: (len(r.at_risk_ingredients), r.urgency_score), reverse=True)
    return results


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
