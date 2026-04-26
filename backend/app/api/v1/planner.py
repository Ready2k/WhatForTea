"""
Planner API — weekly meal plan management and shopping list generation.
"""
import logging
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.errors import AppError, ErrorCode
from app.schemas.plan import AutoFillEntry, AutoFillRequest, MealPlan, MealPlanCreate, ShoppingList
from app.services.planner import (
    auto_fill_week,
    delete_plan_entry,
    generate_shopping_list,
    get_plan,
    set_week_plan,
    zero_waste_suggestions,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/planner", tags=["planner"])


def _require_household_id(request: Request) -> uuid.UUID:
    hid = getattr(request.state, "household_id", None)
    if not hid or hid == "household":
        raise AppError(ErrorCode.UNAUTHORIZED, "Household context required", status_code=401)
    try:
        return uuid.UUID(hid)
    except (ValueError, AttributeError):
        raise AppError(ErrorCode.UNAUTHORIZED, "Invalid household token", status_code=401)


def _current_week_start() -> date:
    """Return today's ISO Monday (week_start convention)."""
    today = date.today()
    return today - timedelta(days=today.weekday())


# ── Plan endpoints ─────────────────────────────────────────────────────────────

@router.post("/week", response_model=MealPlan, status_code=status.HTTP_200_OK)
async def upsert_week_plan(
    body: MealPlanCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Create or replace the meal plan for a given week.
    Existing entries and their pantry reservations are removed and rebuilt.
    """
    try:
        return await set_week_plan(body, db, _require_household_id(request))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/week/current", response_model=MealPlan)
async def get_current_week_plan(db: AsyncSession = Depends(get_db)):
    """Return the meal plan for the current ISO week (Monday–Sunday)."""
    week_start = _current_week_start()
    try:
        return await get_plan(week_start, db)
    except ValueError:
        # No plan yet — return an empty shell rather than 404
        from app.services.planner import get_or_create_plan
        return await get_or_create_plan(week_start, db)


@router.get("/week/{week_start}", response_model=MealPlan)
async def get_week_plan(week_start: date, db: AsyncSession = Depends(get_db)):
    """Return the meal plan for a specific week (week_start must be a Monday)."""
    try:
        return await get_plan(week_start, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_plan_entry(entry_id: str, db: AsyncSession = Depends(get_db)):
    """Remove a single plan entry and its pantry reservations."""
    import uuid as uuid_mod
    try:
        await delete_plan_entry(uuid_mod.UUID(entry_id), db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ── Shopping list endpoints ────────────────────────────────────────────────────

@router.get("/shopping-list", response_model=ShoppingList)
async def get_shopping_list(
    request: Request,
    week_start: date = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Generate the shopping list for the given week (defaults to current week).

    Items are quantities needed beyond what the pantry already holds, rounded
    up to the nearest pack size. Grouped by store zone.
    """
    if week_start is None:
        week_start = _current_week_start()
    try:
        return await generate_shopping_list(week_start, db, _require_household_id(request))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/auto-fill", response_model=list[AutoFillEntry])
async def auto_fill_week_plan(
    body: AutoFillRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Propose a 7-day meal plan based on mood tags and current pantry availability.
    Excludes recently cooked recipes. Returns a proposal — does NOT save.
    Call POST /week to commit the plan.
    """
    return await auto_fill_week(
        moods=body.moods,
        servings=body.servings,
        db=db,
        household_id=_require_household_id(request),
        max_cook_time_mins=body.max_cook_time_mins,
        avoid_recent_days=body.avoid_recent_days,
    )


@router.get("/zero-waste-suggestions")
async def get_zero_waste_suggestions(
    request: Request,
    week_start: date = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Suggest recipes that use pack-size leftovers from this week's shopping.
    Currently scaffolded — returns empty list.
    """
    if week_start is None:
        week_start = _current_week_start()
    return await zero_waste_suggestions(week_start, db, _require_household_id(request))
