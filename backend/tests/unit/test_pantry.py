"""
Pantry service tests.
Run: docker-compose exec api poetry run pytest tests/unit/test_pantry.py -v

Pure function tests require no DB. Integration tests require DATABASE_URL.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.services.pantry import calculate_confidence
import uuid

@pytest.fixture
def household_id():
    return uuid.UUID("00000000-0000-0000-0000-000000000001")


# ── Pure function tests ───────────────────────────────────────────────────────

def test_confidence_full_on_day_zero():
    """Freshly confirmed item should have confidence 1.0."""
    now = datetime.now(timezone.utc)
    assert calculate_confidence(0.1, now, now) == pytest.approx(1.0)


def test_confidence_fridge_after_5_days():
    """Fridge decay 0.1/day × 5 days = 0.5 confidence."""
    now = datetime.now(timezone.utc)
    confirmed = now - timedelta(days=5)
    result = calculate_confidence(0.1, confirmed, now)
    assert result == pytest.approx(0.5, abs=0.01)


def test_confidence_pantry_after_10_days():
    """Pantry decay 0.02/day × 10 days = 0.8 confidence."""
    now = datetime.now(timezone.utc)
    confirmed = now - timedelta(days=10)
    result = calculate_confidence(0.02, confirmed, now)
    assert result == pytest.approx(0.8, abs=0.01)


def test_confidence_floored_at_zero():
    """Confidence never goes below 0 even for very old items."""
    now = datetime.now(timezone.utc)
    confirmed = now - timedelta(days=365)
    result = calculate_confidence(0.1, confirmed, now)
    assert result == 0.0


def test_confidence_at_exactly_one_period():
    """After exactly 1 / decay_rate days, confidence should be 0."""
    now = datetime.now(timezone.utc)
    # decay_rate=0.1 → hits 0 at 10 days
    confirmed = now - timedelta(days=10)
    result = calculate_confidence(0.1, confirmed, now)
    assert result == pytest.approx(0.0, abs=0.001)


def test_confidence_naive_datetime_handled():
    """A naive (tz-unaware) last_confirmed_at should not raise."""
    now = datetime.now(timezone.utc)
    naive = datetime.utcnow()  # no tzinfo
    result = calculate_confidence(0.02, naive, now)
    assert 0.0 <= result <= 1.0


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
async def garlic_ingredient_id(db_session):
    """Return the UUID of the seeded Garlic canonical ingredient."""
    from sqlalchemy import select
    from app.models.ingredient import Ingredient
    stmt = select(Ingredient).where(Ingredient.canonical_name == "Garlic")
    ingredient = (await db_session.execute(stmt)).scalar_one_or_none()
    if ingredient is None:
        pytest.skip("Garlic ingredient not seeded — run migrations first")
    return ingredient.id


@pytest.mark.asyncio
async def test_upsert_creates_new_item(db_session, garlic_ingredient_id, household_id):
    from app.schemas.pantry import PantryItemCreate
    from app.services.pantry import upsert_pantry_item, delete_pantry_item

    data = PantryItemCreate(
        ingredient_id=garlic_ingredient_id,
        quantity=10.0,
        unit="count",
        confidence=1.0,
        decay_rate=0.05,
    )
    item = await upsert_pantry_item(data, db_session, household_id)

    assert item.id is not None
    assert float(item.quantity) == 10.0
    assert item.confidence == pytest.approx(1.0)

    # Cleanup
    await delete_pantry_item(item.id, db_session)


@pytest.mark.asyncio
async def test_upsert_updates_existing_item(db_session, garlic_ingredient_id, household_id):
    from app.schemas.pantry import PantryItemCreate
    from app.services.pantry import upsert_pantry_item, delete_pantry_item

    data = PantryItemCreate(
        ingredient_id=garlic_ingredient_id,
        quantity=5.0,
        unit="count",
        confidence=0.5,
        decay_rate=0.05,
    )
    first = await upsert_pantry_item(data, db_session, household_id)

    # Upsert again with new quantity
    data2 = PantryItemCreate(
        ingredient_id=garlic_ingredient_id,
        quantity=20.0,
        unit="count",
        confidence=0.3,  # should be overridden to 1.0 on upsert
        decay_rate=0.05,
    )
    second = await upsert_pantry_item(data2, db_session, household_id)

    assert second.id == first.id  # same row updated
    assert float(second.quantity) == 20.0
    assert second.confidence == pytest.approx(1.0)  # reset to 1.0 on upsert

    await delete_pantry_item(second.id, db_session)


@pytest.mark.asyncio
async def test_confirm_resets_confidence(db_session, garlic_ingredient_id, household_id):
    from app.schemas.pantry import PantryItemCreate, PantryItemUpdate
    from app.services.pantry import upsert_pantry_item, update_pantry_item, confirm_pantry_item, delete_pantry_item

    data = PantryItemCreate(
        ingredient_id=garlic_ingredient_id,
        quantity=3.0,
        unit="count",
        confidence=1.0,
        decay_rate=0.1,
    )
    item = await upsert_pantry_item(data, db_session, household_id)

    # Artificially lower confidence
    item = await update_pantry_item(item.id, PantryItemUpdate(confidence=0.3), db_session)
    assert item.confidence == pytest.approx(0.3)

    # Confirm resets it
    item = await confirm_pantry_item(item.id, db_session)
    assert item.confidence == pytest.approx(1.0)

    await delete_pantry_item(item.id, db_session)


@pytest.mark.asyncio
async def test_get_available_includes_item(db_session, garlic_ingredient_id, household_id):
    from app.schemas.pantry import PantryItemCreate
    from app.services.pantry import upsert_pantry_item, get_available, delete_pantry_item

    data = PantryItemCreate(
        ingredient_id=garlic_ingredient_id,
        quantity=6.0,
        unit="count",
        confidence=1.0,
        decay_rate=0.02,
    )
    item = await upsert_pantry_item(data, db_session, household_id)

    availability = await get_available(db_session, household_id)
    garlic_avail = next(
        (a for a in availability if a.ingredient.id == garlic_ingredient_id), None
    )

    assert garlic_avail is not None
    assert garlic_avail.available_quantity == pytest.approx(6.0, abs=0.1)
    assert garlic_avail.confidence == pytest.approx(1.0, abs=0.01)

    await delete_pantry_item(item.id, db_session)


@pytest.mark.asyncio
async def test_apply_decay_updates_confidence(db_session, garlic_ingredient_id, household_id):
    from datetime import timedelta
    from app.schemas.pantry import PantryItemCreate
    from app.services.pantry import upsert_pantry_item, apply_decay_all, delete_pantry_item
    from app.models.pantry import PantryItem

    data = PantryItemCreate(
        ingredient_id=garlic_ingredient_id,
        quantity=4.0,
        unit="count",
        confidence=1.0,
        decay_rate=0.1,
    )
    item = await upsert_pantry_item(data, db_session, household_id)

    # Wind back last_confirmed_at by 3 days to simulate staleness
    item_row = await db_session.get(PantryItem, item.id)
    item_row.last_confirmed_at = item_row.last_confirmed_at - timedelta(days=3)
    await db_session.commit()

    await apply_decay_all(db_session)

    await db_session.refresh(item_row)
    # After 3 days at 0.1/day: confidence should be ~0.7
    assert item_row.confidence == pytest.approx(0.7, abs=0.05)

    await delete_pantry_item(item.id, db_session)
