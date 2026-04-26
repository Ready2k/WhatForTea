"""
Planner service tests.
Run: docker-compose exec api poetry run pytest tests/unit/test_planner.py -v
"""
import os
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.services.planner import _format_text_export, _zone, round_to_pack_size


# ── Pure function tests ───────────────────────────────────────────────────────

def test_round_to_pack_size_exact_match():
    """Required equals a pack size exactly."""
    assert round_to_pack_size(250.0, "Beef Mince", "g") == 250.0


def test_round_to_pack_size_rounds_up():
    """180g mince → 250g pack (next size up)."""
    assert round_to_pack_size(180.0, "Beef Mince", "g") == 250.0


def test_round_to_pack_size_word_match():
    """'Beef Mince' contains 'mince' — should match the mince pack sizes."""
    result = round_to_pack_size(300.0, "Beef Mince", "g")
    assert result == 500.0


def test_round_to_pack_size_count_item():
    """0.5 onion should round to 1."""
    result = round_to_pack_size(0.5, "Onion", "count")
    assert result == 1.0


def test_round_to_pack_size_default_g_fallback():
    """Unknown ingredient with gram unit uses default_g sizes."""
    result = round_to_pack_size(120.0, "Mystery Herb", "g")
    assert result == 250.0  # first default_g size >= 120


def test_round_to_pack_size_default_ml_fallback():
    result = round_to_pack_size(150.0, "Some Liquid", "ml")
    assert result == 200.0  # first default_ml size >= 150


def test_round_to_pack_size_exceeds_largest():
    """When required > all pack sizes, return required as-is (buy in bulk)."""
    result = round_to_pack_size(2000.0, "Beef Mince", "g")
    assert result == 2000.0  # return as-is — shopper buys what they need


def test_zone_mapping():
    assert _zone("produce") == "Fridge & Fresh"
    assert _zone("dairy") == "Fridge & Fresh"
    assert _zone("meat") == "Meat & Fish"
    assert _zone("fish") == "Meat & Fish"
    assert _zone("pantry") == "Dry Goods"
    assert _zone("spice") == "Dry Goods"
    assert _zone("bakery") == "Bakery"
    assert _zone("other") == "Other"
    assert _zone("unknown_category") == "Other"


def test_format_text_export_structure():
    from app.schemas.plan import ShoppingListItem
    zones = {
        "Fridge & Fresh": [
            ShoppingListItem(
                ingredient_id=uuid.uuid4(),
                canonical_name="Butter",
                quantity=100.0,
                unit="g",
                rounded_quantity=125.0,
                rounded_unit="g",
            )
        ],
        "Dry Goods": [
            ShoppingListItem(
                ingredient_id=uuid.uuid4(),
                canonical_name="Pasta",
                quantity=300.0,
                unit="g",
                rounded_quantity=500.0,
                rounded_unit="g",
            )
        ],
    }
    text = _format_text_export(zones)
    assert "Whats for Tea?" in text
    assert "DRY GOODS:" in text
    assert "FRIDGE & FRESH:" in text
    assert "125g Butter" in text
    assert "500g Pasta" in text


def test_format_text_export_count_items():
    """Count items should not have a unit suffix."""
    from app.schemas.plan import ShoppingListItem
    zones = {
        "Fridge & Fresh": [
            ShoppingListItem(
                ingredient_id=uuid.uuid4(),
                canonical_name="Onion",
                quantity=1.5,
                unit="count",
                rounded_quantity=2.0,
                rounded_unit="count",
            )
        ]
    }
    text = _format_text_export(zones)
    assert "2 Onion" in text
    assert "count" not in text


# ── Integration tests (real DB) ───────────────────────────────────────────────

@pytest.fixture
async def db_session():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        pytest.skip("DATABASE_URL not set — run inside the api container")
    engine = create_async_engine(database_url, echo=False)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()

@pytest.fixture
def household_id():
    return uuid.UUID("00000000-0000-0000-0000-000000000001")


@pytest.mark.asyncio
async def test_set_week_plan_empty(db_session, household_id):
    """Creating an empty plan returns a MealPlan with no entries."""
    from app.services.planner import set_week_plan
    from app.schemas.plan import MealPlanCreate
    from app.models.plan import MealPlan as MealPlanModel

    week = date.today() - timedelta(days=date.today().weekday()) + timedelta(weeks=52)
    data = MealPlanCreate(week_start=week, entries=[])
    plan = await set_week_plan(data, db_session, household_id)

    assert plan.week_start == week
    assert plan.entries == []

    # Cleanup
    db_plan = await db_session.get(MealPlanModel, plan.id)
    await db_session.delete(db_plan)
    await db_session.commit()


@pytest.mark.asyncio
async def test_shopping_list_empty_plan(db_session, household_id):
    """An empty plan produces an empty shopping list."""
    from app.services.planner import set_week_plan, generate_shopping_list
    from app.schemas.plan import MealPlanCreate
    from app.models.plan import MealPlan as MealPlanModel

    week = date.today() - timedelta(days=date.today().weekday()) + timedelta(weeks=53)
    data = MealPlanCreate(week_start=week, entries=[])
    plan = await set_week_plan(data, db_session, household_id)

    shopping = await generate_shopping_list(week, db_session, household_id)
    assert shopping.zones == {}
    assert "Whats for Tea?" in shopping.text_export

    # Cleanup
    db_plan = await db_session.get(MealPlanModel, plan.id)
    await db_session.delete(db_plan)
    await db_session.commit()
