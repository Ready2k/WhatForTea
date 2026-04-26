"""
Matcher service tests.
Run: docker-compose exec api poetry run pytest tests/unit/test_matcher.py -v

Pure function tests require no DB.
Integration tests require DATABASE_URL.
"""
import os

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.services.matcher import get_category, ingredient_score
import uuid

@pytest.fixture
def household_id():
    return uuid.UUID("00000000-0000-0000-0000-000000000001")


# ── Pure function tests ───────────────────────────────────────────────────────

def test_ingredient_score_exact_match():
    assert ingredient_score(available_qty=100.0, required_qty=100.0) == pytest.approx(1.0)


def test_ingredient_score_surplus():
    """More than enough in pantry → capped at 1.0."""
    assert ingredient_score(available_qty=200.0, required_qty=100.0) == pytest.approx(1.0)


def test_ingredient_score_partial():
    assert ingredient_score(available_qty=50.0, required_qty=100.0) == pytest.approx(0.5)


def test_ingredient_score_missing():
    assert ingredient_score(available_qty=0.0, required_qty=100.0) == pytest.approx(0.0)


def test_ingredient_score_zero_required():
    """Zero required quantity is treated as missing to avoid division by zero."""
    assert ingredient_score(available_qty=50.0, required_qty=0.0) == pytest.approx(0.0)


def test_ingredient_score_small_amount():
    """Fractional quantities work correctly."""
    assert ingredient_score(available_qty=0.5, required_qty=2.0) == pytest.approx(0.25)


def test_get_category_cook_now_boundary():
    assert get_category(90.0) == "cook_now"
    assert get_category(100.0) == "cook_now"
    assert get_category(95.5) == "cook_now"


def test_get_category_almost_there_boundary():
    assert get_category(89.9) == "almost_there"
    assert get_category(50.0) == "almost_there"
    assert get_category(70.0) == "almost_there"


def test_get_category_planner_boundary():
    assert get_category(49.9) == "planner"
    assert get_category(0.0) == "planner"


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


@pytest.mark.asyncio
async def test_score_all_recipes_empty_pantry(db_session, household_id):
    """With no pantry items all recipes should score 0 (planner)."""
    from app.services.matcher import score_all_recipes
    from app.services.pantry import get_available

    # Verify pantry is actually empty (or skip if items exist)
    availability = await get_available(db_session, household_id)
    if availability:
        pytest.skip("Pantry has items — empty-pantry test requires a clean state")

    results = await score_all_recipes(db_session, household_id)
    for r in results:
        assert r.score == pytest.approx(0.0), f"Expected 0 score, got {r.score} for {r.recipe.title}"
        assert r.category == "planner"


@pytest.mark.asyncio
async def test_score_all_recipes_returns_list(db_session, household_id):
    """score_all_recipes always returns a list (even with no recipes)."""
    from app.services.matcher import score_all_recipes

    results = await score_all_recipes(db_session, household_id)
    assert isinstance(results, list)


@pytest.mark.asyncio
async def test_score_all_recipes_sorted_descending(db_session, household_id):
    """Results must be sorted by score descending."""
    from app.services.matcher import score_all_recipes

    results = await score_all_recipes(db_session, household_id)
    scores = [r.score for r in results]
    assert scores == sorted(scores, reverse=True), "Results not sorted by score descending"


@pytest.mark.asyncio
async def test_full_pantry_recipe_scores_high(db_session, household_id):
    """
    If we stock the pantry with all ingredients for a recipe,
    that recipe should score 100 (cook_now).
    """
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.models.recipe import Recipe
    from app.schemas.pantry import PantryItemCreate
    from app.services.matcher import score_all_recipes
    from app.services.pantry import delete_pantry_item, upsert_pantry_item

    # Find a recipe with at least one ingredient
    stmt = select(Recipe).options(selectinload(Recipe.ingredients)).limit(5)
    recipes = (await db_session.execute(stmt)).scalars().all()
    recipe = next((r for r in recipes if r.ingredients), None)
    if recipe is None:
        pytest.skip("No recipes with ingredients in DB")

    # Stock pantry with 10× required amount for each ingredient
    created_ids = []
    for ri in recipe.ingredients:
        if ri.ingredient_id is None:
            continue
        item = await upsert_pantry_item(
            PantryItemCreate(
                ingredient_id=ri.ingredient_id,
                quantity=float(ri.quantity) * 10,
                unit=ri.unit or "count",
                confidence=1.0,
                decay_rate=0.02,
            ),
            db_session,
            household_id,
        )
        created_ids.append(item.id)

    if not created_ids:
        pytest.skip("Recipe has no resolvable ingredients")

    results = await score_all_recipes(db_session, household_id)
    matched = next((r for r in results if r.recipe.id == recipe.id), None)
    assert matched is not None
    assert matched.score == pytest.approx(100.0, abs=1.0)
    assert matched.category == "cook_now"

    # Cleanup
    for item_id in created_ids:
        await delete_pantry_item(item_id, db_session)
