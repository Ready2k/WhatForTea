"""
AIMock normaliser integration test.

Requires:
  - A running PostgreSQL database with seeded ingredients
  - AIMock or real Bedrock credentials configured

This test is skipped in CI because it requires a real LLM endpoint.
"""
import os
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.services.normaliser import resolve_ingredient, ResolveSource


@pytest.fixture
async def db_session():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        pytest.skip("DATABASE_URL not set — run inside the api container")
    engine = create_async_engine(database_url, echo=False)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        yield session
    await engine.dispose()


@pytest.mark.skipif(
    os.environ.get("AWS_ACCESS_KEY_ID") == "mock",
    reason="Requires real LLM credentials — skipped in CI",
)
async def test_normaliser_with_aimock(db_session):
    # This should trigger an LLM call because fuzzy score will be low
    # "Red Leicester" vs "Cheddar"
    result = await resolve_ingredient(
        raw_name="Red Leicester",
        db=db_session,
        use_llm=True
    )
    
    print(f"\nResult: {result}")
    assert result.source == ResolveSource.LLM
    assert result.ingredient is not None
    assert "Red" in result.ingredient.canonical_name
    assert result.ingredient.canonical_name == "Red Pepper"
