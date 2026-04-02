import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class CookingSessionCreate(BaseModel):
    recipe_id: uuid.UUID


class CookingSessionPatch(BaseModel):
    current_step: Optional[int] = None
    completed_steps: Optional[list[int]] = None
    # timers: { "<step_order>": { "remaining_seconds": int, "running": bool } }
    timers: Optional[dict] = None


class CookingSession(BaseModel):
    id: uuid.UUID
    recipe_id: uuid.UUID
    current_step: int
    completed_steps: list[int]
    timers: dict
    started_at: datetime
    ended_at: Optional[datetime] = None
    recipe_title: Optional[str] = None  # populated from joined recipe row

    model_config = {"from_attributes": True}
