"""
Recipe API — ingestion upload, status polling, review, confirm, and list endpoints.

Ingest flow:
  POST /ingest              → upload images, queue job, return job_id
  GET  /ingest/{id}/status  → poll for QUEUED / PROCESSING / REVIEW / COMPLETE / FAILED
  GET  /ingest/{id}/review  → fetch parsed recipe draft for user confirmation
  POST /ingest/confirm/{id} → submit confirmed (possibly edited) recipe → insert to DB
"""
import logging
import urllib.parse
import uuid
from pathlib import Path

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.ingest import IngestJob, IngestStatus, LlmOutput
from app.models.recipe import Recipe
from app.schemas.ingest import (
    IngestConfirmRequest,
    IngestReviewPayload,
    IngestStatusResponse,
)
from app.schemas.recipe import Recipe as RecipeSchema, RecipeCreate, RecipeSummary
from app.services.ingestion import confirm_recipe, save_images

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/recipes", tags=["recipes"])

_RECIPES_DIR = Path("/data/recipes")


def _redis_settings() -> RedisSettings:
    parsed = urllib.parse.urlparse(settings.redis_url)
    return RedisSettings(
        host=parsed.hostname or "localhost",
        port=parsed.port or 6379,
        password=parsed.password,
        database=int(parsed.path.lstrip("/") or "0"),
    )


# ── Ingest ────────────────────────────────────────────────────────────────────

