"""
Normaliser golden set tests.
Run: docker-compose exec api poetry run pytest tests/unit/test_normaliser.py -v

Uses the real PostgreSQL test database (populated via the seed migrations).
≥95% of the golden set must pass for Phase 2 to be considered complete.
"""
import json
import os
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.services.normaliser import ResolveSource, resolve_ingredient

GOLDEN_PATH = Path(__file__).parent.parent / "fixtures" / "golden_ingredients.json"


@pytest.fixture
async def db_session():
    """Connect to the running PostgreSQL database (same one used by the API)."""
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        pytest.skip("DATABASE_URL not set — run inside the api container")

    engine = create_async_engine(database_url, echo=False)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        yield session

    await engine.dispose()


@pytest.fixture
def golden_set():
    with open(GOLDEN_PATH) as f:
        return json.load(f)


@pytest.mark.asyncio
async def test_golden_set_pass_rate(db_session, golden_set):
    """≥95% of the golden set must resolve to the correct canonical name."""
    passed = 0
    failed = []

    for entry in golden_set:
        result = await resolve_ingredient(
            raw_name=entry["raw"],
            db=db_session,
            redis_client=None,
            use_llm=False,  # Lookup + fuzzy only in unit tests (no LLM cost)
        )
        resolved_name = result.ingredient.canonical_name if result.ingredient else None
        if resolved_name == entry["canonical"]:
            passed += 1
        else:
            failed.append({
                "raw": entry["raw"],
                "expected": entry["canonical"],
                "got": resolved_name,
                "source": result.source.value,
                "confidence": result.confidence,
            })

    total = len(golden_set)
    pass_rate = passed / total
    print(f"\n  Golden set: {passed}/{total} passed ({pass_rate:.1%})")
    if failed:
        print("  Failures:")
        for f in failed:
            print(f"    {f['raw']!r} → expected {f['expected']!r}, got {f['got']!r} ({f['source']}, {f['confidence']:.2f})")

    assert pass_rate >= 0.95, (
        f"Golden set pass rate {pass_rate:.1%} is below the 95% threshold. "
        f"Failures: {len(failed)}/{total}\n" + "\n".join(str(f) for f in failed)
    )


@pytest.mark.asyncio
async def test_lookup_exact_match(db_session):
    result = await resolve_ingredient("Echalion Shallot", db_session, use_llm=False)
    assert result.ingredient is not None
    assert result.ingredient.canonical_name == "Shallot"
    assert result.source == ResolveSource.LOOKUP
    assert result.confidence == 1.0


@pytest.mark.asyncio
async def test_lookup_case_insensitive(db_session):
    result = await resolve_ingredient("GARLIC CLOVE", db_session, use_llm=False)
    assert result.ingredient is not None
    assert result.ingredient.canonical_name == "Garlic"


@pytest.mark.asyncio
async def test_fuzzy_close_match(db_session):
    # "spring onions" (plural) is not an alias but scores very high against "spring onion"
    result = await resolve_ingredient("spring onions", db_session, use_llm=False)
    assert result.ingredient is not None
    assert result.ingredient.canonical_name == "Spring Onion"
    assert result.source == ResolveSource.FUZZY


@pytest.mark.asyncio
async def test_unresolved_returns_none(db_session):
    result = await resolve_ingredient("xyzzy_not_an_ingredient_abc123", db_session, use_llm=False)
    assert result.ingredient is None
    assert result.source == ResolveSource.NEW
    assert result.confidence == 0.0
