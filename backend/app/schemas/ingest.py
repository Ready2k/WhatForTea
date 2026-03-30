import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.ingest import IngestSourceType, IngestStatus
from app.schemas.recipe import RecipeCreate


class IngestJobCreate(BaseModel):
    source_type: IngestSourceType = IngestSourceType.HELLOFRESH


class IngestJob(BaseModel):
    id: uuid.UUID
    status: IngestStatus
    image_dir: str
    source_type: IngestSourceType
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class IngestStatusResponse(BaseModel):
    """Polling response for GET /api/v1/recipes/ingest/{job_id}/status"""
    job_id: uuid.UUID
    status: IngestStatus
    error_message: Optional[str] = None


class IngestReviewPayload(BaseModel):
    """
    The parsed recipe draft shown to the user for review.
    Returned when ingest_job.status == 'review'.
    """
    job_id: uuid.UUID
    parsed_recipe: RecipeCreate
    # List of raw ingredient names that could not be auto-resolved
    unresolved_ingredients: list[str] = []


class IngestConfirmRequest(BaseModel):
    """Body for POST /api/v1/recipes/ingest/confirm/{job_id}"""
    # The user-confirmed (possibly edited) recipe data
    recipe: RecipeCreate
