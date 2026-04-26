"""
Pantry API — CRUD, confirmation, and availability endpoints.

Important: GET /available must be registered BEFORE GET /{id} so FastAPI
doesn't try to parse "available" as a UUID.
"""
import uuid
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.pantry import PantryItem
from app.schemas.pantry import (
    BulkPantryConfirmRequest,
    PantryAvailability,
    PantryItem as PantryItemSchema,
    PantryItemCreate,
    PantryItemUpdate,
    ReceiptConfirmRequest,
    ReceiptIngestResponse,
)
from app.services.pantry import (
    bulk_confirm_pantry,
    bulk_confirm_with_create,
    confirm_pantry_item,
    delete_pantry_item,
    get_available,
    get_expiring_soon,
    update_pantry_item,
    upsert_pantry_item,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/pantry", tags=["pantry"])


@router.get("/available", response_model=list[PantryAvailability])
async def list_available(db: AsyncSession = Depends(get_db)):
    """
    Return effective availability for every pantry item.
    Accounts for live confidence decay and active reservations.
    Use this endpoint — never read pantry_items.quantity directly.
    """
    return await get_available(db)


@router.get("/expiring", response_model=list[PantryItemSchema])
async def list_expiring(
    days: int = 3,
    db: AsyncSession = Depends(get_db),
):
    """
    Return pantry items with an expiry date within the next `days` days (default 3).
    Items already expired are also included. Ordered by expiry date ascending.
    """
    return await get_expiring_soon(db, days=days)


@router.get("", response_model=list[PantryItemSchema])
async def list_pantry(db: AsyncSession = Depends(get_db)):
    """List all pantry items (raw quantities, without availability calculation)."""
    stmt = select(PantryItem).order_by(PantryItem.ingredient_id)
    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.post("", response_model=PantryItemSchema, status_code=status.HTTP_201_CREATED)
async def add_pantry_item(body: PantryItemCreate, db: AsyncSession = Depends(get_db)):
    """
    Add a new pantry item or update the quantity for an existing ingredient.
    Upserting resets confidence to 1.0 (implies physical confirmation).
    """
    return await upsert_pantry_item(body, db)


@router.patch("/{item_id}", response_model=PantryItemSchema)
async def patch_pantry_item(
    item_id: uuid.UUID,
    body: PantryItemUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Partially update a pantry item (quantity, unit, confidence, or decay_rate)."""
    try:
        return await update_pantry_item(item_id, body, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/{item_id}/confirm", response_model=PantryItemSchema)
async def confirm_item(item_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """
    Confirm physical presence of an item — resets confidence to 1.0
    and updates last_confirmed_at. Use after physically checking the fridge/pantry.
    """
    try:
        return await confirm_pantry_item(item_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/bulk-confirm", response_model=list[PantryItemSchema], status_code=status.HTTP_200_OK)
async def bulk_confirm(body: BulkPantryConfirmRequest, db: AsyncSession = Depends(get_db)):
    """
    Upsert multiple pantry items in a single call.
    Used by the shopping list batch "Mark as bought" action.
    Items without a pantry entry are created; existing items are updated with confidence reset to 1.0.
    """
    return await bulk_confirm_pantry(body.items, db)


@router.post("/receipt-confirm", response_model=list[PantryItemSchema], status_code=status.HTTP_200_OK)
async def receipt_confirm(body: ReceiptConfirmRequest, db: AsyncSession = Depends(get_db)):
    """
    Confirm pantry items from a receipt scan.
    Resolved items (ingredient_id set) are upserted directly.
    Unresolved items (raw_name only) have a minimal Ingredient auto-created first.
    """
    return await bulk_confirm_with_create(body.items, db)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_pantry_item(item_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Remove a pantry item entirely."""
    try:
        await delete_pantry_item(item_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


_RECEIPTS_DIR = Path("/data/receipts")


@router.post("/ingest-receipt", response_model=ReceiptIngestResponse)
async def ingest_receipt(
    images: list[UploadFile] = File(default=[]),
    pdf: UploadFile | None = File(default=None),
    text_content: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
):
    """
    Extract food items from a receipt image, PDF, or pasted text and
    normalise each item against the ingredient database.

    Returns a list of resolved + unresolved items for the user to review
    before bulk-confirming to the pantry.
    """
    has_images = bool(images)
    has_pdf = pdf is not None
    has_text = bool(text_content and text_content.strip())

    if not has_images and not has_pdf and not has_text:
        raise HTTPException(
            status_code=400,
            detail="Provide at least one image, a PDF, or pasted text.",
        )
    if has_images and len(images) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 images per receipt.")

    from redis.asyncio import Redis as AioRedis
    from app.services.ingestion import run_receipt_ingestion, extract_text_from_pdf
    from app.services.rate_limiter import RateLimitExceeded

    image_paths: list[Path] | None = None
    resolved_text: str | None = None

    # ── Save receipt images temporarily ───────────────────────────────────────
    if has_images:
        import io
        from PIL import Image, ImageOps

        receipt_id = uuid.uuid4()
        receipt_dir = _RECEIPTS_DIR / str(receipt_id)
        receipt_dir.mkdir(parents=True, exist_ok=True)
        saved: list[Path] = []
        for i, img_file in enumerate(images):
            content = await img_file.read()
            try:
                with Image.open(io.BytesIO(content)) as img:
                    img = ImageOps.exif_transpose(img)
                    if img.mode != "RGB":
                        img = img.convert("RGB")
                    img.thumbnail((1568, 1568), Image.Resampling.LANCZOS)
                    dest = receipt_dir / f"image_{i:02d}.jpg"
                    img.save(dest, "JPEG", quality=85, optimize=True)
                    saved.append(dest)
            except Exception:
                dest = receipt_dir / f"image_{i:02d}.jpg"
                dest.write_bytes(content)
                saved.append(dest)
        image_paths = saved

    # ── PDF → text ────────────────────────────────────────────────────────────
    elif has_pdf:
        pdf_bytes = await pdf.read()
        try:
            resolved_text = extract_text_from_pdf(pdf_bytes)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Could not extract text from PDF: {exc}")
        if not resolved_text.strip():
            raise HTTPException(status_code=422, detail="PDF appears to contain no extractable text.")

    else:
        resolved_text = text_content

    # ── Run pipeline ──────────────────────────────────────────────────────────
    redis_client = AioRedis.from_url(settings.redis_url, decode_responses=False)
    try:
        enriched = await run_receipt_ingestion(image_paths, resolved_text, db, redis_client)
    except RateLimitExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except Exception:
        logger.error("receipt ingestion failed", exc_info=True)
        raise HTTPException(status_code=500, detail="Receipt processing failed. Please try again.")
    finally:
        await redis_client.aclose()
        # Clean up temporary receipt images immediately — no long-term storage needed
        if image_paths:
            import shutil
            try:
                shutil.rmtree(image_paths[0].parent, ignore_errors=True)
            except Exception:
                logger.debug("Failed to clean up temp receipt images", exc_info=True)

    unresolved_count = sum(1 for e in enriched if not e["resolved"])
    return ReceiptIngestResponse(items=enriched, unresolved_count=unresolved_count)
