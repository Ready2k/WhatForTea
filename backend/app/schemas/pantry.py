import uuid
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel

from app.models.pantry import ReservationType
from app.schemas.ingredient import Ingredient


class PantryItemBase(BaseModel):
    ingredient_id: uuid.UUID
    quantity: float
    unit: str
    confidence: float = 1.0
    decay_rate: float = 0.02
    expires_at: Optional[date] = None


class PantryItemCreate(PantryItemBase):
    pass


class PantryItemUpdate(BaseModel):
    quantity: Optional[float] = None
    unit: Optional[str] = None
    confidence: Optional[float] = None
    decay_rate: Optional[float] = None
    expires_at: Optional[date] = None


class PantryItem(PantryItemBase):
    id: uuid.UUID
    last_confirmed_at: datetime
    last_used_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class BulkPantryConfirmRequest(BaseModel):
    items: list[PantryItemCreate]


class PantryAvailability(BaseModel):
    """Result of GET /api/v1/pantry/available"""
    pantry_item_id: uuid.UUID
    ingredient: Ingredient
    total_quantity: float
    reserved_quantity: float
    available_quantity: float  # (total × confidence) - reserved
    confidence: float
    unit: str
    expires_at: Optional[date] = None


class PantryReservationBase(BaseModel):
    pantry_item_id: uuid.UUID
    recipe_id: uuid.UUID
    quantity: float
    reserved_for: ReservationType


class PantryReservation(PantryReservationBase):
    id: uuid.UUID
    created_at: datetime

    model_config = {"from_attributes": True}
