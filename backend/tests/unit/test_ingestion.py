"""
Ingestion pipeline tests.
Run: docker-compose exec api poetry run pytest tests/unit/test_ingestion.py -v

Tests are split into:
  - Pure function tests (_validate_llm_result) — no DB, no mocks needed.
  - Integration tests — real PostgreSQL DB, mocked Bedrock + rate limiter.
"""
import os
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models.ingest import IngestJob, IngestStatus, LlmOutput
from app.services.ingestion import _validate_llm_result, confirm_recipe, run_ingestion


# ── Pure function tests (no I/O) ──────────────────────────────────────────────

def test_validate_valid_response():
    parsed = {
        "title": "Test Recipe",
        "cooking_time_mins": 30,
        "ingredients": [{"raw_name": "Garlic", "quantity": 2, "unit": None}],
        "steps": [{"order": 1, "text": "Do something", "timer_seconds": None}],
    }
    assert _validate_llm_result(parsed) == []


def test_validate_empty_ingredients():
    parsed = {
        "cooking_time_mins": 20,
        "ingredients": [],
        "steps": [{"order": 1, "text": "Step 1"}],
    }
    errors = _validate_llm_result(parsed)
    assert any("ingredients" in e for e in errors)


def test_validate_empty_steps():
    parsed = {
        "cooking_time_mins": 20,
        "ingredients": [{"raw_name": "Butter", "quantity": 1}],
        "steps": [],
    }
    errors = _validate_llm_result(parsed)
    assert any("steps" in e for e in errors)


def test_validate_cooking_time_zero():
    parsed = {
        "cooking_time_mins": 0,
        "ingredients": [{"raw_name": "Butter", "quantity": 1}],
        "steps": [{"order": 1, "text": "Step 1"}],
    }
    errors = _validate_llm_result(parsed)
    assert any("cooking_time_mins" in e for e in errors)


def test_validate_cooking_time_too_long():
    parsed = {
        "cooking_time_mins": 301,
        "ingredients": [{"raw_name": "Butter", "quantity": 1}],
        "steps": [{"order": 1, "text": "Step 1"}],
    }
    errors = _validate_llm_result(parsed)
    assert any("cooking_time_mins" in e for e in errors)


def test_validate_negative_quantity():
    parsed = {
        "cooking_time_mins": 30,
        "ingredients": [{"raw_name": "Milk", "quantity": -1, "unit": "ml"}],
        "steps": [{"order": 1, "text": "Step 1"}],
    }
    errors = _validate_llm_result(parsed)
    assert any("Milk" in e for e in errors)


def test_validate_zero_quantity():
    parsed = {
        "cooking_time_mins": 30,
        "ingredients": [{"raw_name": "Salt", "quantity": 0, "unit": "g"}],
        "steps": [{"order": 1, "text": "Step 1"}],
    }
    errors = _validate_llm_result(parsed)
    assert any("Salt" in e for e in errors)


def test_validate_cooking_time_none_is_allowed():
    """cooking_time_mins=null is valid (LLM couldn't read it)."""
    parsed = {
        "cooking_time_mins": None,
        "ingredients": [{"raw_name": "Garlic", "quantity": 2}],
        "steps": [{"order": 1, "text": "Step 1"}],
    }
    assert _validate_llm_result(parsed) == []


# ── Integration tests (real DB, mocked Bedrock + rate limiter) ────────────────

@pytest.fixture
async def db_session():
    """Connect to the running PostgreSQL database."""
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        pytest.skip("DATABASE_URL not set — run inside the api container")

    engine = create_async_engine(database_url, echo=False)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        yield session
    await engine.dispose()


_MOCK_LLM_RESULT = {
    "title": "Garlic Pasta",
    "cooking_time_mins": 20,
    "hello_fresh_style": 1,
    "mood_tags": ["quick", "comfort"],
    "base_servings": 2,
    "ingredients": [
        {"raw_name": "Garlic Clove", "quantity": 2, "unit": None},
        {"raw_name": "Pasta", "quantity": 200, "unit": "g"},
    ],
    "steps": [
        {"order": 1, "text": "Boil pasta until al dente.", "timer_seconds": 480},
        {"order": 2, "text": "Fry garlic in olive oil.", "timer_seconds": None},
    ],
}


