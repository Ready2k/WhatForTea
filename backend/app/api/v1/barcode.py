"""
Barcode lookup API.

POST /api/v1/barcode/lookup
  Resolves a product barcode to a canonical ingredient via Open Food Facts + normaliser.
  Results are cached in Redis for 30 days (barcode: → ingredient_id mapping).
"""
import logging

from fastapi import APIRouter, Depends
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.schemas.barcode import BarcodeLookupRequest, BarcodeLookupResponse
from app.services.barcode import lookup_barcode

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/barcode", tags=["barcode"])


@router.post("/lookup", response_model=BarcodeLookupResponse)
async def barcode_lookup(
    body: BarcodeLookupRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Look up a product barcode via Open Food Facts and resolve to a canonical ingredient.

    Response includes the ingredient_id (if resolved), confidence score,
    and the raw product name from Open Food Facts. The caller should then
    prompt the user for quantity and unit before calling POST /api/v1/pantry.

    Results are cached in Redis for 30 days to avoid repeated external API calls.
    """
    redis_client = Redis.from_url(settings.redis_url, decode_responses=False)
    try:
        result = await lookup_barcode(
            barcode=body.barcode.strip(),
            db=db,
            redis_client=redis_client,
        )
    finally:
        await redis_client.aclose()

    return BarcodeLookupResponse(**result)
