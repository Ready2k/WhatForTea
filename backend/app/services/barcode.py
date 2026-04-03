"""
Barcode lookup service.

Pipeline:
  1. Check Redis cache (key: barcode:{barcode}, TTL 30 days)
  2. Query Open Food Facts API for product name
  3. Run ingredient normaliser on product name
  4. Cache and return result
"""
import asyncio
import json
import logging
import urllib.request
import urllib.error
from typing import Optional

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_OFF_API = "https://world.openfoodfacts.org/api/v3/product/{barcode}.json"
_CACHE_TTL = 2_592_000  # 30 days in seconds
_USER_AGENT = "WhatsForTea/1.0 (home kitchen assistant; https://github.com/Ready2k/WhatsForTea)"


def _fetch_off(barcode: str) -> dict:
    """Synchronous HTTP call to Open Food Facts. Run in a thread executor."""
    url = _OFF_API.format(barcode=barcode)
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Open Food Facts returned HTTP {exc.code}") from exc


async def lookup_barcode(
    barcode: str,
    db: AsyncSession,
    redis_client: Redis,
) -> dict:
    """
    Resolve a barcode to a canonical pantry ingredient.

    Returns a dict matching BarcodeLookupResponse fields.
    """
    cache_key = f"barcode:{barcode.strip()}"

    # ── 1. Redis cache ────────────────────────────────────────────────────────
    try:
        cached = await redis_client.get(cache_key)
        if cached:
            data = json.loads(cached)
            data["source"] = "cache"
            logger.info("barcode cache hit", extra={"barcode": barcode})
            return data
    except Exception as exc:
        logger.warning("barcode cache read failed", extra={"error": str(exc)})

    # ── 2. Open Food Facts lookup ─────────────────────────────────────────────
    try:
        loop = asyncio.get_event_loop()
        off_data = await loop.run_in_executor(None, _fetch_off, barcode)
    except Exception as exc:
        logger.warning("Open Food Facts lookup failed", extra={"barcode": barcode, "error": str(exc)})
        return {
            "barcode": barcode,
            "product_name": None,
            "ingredient_id": None,
            "canonical_name": None,
            "confidence": 0.0,
            "source": "error",
            "error": str(exc),
        }

    product = off_data.get("product") or {}
    product_name: Optional[str] = (
        product.get("product_name")
        or product.get("product_name_en")
        or product.get("generic_name")
        or product.get("abbreviated_product_name")
    )

    if not product_name or not product_name.strip():
        logger.info("barcode not found in Open Food Facts", extra={"barcode": barcode})
        return {
            "barcode": barcode,
            "product_name": None,
            "ingredient_id": None,
            "canonical_name": None,
            "confidence": 0.0,
            "source": "not_found",
        }

    product_name = product_name.strip()

    # ── 3. Normaliser ─────────────────────────────────────────────────────────
    from app.services.normaliser import resolve_ingredient

    try:
        result = await resolve_ingredient(raw_name=product_name, db=db, use_llm=True)
    except Exception as exc:
        logger.warning("normaliser failed for barcode product", extra={"product": product_name, "error": str(exc)})
        return {
            "barcode": barcode,
            "product_name": product_name,
            "ingredient_id": None,
            "canonical_name": None,
            "confidence": 0.0,
            "source": "unresolved",
        }

    ingredient_id = str(result.ingredient.id) if result.ingredient else None
    canonical_name = result.ingredient.canonical_name if result.ingredient else None
    source = "openfoodfacts" if ingredient_id else "unresolved"

    data = {
        "barcode": barcode,
        "product_name": product_name,
        "ingredient_id": ingredient_id,
        "canonical_name": canonical_name,
        "confidence": result.confidence,
        "source": source,
    }

    # ── 4. Cache the result ───────────────────────────────────────────────────
    try:
        await redis_client.setex(cache_key, _CACHE_TTL, json.dumps(data))
    except Exception as exc:
        logger.warning("barcode cache write failed", extra={"error": str(exc)})

    logger.info(
        "barcode resolved",
        extra={
            "barcode": barcode,
            "product_name": product_name,
            "ingredient": canonical_name,
            "confidence": result.confidence,
        },
    )
    return data
