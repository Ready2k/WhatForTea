import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.recipe import SourceType


class StepBase(BaseModel):
    order: int
    text: str
    timer_seconds: Optional[int] = None
    image_description: Optional[str] = None
    # image_crop_path intentionally excluded from create/response — not populated in v1


class StepCreate(StepBase):
    pass


class Step(StepBase):
    id: int
    recipe_id: uuid.UUID
    image_crop_path: Optional[str] = None

    model_config = {"from_attributes": True}


class RecipeIngredientBase(BaseModel):
    raw_name: str
    quantity: float
    unit: Optional[str] = None
    servings_quantities: Optional[dict[str, float]] = None


class RecipeIngredientCreate(RecipeIngredientBase):
    ingredient_id: Optional[uuid.UUID] = None  # resolved by normaliser


class RecipeIngredient(RecipeIngredientBase):
    id: uuid.UUID
    recipe_id: uuid.UUID
    ingredient_id: Optional[uuid.UUID] = None
    normalized_quantity: Optional[float] = None
    normalized_unit: Optional[str] = None

    model_config = {"from_attributes": True}


class RecipeBase(BaseModel):
    title: str
    hello_fresh_style: Optional[int] = None
    cooking_time_mins: Optional[int] = None
    base_servings: int = 2
    source_type: SourceType = SourceType.HELLOFRESH
    source_reference: Optional[str] = None
    mood_tags: list[str] = []


class RecipeCreate(RecipeBase):
    ingredients: list[RecipeIngredientCreate] = []
    steps: list[StepCreate] = []


class Recipe(RecipeBase):
    id: uuid.UUID
    hero_image_path: Optional[str] = None
    created_at: datetime
    ingredients: list[RecipeIngredient] = []
    steps: list[Step] = []

    model_config = {"from_attributes": True}


class RecipeSummary(BaseModel):
    """Lightweight recipe card for list views."""
    id: uuid.UUID
    title: str
    hero_image_path: Optional[str] = None
    cooking_time_mins: Optional[int] = None
    mood_tags: list[str] = []

    model_config = {"from_attributes": True}
