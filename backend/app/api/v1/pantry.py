"""
Pantry API — CRUD, confirmation, and availability endpoints.

Important: GET /available must be registered BEFORE GET /{id} so FastAPI
doesn't try to parse "available" as a UUID.
"""
import uuid
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.pantry import PantryItem
from app.schemas.pantry import (
    PantryAvailability,
    PantryItem as PantryItemSchema,
    PantryItemCreate,
    PantryItemUpdate,
)
from app.services.pantry import (
    confirm_pantry_item,
    delete_pantry_item,
    get_available,
    update_pantry_item,
    upsert_pantry_item,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/pantry", tags=["pantry"])


@router.get("/available", response_model=list[PantryAvailability])
async def list_available(db: AsyncSession = Depends(get_db)):
    """
    Return effective availability for every pantry item.
    Accounts for live confidence decay and active reservations.
    Use this endpoint — never read pantry_items.quantity directly.
    """
    return await get_available(db)


@router.get("/", response_model=list[PantryItemSchema])
async def list_pantry(db: AsyncSession = Depends(get_db)):
    """List all pantry items (raw quantities, without availability calculation)."""
    stmt = select(PantryItem).order_by(PantryItem.ingredient_id)
    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.post("/", response_model=PantryItemSchema, status_code=status.HTTP_201_CREATED)
async def add_pantry_item(body: PantryItemCreate, db: AsyncSession = Depends(get_db)):
    """
    Add a new pantry item or update the quantity for an existing ingredient.
    Upserting resets confidence to 1.0 (implies physical confirmation).
    """
    return await upsert_pantry_item(body, db)


@router.patch("/{item_id}", response_model=PantryItemSchema)
async def patch_pantry_item(
    item_id: uuid.UUID,
    body: PantryItemUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Partially update a pantry item (quantity, unit, confidence, or decay_rate)."""
    try:
        return await update_pantry_item(item_id, body, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/{item_id}/confirm", response_model=PantryItemSchema)
async def confirm_item(item_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """
    Confirm physical presence of an item — resets confidence to 1.0
    and updates last_confirmed_at. Use after physically checking the fridge/pantry.
    """
    try:
        return await confirm_pantry_item(item_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_pantry_item(item_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Remove a pantry item entirely."""
    try:
        await delete_pantry_item(item_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
