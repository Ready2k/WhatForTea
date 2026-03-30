import uuid
from datetime import date, datetime

from pydantic import BaseModel

from app.schemas.recipe import RecipeSummary


class MealPlanEntryBase(BaseModel):
    day_of_week: int  # 0 = Monday, 6 = Sunday
    recipe_id: uuid.UUID


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
    ingredient_id: uuid.UUID
    canonical_name: str
    quantity: float
    unit: str
    # How many packs to buy after smart rounding
    rounded_quantity: float
    rounded_unit: str


class ShoppingList(BaseModel):
    """Result of GET /api/v1/planner/shopping-list"""
    zones: dict[str, list[ShoppingListItem]]  # zone name → items
