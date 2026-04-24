import os
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.services.normaliser import resolve_ingredient, ResolveSource

import pytest_asyncio

@pytest_asyncio.fixture
async def db_session():
    database_url = os.environ.get("DATABASE_URL", "postgresql+asyncpg://whatsfortea:devpassword123@db:5432/whatsfortea")
    engine = create_async_engine(database_url, echo=False)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        yield session
    await engine.dispose()

@pytest.mark.asyncio
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
