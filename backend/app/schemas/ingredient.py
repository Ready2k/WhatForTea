import uuid
from typing import Optional

from pydantic import BaseModel

from app.models.ingredient import IngredientCategory, IngredientDimension


class IngredientBase(BaseModel):
    canonical_name: str
    aliases: list[str] = []
    category: IngredientCategory
    dimension: IngredientDimension
    typical_unit: str
    count_to_mass_g: Optional[float] = None


class IngredientCreate(IngredientBase):
    pass


class IngredientUpdate(BaseModel):
    canonical_name: Optional[str] = None
    aliases: Optional[list[str]] = None
    category: Optional[IngredientCategory] = None
    dimension: Optional[IngredientDimension] = None
    typical_unit: Optional[str] = None
    count_to_mass_g: Optional[float] = None


class Ingredient(IngredientBase):
    id: uuid.UUID

    model_config = {"from_attributes": True}


class UnitConversionBase(BaseModel):
    from_unit: str
    to_unit: str
    factor: float


class UnitConversion(UnitConversionBase):
    id: int

    model_config = {"from_attributes": True}


# Used by POST /api/v1/ingredients/resolve
class ResolveRequest(BaseModel):
    raw_name: str


class ResolveResponse(BaseModel):
    ingredient: Ingredient
    confidence: float
    # Where the match came from
    source: str  # "lookup" | "fuzzy" | "llm" | "new"


# Used by POST /api/v1/ingredients/override
class OverrideRequest(BaseModel):
    raw_name: str
    canonical_id: uuid.UUID
