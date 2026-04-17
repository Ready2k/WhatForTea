"""
Nutrition estimation service.

Estimates macro-nutrients for a recipe using Claude via Bedrock.
Triggered as an arq background task after confirm_recipe().
Results are stored in recipes.nutrition_estimate (JSONB).
"""
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.recipe import Recipe

logger = logging.getLogger(__name__)


async def estimate_nutrition(recipe_id: uuid.UUID, db: AsyncSession) -> dict | None:
    """
    Estimate and persist macro-nutrients for a recipe.
    Returns the nutrition dict, or None if estimation fails.
    Safe to call multiple times — overwrites previous estimate.
    """
    recipe = await db.get(Recipe, recipe_id)
    if recipe is None:
        logger.error("recipe not found for nutrition estimate", extra={"recipe_id": str(recipe_id)})
        return None

    ingredients = [
        {
            "raw_name": ri.raw_name,
            "quantity": float(ri.quantity),
            "unit": ri.unit or "",
        }
        for ri in recipe.ingredients
    ]
    if not ingredients:
        logger.info("no ingredients — skipping nutrition estimate", extra={"recipe_id": str(recipe_id)})
        return None

    try:
        from app.services.bedrock import call_nutrition_llm
        nutrition = await call_nutrition_llm(
            title=recipe.title,
            ingredients=ingredients,
            base_servings=recipe.base_servings or 2,
        )
        recipe.nutrition_estimate = nutrition
        recipe.nutrition_estimated_at = datetime.now(timezone.utc)
        await db.commit()
        logger.info(
            "nutrition estimate saved",
            extra={"recipe_id": str(recipe_id), "calories": nutrition.get("calories_kcal")},
        )
        return nutrition
    except Exception as exc:
        logger.warning(
            "nutrition estimation failed",
            extra={"recipe_id": str(recipe_id), "error": str(exc)},
        )
        return None