@router.post("/ingest", status_code=status.HTTP_202_ACCEPTED)
async def ingest_recipe(
    images: list[UploadFile] = File(..., description="1 or 2 recipe card images (JPEG/PNG)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload recipe card image(s). Saves images to disk, creates an IngestJob,
    and enqueues background LLM processing. Returns the job_id for polling.
    """
    if not images:
        raise HTTPException(status_code=400, detail="At least one image is required")
    if len(images) > 2:
        raise HTTPException(status_code=400, detail="Maximum 2 images per recipe card")

    # Create the DB record first to get a job_id for the image directory name
    job = IngestJob(image_dir="")  # placeholder; updated after images are saved
    db.add(job)
    await db.flush()

    job_dir = await save_images(images, job.id, _RECIPES_DIR)
    job.image_dir = str(job_dir)
    await db.commit()

    # Enqueue the arq background task
    try:
        pool = await create_pool(_redis_settings())
        await pool.enqueue_job("task_process_ingest_job", str(job.id))
        await pool.aclose()
    except Exception as exc:
        logger.error(
            "failed to enqueue ingest job",
            extra={"job_id": str(job.id), "error": str(exc)},
        )
        job.status = IngestStatus.FAILED
        job.error_message = f"Queue error: {exc}"
        await db.commit()
        raise HTTPException(status_code=503, detail="Job queue unavailable") from exc

    logger.info("ingest job queued", extra={"job_id": str(job.id)})
    return {"job_id": str(job.id)}


@router.get("/ingest/{job_id}/status", response_model=IngestStatusResponse)
async def get_ingest_status(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Poll the processing status of an ingest job."""
    job = await db.get(IngestJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Ingest job not found")
    return IngestStatusResponse(
        job_id=job.id,
        status=job.status,
        error_message=job.error_message,
    )


@router.get("/ingest/{job_id}/review", response_model=IngestReviewPayload)
async def get_ingest_review(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Return the parsed recipe draft for user review.
    Only available once the job status is 'review'.
    """
    job = await db.get(IngestJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Ingest job not found")
    if job.status != IngestStatus.REVIEW:
        raise HTTPException(
            status_code=409,
            detail=f"Job is not ready for review (current status: {job.status.value!r})",
        )

    stmt = (
        select(LlmOutput)
        .where(LlmOutput.ingest_job_id == job_id)
        .order_by(LlmOutput.created_at.desc())
        .limit(1)
    )
    llm_out = (await db.execute(stmt)).scalar_one_or_none()
    if llm_out is None:
        raise HTTPException(status_code=500, detail="LLM output not found for job")

    parsed = llm_out.parsed_result
    unresolved = parsed.get("unresolved_ingredients", [])

    recipe_create = RecipeCreate(
        title=parsed.get("title", ""),
        cooking_time_mins=parsed.get("cooking_time_mins"),
        hello_fresh_style=parsed.get("hello_fresh_style"),
        base_servings=parsed.get("base_servings", 2),
        mood_tags=parsed.get("mood_tags", []),
        ingredients=[
            {
                "raw_name": ing["raw_name"],
                "quantity": ing["quantity"],
                "unit": ing.get("unit"),
                "ingredient_id": ing.get("ingredient_id"),
            }
            for ing in parsed.get("ingredients", [])
        ],
        steps=[
            {
                "order": step["order"],
                "text": step["text"],
                "timer_seconds": step.get("timer_seconds"),
            }
            for step in parsed.get("steps", [])
        ],
    )

    return IngestReviewPayload(
        job_id=job_id,
        parsed_recipe=recipe_create,
        unresolved_ingredients=unresolved,
    )


@router.post(
    "/ingest/confirm/{job_id}",
    response_model=RecipeSchema,
    status_code=status.HTTP_201_CREATED,
)
async def confirm_ingest(
    job_id: uuid.UUID,
    body: IngestConfirmRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Confirm the parsed recipe (optionally edited) and insert it into the database.
    All ingredients must have ingredient_id set; return 422 for unresolved ones.
    """
    try:
        recipe = await confirm_recipe(job_id=job_id, recipe_data=body.recipe, db=db)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return recipe


# ── Recipe list / detail ──────────────────────────────────────────────────────

@router.get("", response_model=list[RecipeSummary])
async def list_recipes(
    db: AsyncSession = Depends(get_db),
    skip: int = 0,
    limit: int = 50,
):
    """List all recipes (lightweight summary cards), newest first."""
    stmt = select(Recipe).order_by(Recipe.created_at.desc()).offset(skip).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.get("/{recipe_id}", response_model=RecipeSchema)
async def get_recipe(
    recipe_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Fetch a single recipe with full ingredients and steps."""
    from sqlalchemy.orm import selectinload
    stmt = (
        select(Recipe)
        .options(selectinload(Recipe.ingredients), selectinload(Recipe.steps))
        .where(Recipe.id == recipe_id)
    )
    recipe = (await db.execute(stmt)).scalar_one_or_none()
    if recipe is None:
        raise HTTPException(status_code=404, detail="Recipe not found")

    # Count how many scanned images exist so the frontend can show a flip button
    image_count = 1
    if recipe.hero_image_path:
        img_dir = Path(recipe.hero_image_path).parent
        if img_dir.exists():
            image_count = len(list(img_dir.glob("image_*")))

    result = RecipeSchema.model_validate(recipe)
    result.image_count = image_count
    return result


@router.delete("/{recipe_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_recipe(
    recipe_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete a recipe and its associated images."""
    from app.models.plan import MealPlanEntry
    from app.models.pantry import PantryReservation

    recipe = await db.get(Recipe, recipe_id)
    if recipe is None:
        raise HTTPException(status_code=404, detail="Recipe not found")

    # Remove pantry reservations that reference this recipe
    res_stmt = select(PantryReservation).where(PantryReservation.recipe_id == recipe_id)
    for res in (await db.execute(res_stmt)).scalars().all():
        await db.delete(res)

    # Remove meal plan entries that reference this recipe
    entry_stmt = select(MealPlanEntry).where(MealPlanEntry.recipe_id == recipe_id)
    for entry in (await db.execute(entry_stmt)).scalars().all():
        await db.delete(entry)

    await db.flush()

    # Delete image directory if it exists
    if recipe.hero_image_path:
        image_dir = Path(recipe.hero_image_path).parent
        if image_dir.exists() and image_dir.is_dir():
            import shutil
            shutil.rmtree(image_dir, ignore_errors=True)

    await db.delete(recipe)
    await db.commit()
    logger.info("recipe deleted", extra={"recipe_id": str(recipe_id)})


@router.get("/{recipe_id}/image")
async def get_recipe_image(
    recipe_id: uuid.UUID,
    index: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """
    Serve a scanned recipe card image by index.
    index=0 → front (hero), index=1 → back of card.
    """
    recipe = await db.get(Recipe, recipe_id)
    if recipe is None or not recipe.hero_image_path:
        raise HTTPException(status_code=404, detail="Image not found")

    if index == 0:
        path = Path(recipe.hero_image_path)
    else:
        # Derive the image directory from hero_image_path and find the nth image
        img_dir = Path(recipe.hero_image_path).parent
        all_images = sorted(img_dir.glob("image_*"))
        if index >= len(all_images):
            raise HTTPException(status_code=404, detail=f"Image index {index} not found")
        path = all_images[index]

    if not path.exists():
        raise HTTPException(status_code=404, detail="Image file not found")
    return FileResponse(path)
