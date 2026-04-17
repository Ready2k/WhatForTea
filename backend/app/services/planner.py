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

    NOTE: Discrete non-metric units (bag, pack, sachet, bunch, pot, tub) are
    returned as-is — pack size lookup only applies to g/ml/count-based units.
    Recipe measurement units (tbsp, tsp, oz, etc.) are also returned as-is.
    """
    if required <= 0:
        return 0.0

    unit_lower = (unit or "").lower().strip()

    # Discrete purchase units: recipe quantity IS the buy quantity (1 bag, 1 sachet, etc.)
    DISCRETE_UNITS = {"bag", "pack", "bunch", "sachet", "pot", "tub", "jar", "tin", "can"}
    if unit_lower in DISCRETE_UNITS:
        return float(required)

    # Metric/count units where pack-size rounding makes sense
    METRIC_UNITS = {"g", "kg", "ml", "l", "count", ""}
    if unit_lower not in METRIC_UNITS:
        # Recipe measurement unit (tbsp, tsp, oz, pinch, clove, etc.)
        # These can't be meaningfully rounded to a pack size — return as-is
        return float(required)

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
        if unit_lower in ("g", "kg"):
            chosen = sizes.get("default_g", [100, 250, 500, 1000])
        elif unit_lower in ("ml", "l"):
            chosen = sizes.get("default_ml", [100, 200, 500, 1000])
        elif unit_lower in ("count", ""):
            chosen = sizes.get("default_count", [1, 2, 4, 6])
        else:
            return required  # should not reach here given METRIC_UNITS guard above

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

    Ingredients with no canonical ingredient_id (unresolved) are included
    verbatim under an 'Other' zone so they are never silently dropped.
    """
    plan = await get_plan(week_start, db)

    # Aggregate required quantities per (ingredient_id, unit) for resolved ingredients
    aggregated: dict[tuple[uuid.UUID, str], float] = {}
    # Track unresolved ingredients: key = (raw_name, unit) → qty
    unresolved: dict[tuple[str, str], float] = {}

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
            qty = float(ri.quantity) * scale
            unit = (ri.unit or "count").lower()
            if ri.ingredient_id is None:
                # Unresolved — track by raw name + unit
                key = (ri.raw_name, unit)
                unresolved[key] = unresolved.get(key, 0.0) + qty
            else:
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

    # Add unresolved ingredients verbatim (can't subtract pantry without ingredient_id)
    for (raw_name, unit), qty in unresolved.items():
        rounded = round_to_pack_size(qty, raw_name, unit)
        item = ShoppingListItem(
            ingredient_id=None,
            canonical_name=raw_name,
            quantity=round(qty, 3),
            unit=unit,
            rounded_quantity=rounded,
            rounded_unit=unit,
            is_unresolved=True,
        )
        shopping_items.append(("Other", item))

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


# ── Zero-waste suggestions ────────────────────────────────────────────────────

