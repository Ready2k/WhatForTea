"""
Planner service — weekly meal planning, pantry reservations, and shopping list.

Shopping list algorithm:
  1. Aggregate recipe ingredient quantities across all plan entries (scaled by servings)
  2. Subtract pantry availability (effective = quantity × confidence − reservations)
  3. Round up shortfalls to the nearest pack size (from config/pack_sizes.yaml)
  4. Group by ingredient category → store zone
  5. Produce plain-text and WhatsApp deep-link exports
"""
import logging
import math
import urllib.parse
import uuid
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Optional

import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.ingredient import Ingredient, UnitConversion
from app.models.pantry import PantryItem, PantryReservation, ReservationType
from app.models.plan import MealPlan, MealPlanEntry
from app.models.recipe import Recipe
from app.schemas.plan import (
    MealPlanCreate,
    ShoppingList,
    ShoppingListItem,
)

logger = logging.getLogger(__name__)

_PACK_SIZES_PATH = Path(__file__).parent.parent.parent / "config" / "pack_sizes.yaml"


# ── Pack sizes ─────────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _load_pack_sizes() -> dict:
    with open(_PACK_SIZES_PATH) as f:
        return yaml.safe_load(f)


def round_to_pack_size(required: float, canonical_name: str, unit: str) -> float:
    """
    Round a required quantity up to the nearest available pack size.
    Tries: exact canonical name → any word in the name → unit default.
    Returns required as-is if it exceeds all defined pack sizes (buy in bulk).
    Returns 0.0 for zero or negative required quantities.
    """
    if required <= 0:
        return 0.0

    sizes = _load_pack_sizes()
    name_lower = canonical_name.lower()

    # Priority: exact name > any word in name > unit-based default
    chosen: Optional[list] = sizes.get(name_lower)
    if chosen is None:
        for word in name_lower.split():
            if word in sizes:
                chosen = sizes[word]
                break
    if chosen is None:
        unit_lower = (unit or "").lower()
        if unit_lower in ("g", "kg"):
            chosen = sizes.get("default_g", [100, 250, 500, 1000])
        elif unit_lower in ("ml", "l"):
            chosen = sizes.get("default_ml", [100, 200, 500, 1000])
        elif unit_lower in ("count", ""):
            chosen = sizes.get("default_count", [1, 2, 4, 6])
        else:
            return required  # unknown unit — return as-is

    for size in sorted(chosen):
        if size >= math.ceil(required):
            return float(size)
    return required  # required exceeds largest pack — return as-is (buy in bulk)


# ── Zone mapping ───────────────────────────────────────────────────────────────

_CATEGORY_ZONE: dict[str, str] = {
    "produce": "Fridge & Fresh",
    "dairy": "Fridge & Fresh",
    "meat": "Meat & Fish",
    "fish": "Meat & Fish",
    "pantry": "Dry Goods",
    "spice": "Dry Goods",
    "bakery": "Bakery",
    "other": "Other",
}


def _zone(category: str) -> str:
    return _CATEGORY_ZONE.get(category.lower(), "Other")


# ── Unit conversion ───────────────────────────────────────────────────────────

