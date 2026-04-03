import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator


class CookingSessionCreate(BaseModel):
    recipe_id: uuid.UUID


class CookingSessionPatch(BaseModel):
    current_step: Optional[int] = None
    completed_steps: Optional[list[int]] = None
    timers: Optional[dict] = None
    notes: Optional[str] = None
    rating: Optional[int] = None

    @field_validator("rating")
    @classmethod
    def rating_range(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (1 <= v <= 5):
            raise ValueError("rating must be between 1 and 5")
        return v


class CookingSessionEnd(BaseModel):
    confirmed: bool = False
    servings_cooked: Optional[int] = None


class CookingSession(BaseModel):
    id: uuid.UUID
    recipe_id: uuid.UUID
    current_step: int
    completed_steps: list[int]
    timers: dict
    confirmed_cook: bool = False
    servings_cooked: Optional[int] = None
    notes: Optional[str] = None
    rating: Optional[int] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    recipe_title: Optional[str] = None  # populated from joined recipe row

    model_config = {"from_attributes": True}
