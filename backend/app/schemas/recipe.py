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


class NutritionEstimate(BaseModel):
    """Nutrition information per serving.

    Fields follow the UK/EU standard nutrition label (energy, fat, saturates,
    carbohydrates, sugars, fibre, protein, salt).

    ``source`` discriminates between values read directly from a recipe card
    (``"card"``) and values estimated by the LLM from the ingredient list
    (``"estimated"``).  ``None`` means the source is unknown (legacy rows).
    """
    calories_kcal: Optional[float] = None
    protein_g: Optional[float] = None
    fat_g: Optional[float] = None
    saturates_g: Optional[float] = None   # of which saturates
    carbs_g: Optional[float] = None
    sugars_g: Optional[float] = None       # of which sugars
    fibre_g: Optional[float] = None
    salt_g: Optional[float] = None
    per_servings: Optional[int] = None
    source: Optional[str] = None           # "card" | "estimated" | None


class RecipeBase(BaseModel):
    title: str
    hello_fresh_style: Optional[int] = None
    cooking_time_mins: Optional[int] = None
    base_servings: int = 2
    source_type: SourceType = SourceType.HELLOFRESH
    source_reference: Optional[str] = None
    source_url: Optional[str] = None
    mood_tags: list[str] = []


class RecipeCreate(RecipeBase):
    ingredients: list[RecipeIngredientCreate] = []
    steps: list[StepCreate] = []
    nutrition: Optional[NutritionEstimate] = None  # extracted from card; None = estimate post-confirm


class RecipeIngredientUpdate(RecipeIngredientBase):
    pass


class StepUpdate(BaseModel):
    order: int
    text: str
    timer_seconds: Optional[int] = None


class RecipeUpdate(BaseModel):
    ingredients: Optional[list[RecipeIngredientUpdate]] = None
    steps: Optional[list[StepUpdate]] = None


class Recipe(RecipeBase):
    id: uuid.UUID
    hero_image_path: Optional[str] = None
    image_count: int = 1  # number of scanned images (1 = front only, 2 = front + back)
    created_at: datetime
    ingredients: list[RecipeIngredient] = []
    steps: list[Step] = []
    # Cook stats — populated by the GET /recipes/{id} handler
    total_cooks: int = 0
    average_rating: Optional[float] = None
    recent_notes: list[str] = []
    last_cooked_at: Optional[datetime] = None
    # Nutrition estimate — populated asynchronously after confirm
    nutrition_estimate: Optional[NutritionEstimate] = None

    model_config = {"from_attributes": True}


class RecipeSummary(BaseModel):
    """Lightweight recipe card for list views."""
    id: uuid.UUID
    title: str
    hero_image_path: Optional[str] = None
    cooking_time_mins: Optional[int] = None
    mood_tags: list[str] = []
    last_cooked_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
