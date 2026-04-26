"""
Ingredient API — normalisation and override endpoints.

All routes prefixed /api/v1/ via the router include in main.py.
"""
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.errors import AppError, ErrorCode
from app.schemas.ingredient import (
    Ingredient as IngredientSchema,
    IngredientCreate,
    OverrideRequest,
    ResolveRequest,
    ResolveResponse,
)
from app.services.normaliser import apply_override, resolve_ingredient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/ingredients", tags=["ingredients"])


@router.post("/resolve", response_model=ResolveResponse)
async def resolve(
    body: ResolveRequest,
    db: AsyncSession = Depends(get_db),
) -> ResolveResponse:
    """
    Resolve a raw ingredient name to a canonical Ingredient record.

    Runs the 4-layer pipeline: lookup → fuzzy → LLM → unresolved.
    Returns confidence and the resolution source so the UI can decide
    whether to show the result or prompt the user to confirm.
    """
    result = await resolve_ingredient(
        raw_name=body.raw_name,
        db=db,
        redis_client=None,  # Redis wired in Phase 4 via app state
        use_llm=True,
    )

    if result.ingredient is None:
        raise AppError(
            code=ErrorCode.INGREDIENT_UNRESOLVED,
            message="Ingredient could not be resolved with sufficient confidence",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details={
                "raw_name": body.raw_name,
                "confidence": result.confidence,
            },
        )

    return ResolveResponse(
        ingredient=IngredientSchema.model_validate(result.ingredient),
        confidence=result.confidence,
        source=result.source.value,
    )


@router.post("/override", response_model=IngredientSchema)
async def override(
    body: OverrideRequest,
    db: AsyncSession = Depends(get_db),
) -> IngredientSchema:
    """
    Persist a user-supplied mapping: raw_name → canonical ingredient.
    Appends raw_name to ingredient.aliases so future lookups will hit Layer 1.
    """
    try:
        ingredient = await apply_override(
            raw_name=body.raw_name,
            canonical_id=body.canonical_id,
            db=db,
        )
    except ValueError as exc:
        raise AppError(
            code=ErrorCode.INGREDIENT_NOT_FOUND,
            message=str(exc),
            status_code=status.HTTP_404_NOT_FOUND,
        )

    return IngredientSchema.model_validate(ingredient)


@router.post("", response_model=IngredientSchema, status_code=status.HTTP_201_CREATED)
async def create_ingredient(
    body: IngredientCreate,
    db: AsyncSession = Depends(get_db),
) -> IngredientSchema:
    """Create a new canonical ingredient."""
    from sqlalchemy import select
    from app.models.ingredient import Ingredient

    # Reject duplicates (case-insensitive — canonical names are always stored lowercase)
    canonical = body.canonical_name.strip().lower()
    existing = (
        await db.execute(select(Ingredient).where(Ingredient.canonical_name == canonical))
    ).scalar_one_or_none()
    if existing:
        return IngredientSchema.model_validate(existing)

    data = body.model_dump()
    data["canonical_name"] = canonical
    ingredient = Ingredient(**data)
    db.add(ingredient)
    await db.commit()
    await db.refresh(ingredient)
    logger.info("ingredient created", extra={"ingredient_id": str(ingredient.id), "canonical_name": ingredient.canonical_name})
    return IngredientSchema.model_validate(ingredient)


@router.get("", response_model=list[IngredientSchema])
async def list_ingredients(
    q: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
) -> list[IngredientSchema]:
    """List canonical ingredients. Pass ?q= to filter by name (case-insensitive substring)."""
    from sqlalchemy import select
    from app.models.ingredient import Ingredient

    stmt = select(Ingredient).order_by(Ingredient.canonical_name)
    if q:
        stmt = stmt.where(Ingredient.canonical_name.ilike(f"%{q}%"))
    result = await db.execute(stmt)
    return [IngredientSchema.model_validate(i) for i in result.scalars().all()]


@router.get("/{ingredient_id}", response_model=IngredientSchema)
async def get_ingredient(
    ingredient_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> IngredientSchema:
    """Get a single ingredient by ID."""
    from app.models.ingredient import Ingredient

    ingredient = await db.get(Ingredient, ingredient_id)
    if ingredient is None:
        raise AppError(
            code=ErrorCode.INGREDIENT_NOT_FOUND,
            message=f"Ingredient {ingredient_id} not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return IngredientSchema.model_validate(ingredient)