async def _conversion_factor(
    from_unit: Optional[str],
    to_unit: Optional[str],
    db: AsyncSession,
) -> Optional[float]:
    f = (from_unit or "count").lower().strip()
    t = (to_unit or "count").lower().strip()
    if f == t:
        return 1.0
    stmt = select(UnitConversion).where(
        UnitConversion.from_unit == f,
        UnitConversion.to_unit == t,
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    return float(row.factor) if row else None


# ── Plan CRUD ──────────────────────────────────────────────────────────────────

async def get_or_create_plan(week_start: date, db: AsyncSession) -> MealPlan:
    """Return the meal plan for the given week, creating an empty one if absent."""
    stmt = select(MealPlan).where(MealPlan.week_start == week_start)
    plan = (await db.execute(stmt)).scalar_one_or_none()
    if plan is None:
        plan = MealPlan(week_start=week_start)
        db.add(plan)
        await db.commit()
        await db.refresh(plan)
    return plan


async def get_plan(week_start: date, db: AsyncSession) -> MealPlan:
    """Load a plan with entries + recipes. Raises ValueError if not found."""
    stmt = (
        select(MealPlan)
        .where(MealPlan.week_start == week_start)
        .options(
            selectinload(MealPlan.entries).selectinload(MealPlanEntry.recipe)
        )
    )
    plan = (await db.execute(stmt)).scalar_one_or_none()
    if plan is None:
        raise ValueError(f"No meal plan for week starting {week_start}")
    return plan


async def set_week_plan(data: MealPlanCreate, db: AsyncSession) -> MealPlan:
    """
    Replace the full week plan. Existing entries (and their reservations) are
    deleted and rebuilt from the submitted list.
    """
    # Upsert the MealPlan row
    stmt = select(MealPlan).where(MealPlan.week_start == data.week_start)
    plan = (await db.execute(stmt)).scalar_one_or_none()
    if plan is None:
        plan = MealPlan(week_start=data.week_start)
        db.add(plan)
        await db.flush()
    else:
        # Delete old entries (cascade removes their reservations)
        old_entries_stmt = select(MealPlanEntry).where(MealPlanEntry.meal_plan_id == plan.id)
        old_entries = (await db.execute(old_entries_stmt)).scalars().all()
        for entry in old_entries:
            await _delete_entry_reservations(entry.id, db)
            await db.delete(entry)
        await db.flush()

    # Insert new entries
    for entry_data in data.entries:
        entry = MealPlanEntry(
            meal_plan_id=plan.id,
            day_of_week=entry_data.day_of_week,
            recipe_id=entry_data.recipe_id,
            servings=entry_data.servings,
        )
        db.add(entry)
        await db.flush()
        await _create_entry_reservations(entry, db)

    await db.commit()

    # Reload with relationships
    return await get_plan(data.week_start, db)


async def delete_plan_entry(entry_id: uuid.UUID, db: AsyncSession) -> None:
    """Remove a single plan entry and its pantry reservations."""
    entry = await db.get(MealPlanEntry, entry_id)
    if entry is None:
        raise ValueError(f"MealPlanEntry {entry_id} not found")
    await _delete_entry_reservations(entry_id, db)
    await db.delete(entry)
    await db.commit()


# ── Reservations ──────────────────────────────────────────────────────────────

async def _create_entry_reservations(entry: MealPlanEntry, db: AsyncSession) -> None:
    """Create pantry_reservations for each ingredient in the recipe (if in pantry)."""
    recipe = await db.get(Recipe, entry.recipe_id, options=[selectinload(Recipe.ingredients)])
    if recipe is None:
        return

    scale = (entry.servings or recipe.base_servings) / recipe.base_servings

    for ri in recipe.ingredients:
        if ri.ingredient_id is None:
            continue

        pi_stmt = select(PantryItem).where(PantryItem.ingredient_id == ri.ingredient_id)
        pantry_item = (await db.execute(pi_stmt)).scalar_one_or_none()
        if pantry_item is None:
            continue  # not in pantry — will appear on shopping list

        required_qty = float(ri.quantity) * scale
        factor = await _conversion_factor(ri.unit, pantry_item.unit, db)
        if factor is None:
            logger.debug(
                "skipping reservation — unit conversion not found",
                extra={"raw_name": ri.raw_name, "from": ri.unit, "to": pantry_item.unit},
            )
            continue

        reservation = PantryReservation(
            pantry_item_id=pantry_item.id,
            recipe_id=entry.recipe_id,
            quantity=required_qty * factor,
            reserved_for=ReservationType.PLAN,
        )
        db.add(reservation)

    await db.flush()


async def _delete_entry_reservations(entry_id: uuid.UUID, db: AsyncSession) -> None:
    """Remove pantry_reservations tied to the recipe of this plan entry."""
    entry = await db.get(MealPlanEntry, entry_id)
    if entry is None:
        return
    res_stmt = select(PantryReservation).where(
        PantryReservation.recipe_id == entry.recipe_id,
        PantryReservation.reserved_for == ReservationType.PLAN,
    )
    for res in (await db.execute(res_stmt)).scalars().all():
        await db.delete(res)
    await db.flush()


# ── Shopping list ─────────────────────────────────────────────────────────────

async def generate_shopping_list(week_start: date, db: AsyncSession) -> ShoppingList:
    """
    Build the shopping list for the given week:
      required − available → round up to pack size → group by zone.
    """
    plan = await get_plan(week_start, db)

    # Aggregate required quantities per (ingredient_id, unit)
    aggregated: dict[tuple[uuid.UUID, str], float] = {}

    for entry in plan.entries:
        # Use explicit select to avoid identity-map cache returning Recipe without ingredients
        recipe_stmt = (
            select(Recipe)
            .options(selectinload(Recipe.ingredients))
            .where(Recipe.id == entry.recipe_id)
        )
        recipe = (await db.execute(recipe_stmt)).scalar_one_or_none()
        if recipe is None:
            continue
        scale = ((entry.servings or recipe.base_servings) / recipe.base_servings)

        for ri in recipe.ingredients:
            if ri.ingredient_id is None:
                continue
            qty = float(ri.quantity) * scale
            unit = (ri.unit or "count").lower()
            key = (ri.ingredient_id, unit)
            aggregated[key] = aggregated.get(key, 0.0) + qty

    # Get pantry availability
    from app.services.pantry import get_available
    availability = await get_available(db)
    avail_map = {a.ingredient.id: a for a in availability}

    # Compute shortfalls and build shopping items
    shopping_items: list[tuple[str, ShoppingListItem]] = []  # (zone, item)

    for (ingredient_id, unit), required_qty in aggregated.items():
        ingredient = await db.get(Ingredient, ingredient_id)
        if ingredient is None:
            continue

        # Subtract available pantry quantity (converting to recipe unit)
        available_in_recipe_unit = 0.0
        avail = avail_map.get(ingredient_id)
        if avail:
            factor = await _conversion_factor(avail.unit, unit, db)
            if factor is not None:
                available_in_recipe_unit = avail.available_quantity * factor

        shortfall = max(0.0, required_qty - available_in_recipe_unit)
        if shortfall < 0.01:
            continue  # pantry fully covers this ingredient

        rounded = round_to_pack_size(shortfall, ingredient.canonical_name, unit)

        item = ShoppingListItem(
            ingredient_id=ingredient_id,
            canonical_name=ingredient.canonical_name,
            quantity=round(shortfall, 3),
            unit=unit,
            rounded_quantity=rounded,
            rounded_unit=unit,
        )
        zone = _zone(ingredient.category.value)
        shopping_items.append((zone, item))

    # Group into zones, sorted alphabetically within each
    zones: dict[str, list[ShoppingListItem]] = {}
    for zone, item in sorted(shopping_items, key=lambda x: (x[0], x[1].canonical_name)):
        zones.setdefault(zone, []).append(item)

    text = _format_text_export(zones)
    whatsapp_url = "whatsapp://send?text=" + urllib.parse.quote(text)

    return ShoppingList(zones=zones, text_export=text, whatsapp_url=whatsapp_url)


def _format_text_export(zones: dict[str, list[ShoppingListItem]]) -> str:
    """Format the shopping list as plain text for copy/paste and WhatsApp sharing."""
    lines = ["Whats for Tea? Shopping List:", ""]
    for zone, items in sorted(zones.items()):
        lines.append(f"{zone.upper()}:")
        for item in items:
            qty = item.rounded_quantity
            unit = item.rounded_unit
            # Format: "500g Chicken Breast" or "2 Onion"
            if unit in ("count", ""):
                lines.append(f"* {int(qty) if qty == int(qty) else qty} {item.canonical_name}")
            else:
                lines.append(f"* {int(qty) if qty == int(qty) else qty}{unit} {item.canonical_name}")
        lines.append("")
    return "\n".join(lines).rstrip()


# ── Zero-waste suggestions (scaffold) ─────────────────────────────────────────

async def zero_waste_suggestions(week_start: date, db: AsyncSession) -> list[dict]:
    """
    Suggest recipes that use up pack-size leftovers.
    Phase 6 scaffold — returns empty list; full logic in a future phase.
    """
    # TODO: compute leftovers (rounded_quantity − required) and score remaining
    #       recipes against those ingredients using the matcher
    return []