async def zero_waste_suggestions(
    week_start: date,
    db: AsyncSession,
    limit: int = 5,
    min_coverage: float = 0.1,
) -> list[dict]:
    """
    Suggest recipes that use up pack-size leftovers from this week's shopping.

    Algorithm:
    1. Generate the shopping list to find rounded_quantity − required_quantity
       per ingredient (the amount bought that exceeds what the recipe needs).
    2. Build a synthetic availability map from those leftover quantities.
    3. Score every recipe not already in the week plan against that map.
    4. Return the top `limit` recipes sorted by number of matching ingredients
       then by coverage score (descending).
    """
    from app.models.ingredient import Ingredient
    from app.schemas.ingredient import Ingredient as IngredientSchema
    from app.schemas.pantry import PantryAvailability
    from app.services.matcher import get_category, score_recipe

    # Generate the shopping list; silently return [] if no plan exists yet
    try:
        shopping_list = await generate_shopping_list(week_start, db)
    except ValueError:
        return []

    # Build leftover map: ingredient_id → PantryAvailability (synthetic)
    leftover_map: dict[uuid.UUID, PantryAvailability] = {}
    for zone_items in shopping_list.zones.values():
        for item in zone_items:
            if item.ingredient_id is None or item.is_unresolved:
                continue
            leftover = item.rounded_quantity - item.quantity
            if leftover < 0.01:
                continue
            ingredient = await db.get(Ingredient, item.ingredient_id)
            if ingredient is None:
                continue
            leftover_map[item.ingredient_id] = PantryAvailability(
                pantry_item_id=uuid.uuid4(),  # synthetic — no real pantry row
                ingredient=IngredientSchema.model_validate(ingredient),
                total_quantity=leftover,
                reserved_quantity=0.0,
                available_quantity=leftover,
                confidence=1.0,
                unit=item.unit,
            )

    if not leftover_map:
        return []

    # Collect recipe IDs already in the week plan so we can exclude them
    try:
        plan = await get_plan(week_start, db)
        planned_ids = {entry.recipe_id for entry in plan.entries}
    except ValueError:
        planned_ids = set()

    # Score every unplanned recipe against the leftover availability
    stmt = select(Recipe).options(selectinload(Recipe.ingredients))
    recipes = (await db.execute(stmt)).scalars().all()

    suggestions = []
    for recipe in recipes:
        if recipe.id in planned_ids:
            continue
        # Quick pre-filter: skip recipes with no overlapping ingredients
        leftover_hits = sum(
            1 for ri in recipe.ingredients
            if ri.ingredient_id and ri.ingredient_id in leftover_map
        )
        if leftover_hits == 0:
            continue

        result = await score_recipe(recipe, leftover_map, db)
        if result.score < min_coverage * 100:
            continue

        suggestions.append({
            "recipe": result.recipe.model_dump(),
            "leftover_score": round(result.score, 1),
            "leftover_ingredient_count": leftover_hits,
            "category": get_category(result.score),
        })

    # Sort: most leftover ingredients used first, then by score
    suggestions.sort(
        key=lambda x: (x["leftover_ingredient_count"], x["leftover_score"]),
        reverse=True,
    )
    return suggestions[:limit]


async def auto_fill_week(
    moods: list[str],
    servings: int,
    db: AsyncSession,
    max_cook_time_mins: Optional[int] = None,
    avoid_recent_days: int = 14,
) -> list[dict]:
    """
    Propose a 7-day meal plan based on mood tags and pantry availability.

    Algorithm:
    1. Filter recipes by mood_tags overlap (any match), optionally by cook time.
    2. Exclude recipes cooked within avoid_recent_days.
    3. Score remaining recipes via the matcher.
    4. Greedily assign highest-scoring unique recipe to each day (0–6).
    5. Return proposed entries as [{day_of_week, recipe_id, recipe_title, score}].
       Does NOT save — caller must POST /planner/week to commit.
    """
    from datetime import datetime, timedelta, timezone
    from app.models.session import CookingSession
    from app.services.pantry import get_available

    # Fetch all recipes
    stmt = (
        select(Recipe)
        .options(selectinload(Recipe.ingredients))
    )
    all_recipes = (await db.execute(stmt)).scalars().all()

    # Recent cook filter
    cutoff = datetime.now(timezone.utc) - timedelta(days=avoid_recent_days)
    recent_stmt = (
        select(CookingSession.recipe_id)
        .where(
            CookingSession.confirmed_cook.is_(True),
            CookingSession.ended_at >= cutoff,
        )
        .distinct()
    )
    recently_cooked_ids = set(
        row[0] for row in (await db.execute(recent_stmt)).all()
    )

    # Mood + time filter
    mood_set = {m.lower() for m in moods}
    candidates = []
    for recipe in all_recipes:
        if recipe.id in recently_cooked_ids:
            continue
        if max_cook_time_mins is not None and recipe.cooking_time_mins and recipe.cooking_time_mins > max_cook_time_mins:
            continue
        if mood_set:
            recipe_moods = {t.lower() for t in (recipe.mood_tags or [])}
            if not mood_set.intersection(recipe_moods):
                continue
        candidates.append(recipe)

    if not candidates:
        return []

    # Score against pantry
    avail = await get_available(db)
    avail_map = {a.ingredient.id: a for a in avail}

    from app.services.matcher import score_recipe
    scored = []
    for recipe in candidates:
        result = await score_recipe(recipe, avail_map, db)
        scored.append(result)

    # Sort by score descending
    scored.sort(key=lambda r: r.score, reverse=True)

    # Greedily fill 7 days — no repeats
    used_ids: set[uuid.UUID] = set()
    proposal = []
    for day in range(7):
        for result in scored:
            if result.recipe.id not in used_ids:
                proposal.append({
                    "day_of_week": day,
                    "recipe_id": str(result.recipe.id),
                    "recipe_title": result.recipe.title,
                    "score": round(result.score, 1),
                    "servings": servings,
                })
                used_ids.add(result.recipe.id)
                break

    return proposal