@pytest.mark.asyncio
async def test_run_ingestion_reaches_review(db_session, tmp_path):
    """Happy path: valid LLM response → job reaches REVIEW status."""
    # Create a dummy image file
    image_file = tmp_path / "image_00.jpg"
    image_file.write_bytes(b"fake-image-data")

    # Create IngestJob
    job = IngestJob(image_dir=str(tmp_path))
    db_session.add(job)
    await db_session.flush()
    job_id = job.id

    mock_redis = AsyncMock()

    with (
        patch(
            "app.services.ingestion.check_and_increment",
            new_callable=AsyncMock,
        ),
        patch(
            "app.services.bedrock.call_ingestion_llm",
            new_callable=AsyncMock,
            return_value=({"content": [{"text": "{}"}]}, _MOCK_LLM_RESULT),
        ),
    ):
        await run_ingestion(
            job_id=job_id,
            db=db_session,
            redis_client=mock_redis,
            recipes_dir=tmp_path.parent,
        )

    await db_session.refresh(job)
    assert job.status == IngestStatus.REVIEW, f"Expected REVIEW, got {job.status}"

    # Check llm_output was stored
    from sqlalchemy import select
    stmt = select(LlmOutput).where(LlmOutput.ingest_job_id == job_id)
    llm_out = (await db_session.execute(stmt)).scalar_one_or_none()
    assert llm_out is not None
    assert llm_out.parsed_result.get("title") == "Garlic Pasta"
    assert "unresolved_ingredients" in llm_out.parsed_result

    # Cleanup
    await db_session.delete(job)
    await db_session.commit()


@pytest.mark.asyncio
async def test_run_ingestion_rate_limited(db_session, tmp_path):
    """When rate limit is exceeded the job should be marked FAILED."""
    from app.services.rate_limiter import RateLimitExceeded

    image_file = tmp_path / "image_00.jpg"
    image_file.write_bytes(b"fake-image-data")

    job = IngestJob(image_dir=str(tmp_path))
    db_session.add(job)
    await db_session.flush()
    job_id = job.id

    mock_redis = AsyncMock()

    with patch(
        "app.services.ingestion.check_and_increment",
        new_callable=AsyncMock,
        side_effect=RateLimitExceeded(limit=20, retry_after=1800),
    ):
        await run_ingestion(
            job_id=job_id,
            db=db_session,
            redis_client=mock_redis,
            recipes_dir=tmp_path.parent,
        )

    await db_session.refresh(job)
    assert job.status == IngestStatus.FAILED
    assert "rate limit" in job.error_message.lower()

    # Cleanup
    await db_session.delete(job)
    await db_session.commit()


@pytest.mark.asyncio
async def test_run_ingestion_invalid_llm_response(db_session, tmp_path):
    """A malformed LLM response (empty ingredients) should fail the job."""
    image_file = tmp_path / "image_00.jpg"
    image_file.write_bytes(b"fake-image-data")

    bad_result = {
        "title": "Empty Recipe",
        "cooking_time_mins": 30,
        "ingredients": [],  # validation should reject this
        "steps": [{"order": 1, "text": "Step 1"}],
    }

    job = IngestJob(image_dir=str(tmp_path))
    db_session.add(job)
    await db_session.flush()
    job_id = job.id

    mock_redis = AsyncMock()

    with (
        patch("app.services.ingestion.check_and_increment", new_callable=AsyncMock),
        patch(
            "app.services.bedrock.call_ingestion_llm",
            new_callable=AsyncMock,
            return_value=({"content": [{"text": "{}"}]}, bad_result),
        ),
    ):
        await run_ingestion(
            job_id=job_id,
            db=db_session,
            redis_client=mock_redis,
            recipes_dir=tmp_path.parent,
        )

    await db_session.refresh(job)
    assert job.status == IngestStatus.FAILED
    assert job.error_message is not None

    # Cleanup
    await db_session.delete(job)
    await db_session.commit()
