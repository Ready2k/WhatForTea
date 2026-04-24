import pytest
import uuid
from pathlib import Path
from app.services.ingestion import run_ingestion
from app.database import AsyncSessionLocal
from redis.asyncio import Redis
from app.config import settings

@pytest.mark.asyncio
async def test_record_ingestion_mockup():
    """
    Trigger a real ingestion call to be recorded by AIMock.
    Requires AIMock to be in 'record' mode and real AWS credentials to be present.
    """
    mockup_path = Path("hello_fresh_mockup.png")
    if not mockup_path.exists():
        pytest.skip("Mockup image not found")

    job_id = uuid.uuid4()
    recipes_dir = Path("/data/recipes")
    job_dir = recipes_dir / str(job_id)
    job_dir.mkdir(parents=True, exist_ok=True)
    
    # Copy mockup to the job directory
    import shutil
    shutil.copy(mockup_path, job_dir / "image_00.jpg")

    async with AsyncSessionLocal() as db:
        from app.models.ingest import IngestJob
        job = IngestJob(id=job_id, image_dir=str(job_dir))
        db.add(job)
        await db.commit()

        redis_client = Redis.from_url(settings.redis_url)
        try:
            # This will trigger the LLM call
            await run_ingestion(job_id=job_id, db=db, redis_client=redis_client)
        finally:
            await redis_client.aclose()

        await db.refresh(job)
        assert job.status.value == "review", f"Ingestion failed: {job.error_message}"
        print(f"\nIngestion successful! Job ID: {job_id}")
