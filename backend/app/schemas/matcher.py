"""
Schemas for the Hangry Matcher — recipe scoring against current pantry.
"""
import uuid
from typing import Literal, Optional

from pydantic import BaseModel

from app.schemas.recipe import RecipeSummary


class IngredientMatchDetail(BaseModel):
    """Per-ingredient breakdown within a recipe match result."""
    ingredient_id: Optional[uuid.UUID]
    raw_name: str
    required_qty: float
    required_unit: Optional[str]
    available_qty: float    # 0.0 if not in pantry
    score: float            # 0.0–1.0
    confidence: float       # pantry item live confidence; 0.0 if not in pantry
    substitute_used: Optional[str] = None  # canonical name of substitute ingredient, if any


class RecipeMatchResult(BaseModel):
    """Score + ingredient breakdown for one recipe."""
    recipe: RecipeSummary
    score: float            # 0.0–100.0
    category: Literal["cook_now", "almost_there", "planner"]

    # Ingredient breakdowns — a given ingredient appears in exactly one list
    hard_missing: list[IngredientMatchDetail]   # score == 0.0
    partial: list[IngredientMatchDetail]         # 0 < score < 1.0
    low_confidence: list[IngredientMatchDetail]  # score >= 1.0 but confidence < 0.7
    full: list[IngredientMatchDetail]            # score == 1.0 and confidence >= 0.7

    # "Use it up" fields — populated only when sort=use_it_up
    urgency_score: float = 0.0           # 0–100, how well this recipe uses at-risk items
    at_risk_ingredients: list[str] = []  # names of at-risk ingredients this recipe uses
