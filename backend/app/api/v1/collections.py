"""
Collections API — recipe folders/groupings.

Endpoints:
  GET    /api/v1/collections                       list all collections (with recipe count)
  POST   /api/v1/collections                       create a collection
  PATCH  /api/v1/collections/{id}                  rename / recolour
  DELETE /api/v1/collections/{id}                  delete (does not delete recipes)
  GET    /api/v1/collections/{id}/recipe-ids       compact list of recipe UUIDs in collection
  POST   /api/v1/collections/{id}/recipes/{rid}    add recipe to collection
  DELETE /api/v1/collections/{id}/recipes/{rid}    remove recipe from collection
"""
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.collection import Collection as CollectionModel
from app.models.recipe import Recipe
from app.schemas.collection import (
    Collection as CollectionSchema,
    CollectionCreate,
    CollectionRecipeIds,
    CollectionUpdate,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/collections", tags=["collections"])


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_collection(collection_id: uuid.UUID, db: AsyncSession) -> CollectionModel:
    stmt = (
        select(CollectionModel)
        .options(selectinload(CollectionModel.recipes))
        .where(CollectionModel.id == collection_id)
    )
    col = (await db.execute(stmt)).scalar_one_or_none()
    if col is None:
        raise HTTPException(status_code=404, detail="Collection not found")
    return col


def _to_schema(col: CollectionModel) -> CollectionSchema:
    return CollectionSchema(
        id=col.id,
        name=col.name,
        colour=col.colour,
        created_at=col.created_at,
        recipe_count=len(col.recipes),
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[CollectionSchema])
async def list_collections(db: AsyncSession = Depends(get_db)):
    """List all collections with recipe counts, ordered by name."""
    stmt = (
        select(CollectionModel)
        .options(selectinload(CollectionModel.recipes))
        .order_by(CollectionModel.name)
    )
    cols = (await db.execute(stmt)).scalars().all()
    return [_to_schema(c) for c in cols]


@router.post("", response_model=CollectionSchema, status_code=status.HTTP_201_CREATED)
async def create_collection(body: CollectionCreate, db: AsyncSession = Depends(get_db)):
    """Create a new collection. Name must be unique."""
    existing = (await db.execute(
        select(CollectionModel).where(CollectionModel.name == body.name)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail=f"Collection '{body.name}' already exists")

    col = CollectionModel(name=body.name, colour=body.colour)
    db.add(col)
    await db.commit()
    await db.refresh(col)
    # Load relationships for recipe_count
    await db.refresh(col, attribute_names=["recipes"])
    logger.info("collection created", extra={"name": col.name, "id": str(col.id)})
    return _to_schema(col)


@router.patch("/{collection_id}", response_model=CollectionSchema)
async def update_collection(
    collection_id: uuid.UUID,
    body: CollectionUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Rename or recolour a collection."""
    col = await _get_collection(collection_id, db)
    if body.name is not None:
        col.name = body.name
    if body.colour is not None:
        col.colour = body.colour
    await db.commit()
    await db.refresh(col)
    await db.refresh(col, attribute_names=["recipes"])
    return _to_schema(col)


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_collection(collection_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Delete a collection. Recipes are not deleted."""
    col = await _get_collection(collection_id, db)
    await db.delete(col)
    await db.commit()
    logger.info("collection deleted", extra={"id": str(collection_id)})


@router.get("/{collection_id}/recipe-ids", response_model=CollectionRecipeIds)
async def get_collection_recipe_ids(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Return just the recipe UUIDs in this collection (for client-side filtering)."""
    col = await _get_collection(collection_id, db)
    return CollectionRecipeIds(
        collection_id=col.id,
        recipe_ids=[r.id for r in col.recipes],
    )


@router.post(
    "/{collection_id}/recipes/{recipe_id}",
    response_model=CollectionSchema,
    status_code=status.HTTP_200_OK,
)
async def add_recipe_to_collection(
    collection_id: uuid.UUID,
    recipe_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Add a recipe to a collection (idempotent)."""
    col = await _get_collection(collection_id, db)
    recipe = await db.get(Recipe, recipe_id)
    if recipe is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if recipe not in col.recipes:
        col.recipes.append(recipe)
        await db.commit()
        await db.refresh(col, attribute_names=["recipes"])
    return _to_schema(col)


@router.delete(
    "/{collection_id}/recipes/{recipe_id}",
    response_model=CollectionSchema,
    status_code=status.HTTP_200_OK,
)
async def remove_recipe_from_collection(
    collection_id: uuid.UUID,
    recipe_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Remove a recipe from a collection."""
    col = await _get_collection(collection_id, db)
    col.recipes = [r for r in col.recipes if r.id != recipe_id]
    await db.commit()
    await db.refresh(col, attribute_names=["recipes"])
    return _to_schema(col)
