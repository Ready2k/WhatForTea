"""
Pantry Intelligence service.

Responsibilities:
  - CRUD for pantry items (upsert by ingredient_id)
  - Confidence decay: recalculates from last_confirmed_at each day
  - Availability query: (quantity × confidence) − reservations, floored at 0
  - Consumption: deducts recipe ingredients after a cooking session completes

Downstream systems (matcher, planner, shopping list) must use get_available()
and never read pantry_items.quantity directly.
"""
import logging
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.metrics import pantry_item_count
from app.models.ingredient import UnitConversion
from app.models.pantry import PantryItem, PantryReservation
from app.models.recipe import Recipe
from app.schemas.pantry import PantryAvailability, PantryItemCreate, PantryItemUpdate

logger = logging.getLogger(__name__)


# ── Confidence helpers ────────────────────────────────────────────────────────

# Estimated total shelf life in days by ingredient category.
# Used when expires_at is set: confidence = remaining_days / shelf_life
_SHELF_LIFE_BY_CATEGORY: dict[str, int] = {
    "produce": 7,
    "dairy": 14,
    "meat": 3,
    "fish": 3,
    "bakery": 7,
    "pantry": 365,
    "spice": 730,
    "other": 30,
}


def calculate_confidence(
    decay_rate: float,
    last_confirmed_at: datetime,
    now: Optional[datetime] = None,
    expires_at: Optional[date] = None,
    ingredient_category: Optional[str] = None,
) -> float:
    """
    Pure function: recalculate confidence.

    When expires_at is set:
      confidence = max(0, remaining_days / shelf_life_for_category)
      This is more accurate than time-decay for fresh items with a known best-before date.

    Otherwise falls back to the linear decay model:
      confidence = max(0, 1 - decay_rate * days_since_confirmed)
    """
    if now is None:
        now = datetime.now(timezone.utc)

    if expires_at is not None:
        today = now.date()
        days_remaining = (expires_at - today).days
        if days_remaining <= 0:
            return 0.0
        shelf_life = _SHELF_LIFE_BY_CATEGORY.get(ingredient_category or "other", 30)
        return max(0.0, min(1.0, days_remaining / shelf_life))

    # Fall back to time-decay model
    if last_confirmed_at.tzinfo is None:
        last_confirmed_at = last_confirmed_at.replace(tzinfo=timezone.utc)
    days = (now - last_confirmed_at).total_seconds() / 86400
    return max(0.0, min(1.0, 1.0 - decay_rate * days))


# ── CRUD ──────────────────────────────────────────────────────────────────────

