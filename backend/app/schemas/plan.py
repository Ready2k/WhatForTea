import uuid
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel

from app.schemas.recipe import RecipeSummary


class MealPlanEntryBase(BaseModel):
    day_of_week: int  # 0 = Monday, 6 = Sunday
    recipe_id: uuid.UUID
    servings: Optional[int] = None  # None = use recipe.base_servings


class MealPlanEntryCreate(MealPlanEntryBase):
    pass


class MealPlanEntry(MealPlanEntryBase):
    id: uuid.UUID
    meal_plan_id: uuid.UUID
    recipe: RecipeSummary

    model_config = {"from_attributes": True}


class MealPlanCreate(BaseModel):
    week_start: date
    entries: list[MealPlanEntryCreate] = []


class MealPlan(BaseModel):
    id: uuid.UUID
    week_start: date
    created_at: datetime
    entries: list[MealPlanEntry] = []

    model_config = {"from_attributes": True}


class ShoppingListItem(BaseModel):
    ingredient_id: Optional[uuid.UUID] = None
    canonical_name: str
    quantity: float        # exact shortfall
    unit: str
    rounded_quantity: float  # rounded up to nearest pack size
    rounded_unit: str
    is_unresolved: bool = False  # True if ingredient was not normalised to DB canonical


class ShoppingList(BaseModel):
    """Result of GET /api/v1/planner/shopping-list"""
    zones: dict[str, list[ShoppingListItem]]  # e.g. "Fridge & Fresh" → items
    text_export: str = ""     # plain-text version for copy/paste
    whatsapp_url: str = ""    # whatsapp://send?text=... deep-link
