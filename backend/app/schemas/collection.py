import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class CollectionCreate(BaseModel):
    name: str
    colour: str = "#10b981"


class CollectionUpdate(BaseModel):
    name: Optional[str] = None
    colour: Optional[str] = None


class Collection(BaseModel):
    id: uuid.UUID
    name: str
    colour: str
    created_at: datetime
    recipe_count: int = 0

    model_config = {"from_attributes": True}


class CollectionRecipeIds(BaseModel):
    """Compact response for GET /collections/{id}/recipe-ids"""
    collection_id: uuid.UUID
    recipe_ids: list[uuid.UUID]