async def upsert_pantry_item(data: PantryItemCreate, db: AsyncSession) -> PantryItem:
    """
    Add a new pantry item or update an existing one for the same ingredient.
    When updating, quantity and unit are replaced; confidence resets to 1.0
    (the user is implicitly confirming by setting a new quantity).
    """
    stmt = select(PantryItem).where(PantryItem.ingredient_id == data.ingredient_id)
    existing = (await db.execute(stmt)).scalar_one_or_none()

    if existing:
        existing.quantity = data.quantity
        existing.unit = data.unit
        existing.confidence = 1.0
        existing.decay_rate = data.decay_rate
        existing.last_confirmed_at = datetime.now(timezone.utc)
        existing.expires_at = data.expires_at
        await db.commit()
        await db.refresh(existing)
        return existing

    item = PantryItem(
        ingredient_id=data.ingredient_id,
        quantity=data.quantity,
        unit=data.unit,
        confidence=data.confidence,
        decay_rate=data.decay_rate,
        last_confirmed_at=datetime.now(timezone.utc),
        expires_at=data.expires_at,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def update_pantry_item(
    item_id: uuid.UUID,
    data: PantryItemUpdate,
    db: AsyncSession,
) -> PantryItem:
    """Partial update. Raises ValueError if item not found."""
    item = await db.get(PantryItem, item_id)
    if item is None:
        raise ValueError(f"PantryItem {item_id} not found")

    if data.quantity is not None:
        item.quantity = data.quantity
    if data.unit is not None:
        item.unit = data.unit
    if data.confidence is not None:
        item.confidence = max(0.0, min(1.0, data.confidence))
    if data.decay_rate is not None:
        item.decay_rate = data.decay_rate
    if data.expires_at is not None:
        item.expires_at = data.expires_at

    await db.commit()
    await db.refresh(item)
    return item


async def confirm_pantry_item(item_id: uuid.UUID, db: AsyncSession) -> PantryItem:
    """
    Mark the item as physically confirmed: resets confidence to 1.0
    and updates last_confirmed_at. Equivalent to "I just checked the fridge."
    """
    item = await db.get(PantryItem, item_id)
    if item is None:
        raise ValueError(f"PantryItem {item_id} not found")

    item.confidence = 1.0
    item.last_confirmed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(item)
    logger.info("pantry item confirmed", extra={"item_id": str(item_id)})
    return item


async def bulk_confirm_pantry(items: list[PantryItemCreate], db: AsyncSession) -> list[PantryItem]:
    """
    Upsert multiple pantry items in a single transaction.
    Used by the shopping list "Mark as bought" batch action.
    Returns the upserted items.
    """
    results = []
    for item_data in items:
        stmt = select(PantryItem).where(PantryItem.ingredient_id == item_data.ingredient_id)
        existing = (await db.execute(stmt)).scalar_one_or_none()
        if existing:
            existing.quantity = item_data.quantity
            existing.unit = item_data.unit
            existing.confidence = 1.0
            existing.decay_rate = item_data.decay_rate
            existing.last_confirmed_at = datetime.now(timezone.utc)
            if item_data.expires_at is not None:
                existing.expires_at = item_data.expires_at
            results.append(existing)
        else:
            item = PantryItem(
                ingredient_id=item_data.ingredient_id,
                quantity=item_data.quantity,
                unit=item_data.unit,
                confidence=1.0,
                decay_rate=item_data.decay_rate,
                last_confirmed_at=datetime.now(timezone.utc),
                expires_at=item_data.expires_at,
            )
            db.add(item)
            results.append(item)
    await db.commit()
    for item in results:
        await db.refresh(item)
    return results


async def get_expiring_soon(db: AsyncSession, days: int = 3) -> list[PantryItem]:
    """
    Return pantry items with expires_at within the next `days` days (inclusive).
    Items already expired (expires_at < today) are also included (days_remaining <= 0).
    Ordered by expires_at ascending.
    """
    from sqlalchemy import and_

    today = datetime.now(timezone.utc).date()
    cutoff = date.fromordinal(today.toordinal() + days)

    stmt = (
        select(PantryItem)
        .options(selectinload(PantryItem.ingredient))
        .where(
            and_(
                PantryItem.expires_at.is_not(None),
                PantryItem.expires_at <= cutoff,
            )
        )
        .order_by(PantryItem.expires_at.asc())
    )
    return list((await db.execute(stmt)).scalars().all())


async def delete_pantry_item(item_id: uuid.UUID, db: AsyncSession) -> None:
    """Delete a pantry item. Raises ValueError if not found."""
    item = await db.get(PantryItem, item_id)
    if item is None:
        raise ValueError(f"PantryItem {item_id} not found")
    await db.delete(item)
    await db.commit()


# ── Availability ──────────────────────────────────────────────────────────────

async def get_available(db: AsyncSession) -> list[PantryAvailability]:
    """
    Compute availability for every pantry item:
      available = max(0, quantity × confidence − sum(reservations))

    This is the canonical view for the matcher, planner, and shopping list.
    """
    stmt = (
        select(PantryItem)
        .options(
            selectinload(PantryItem.ingredient),
            selectinload(PantryItem.reservations),
        )
    )
    items = (await db.execute(stmt)).scalars().all()
    pantry_item_count.set(len(items))

    now = datetime.now(timezone.utc)
    result = []
    for item in items:
        live_confidence = calculate_confidence(
            item.decay_rate,
            item.last_confirmed_at,
            now,
            expires_at=item.expires_at,
            ingredient_category=item.ingredient.category if item.ingredient else None,
        )
        effective = float(item.quantity) * live_confidence
        reserved = sum(float(r.quantity) for r in item.reservations)
        available = max(0.0, effective - reserved)

        result.append(PantryAvailability(
            pantry_item_id=item.id,
            ingredient=item.ingredient,
            total_quantity=float(item.quantity),
            reserved_quantity=reserved,
            available_quantity=available,
            confidence=live_confidence,
            unit=item.unit,
            expires_at=item.expires_at,
        ))

    return result


# ── Decay scheduler job ───────────────────────────────────────────────────────

async def apply_decay_all(db: AsyncSession) -> int:
    """
    Recalculate confidence for every pantry item based on days since last
    confirmation. Returns the number of items updated.

    Called by APScheduler daily at 03:00. Safe to run multiple times (idempotent).
    """
    stmt = select(PantryItem).options(selectinload(PantryItem.ingredient))
    items = (await db.execute(stmt)).scalars().all()

    now = datetime.now(timezone.utc)
    count = 0
    for item in items:
        new_conf = calculate_confidence(
            item.decay_rate,
            item.last_confirmed_at,
            now,
            expires_at=item.expires_at,
            ingredient_category=item.ingredient.category if item.ingredient else None,
        )
        if abs(new_conf - item.confidence) > 0.0001:
            item.confidence = new_conf
            count += 1

    await db.commit()
    logger.info("pantry decay applied", extra={"items_updated": count})
    return count


# ── Consumption ───────────────────────────────────────────────────────────────

async def _get_conversion_factor(
    from_unit: str,
    to_unit: str,
    db: AsyncSession,
) -> Optional[float]:
    """Look up conversion factor from unit_conversions table. Returns None if not found."""
    if from_unit.lower() == to_unit.lower():
        return 1.0
    stmt = select(UnitConversion).where(
        UnitConversion.from_unit == from_unit.lower(),
        UnitConversion.to_unit == to_unit.lower(),
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    return float(row.factor) if row else None


async def consume_from_pantry(recipe_id: uuid.UUID, db: AsyncSession) -> dict:
    """
    Deduct recipe ingredient quantities from pantry after a cooking session.

    Rules:
    - Match by ingredient_id; skip if no pantry item found.
    - Convert units if needed via unit_conversions table.
    - If pantry item confidence < 0.7: apply an extra −0.1 confidence penalty.
    - If quantity drops to 0 or below: set quantity=0, confidence=0.
    - Remove pantry_reservations linked to this recipe.

    Returns a summary dict: {deducted, skipped, zeroed}.
    """
    stmt = select(Recipe).where(Recipe.id == recipe_id)
    recipe = (await db.execute(stmt)).scalar_one_or_none()
    if recipe is None:
        raise ValueError(f"Recipe {recipe_id} not found")

    from app.models.recipe import RecipeIngredient
    ri_stmt = select(RecipeIngredient).where(RecipeIngredient.recipe_id == recipe_id)
    recipe_ingredients = (await db.execute(ri_stmt)).scalars().all()

    deducted = 0
    skipped = 0
    zeroed = 0

    for ri in recipe_ingredients:
        # Find matching pantry item
        pi_stmt = select(PantryItem).where(PantryItem.ingredient_id == ri.ingredient_id)
        pantry_item = (await db.execute(pi_stmt)).scalar_one_or_none()

        if pantry_item is None:
            logger.debug(
                "no pantry item for ingredient — skipping",
                extra={"ingredient_id": str(ri.ingredient_id), "raw_name": ri.raw_name},
            )
            skipped += 1
            continue

        # Determine how much to deduct (use normalized values if available)
        deduct_qty = float(ri.normalized_quantity or ri.quantity)
        deduct_unit = ri.normalized_unit or ri.unit

        # Convert to pantry unit if needed
        factor = await _get_conversion_factor(deduct_unit or "", pantry_item.unit, db)
        if factor is None:
            logger.warning(
                "unit conversion not found — skipping deduction",
                extra={
                    "ingredient": ri.raw_name,
                    "from": deduct_unit,
                    "to": pantry_item.unit,
                },
            )
            skipped += 1
            continue

        amount_to_deduct = deduct_qty * factor
        pantry_item.quantity = max(0.0, float(pantry_item.quantity) - amount_to_deduct)
        pantry_item.last_used_at = datetime.now(timezone.utc)

        # Extra confidence penalty for uncertain items
        if pantry_item.confidence < 0.7:
            pantry_item.confidence = max(0.0, pantry_item.confidence - 0.1)

        if float(pantry_item.quantity) <= 0:
            pantry_item.quantity = 0.0
            pantry_item.confidence = 0.0
            zeroed += 1
        else:
            deducted += 1

    # Remove reservations linked to this recipe
    res_stmt = select(PantryReservation).where(PantryReservation.recipe_id == recipe_id)
    reservations = (await db.execute(res_stmt)).scalars().all()
    for res in reservations:
        await db.delete(res)

    await db.commit()
    summary = {"deducted": deducted, "skipped": skipped, "zeroed": zeroed}
    logger.info("pantry consumed after cooking", extra={"recipe_id": str(recipe_id), **summary})
    return summary
