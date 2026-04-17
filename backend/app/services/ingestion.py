"""
LLM Ingestion Pipeline — orchestrates the full recipe card ingestion flow.

Flow (happy path):
  1. API handler: save images → create IngestJob(QUEUED) → enqueue arq task → return job_id
  2. arq worker : run_ingestion() → PROCESSING → rate-limit check → LLM call
                  → validate → normalise ingredients → store LlmOutput → REVIEW
  3. API handler: confirm_recipe() → insert Recipe → COMPLETE

All errors in run_ingestion are caught and persisted as status=FAILED so the
caller can surface them via the status endpoint without needing arq internals.
"""
import logging
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.metrics import ingestion_total
from app.models.ingest import IngestJob, IngestStatus, LlmOutput
from app.models.recipe import Recipe, RecipeIngredient, Step
from app.schemas.recipe import RecipeCreate
from app.services.rate_limiter import RateLimitExceeded, check_and_increment

logger = logging.getLogger(__name__)

_DEFAULT_RECIPES_DIR = Path("/data/recipes")

_URL_IMPORT_PLACEHOLDER = "url_import"


class DuplicateRecipeError(Exception):
    """Raised when a confirmed recipe's image hash matches an existing recipe."""
    def __init__(self, recipe_id: uuid.UUID, recipe_title: str):
        self.recipe_id = recipe_id
        self.recipe_title = recipe_title
        super().__init__(f"Duplicate of '{recipe_title}'")


def _compute_dhash(image_path: Path, hash_size: int = 8) -> str:
    """
    Compute a dHash (difference hash) for an image.
    Returns a hex string of length hash_size^2 / 4.
    Two images are near-duplicates if their Hamming distance is ≤ 8.
    """
    from PIL import Image
    with Image.open(image_path) as img:
        img = img.convert("L").resize((hash_size + 1, hash_size), Image.LANCZOS)
        pixels = list(img.getdata())

    bits = []
    for row in range(hash_size):
        for col in range(hash_size):
            left = pixels[row * (hash_size + 1) + col]
            right = pixels[row * (hash_size + 1) + col + 1]
            bits.append(1 if left > right else 0)

    # Pack bits into an integer and return as hex
    n = 0
    for b in bits:
        n = (n << 1) | b
    return format(n, f"0{hash_size * hash_size // 4}x")


def _hamming_distance(a: str, b: str) -> int:
    """Hamming distance between two equal-length hex hash strings."""
    if len(a) != len(b):
        return 64  # treat mismatched lengths as maximally different
    ia, ib = int(a, 16), int(b, 16)
    xor = ia ^ ib
    return bin(xor).count("1")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _job_dir(job_id: uuid.UUID, recipes_dir: Path = _DEFAULT_RECIPES_DIR) -> Path:
    return recipes_dir / str(job_id)


async def save_images(
    files,
    job_id: uuid.UUID,
    recipes_dir: Path = _DEFAULT_RECIPES_DIR,
) -> Path:
    """
    Persist uploaded UploadFile objects to <recipes_dir>/<job_id>/.
    Compresses and resizes images to avoid hitting the 5MB Bedrock limit
    and to save NAS storage space.
    Returns the job directory path.
    """
    import io
    from PIL import Image, ImageOps

    job_dir = _job_dir(job_id, recipes_dir)
    job_dir.mkdir(parents=True, exist_ok=True)

    MAX_SIZE = (1568, 1568)

    for i, file in enumerate(files):
        content = await file.read()
        
        try:
            with Image.open(io.BytesIO(content)) as img:
                # Correct orientation from EXIF (important for mobile photos)
                img = ImageOps.exif_transpose(img)
                # Convert to RGB to ensure we can save as JPEG
                if img.mode != "RGB":
                    img = img.convert("RGB")
                    
                # Downscale if larger than MAX_SIZE
                img.thumbnail(MAX_SIZE, Image.Resampling.LANCZOS)
                
                dest = job_dir / f"image_{i:02d}.jpg"
                img.save(dest, "JPEG", quality=85, optimize=True)
                
                new_size = dest.stat().st_size
                logger.debug(
                    "image saved and optimized", 
                    extra={"path": str(dest), "original_bytes": len(content), "new_bytes": new_size}
                )
        except Exception as e:
            logger.warning("Failed to optimize image, saving original", extra={"error": str(e)})
            # Fallback for unexpected formats (e.g. not an image) or Image module errors
            suffix = Path(file.filename).suffix if file.filename else ".jpg"
            dest = job_dir / f"image_{i:02d}{suffix}"
            dest.write_bytes(content)
            logger.debug("image saved without optimization", extra={"path": str(dest), "bytes": len(content)})

    return job_dir


def _validate_llm_result(parsed: dict) -> list[str]:
    """
    Validate the structured recipe dict returned by the LLM.
    Returns a list of error strings; empty list means valid.
    """
    errors: list[str] = []
    ingredients = parsed.get("ingredients") or []
    steps = parsed.get("steps") or []
    cooking_time = parsed.get("cooking_time_mins")

    if not ingredients:
        errors.append("LLM response contains no ingredients")
    if not steps:
        errors.append("LLM response contains no steps")

    if cooking_time is not None:
        if not isinstance(cooking_time, (int, float)) or cooking_time <= 0 or cooking_time > 300:
            errors.append(
                f"cooking_time_mins={cooking_time!r} is out of valid range (1–300)"
            )

    for ing in ingredients:
        qty = ing.get("quantity")
        # None means optional/garnish (e.g. "for decoration", "to taste") — coerce to 0
        if qty is None:
            ing["quantity"] = 0
        elif not isinstance(qty, (int, float)) or qty < 0:
            errors.append(
                f"Ingredient {ing.get('raw_name')!r} has invalid quantity: {qty!r}"
            )

    return errors


# ── Main pipeline ─────────────────────────────────────────────────────────────

async def run_ingestion(
    job_id: uuid.UUID,
    db: AsyncSession,
    redis_client,
    recipes_dir: Path = _DEFAULT_RECIPES_DIR,
) -> None:
    """
    Full ingestion pipeline called by the arq worker.

    Updates IngestJob.status throughout. All exceptions are caught and stored
    as status=FAILED so callers never need to handle arq task exceptions.
    """
    job = await db.get(IngestJob, job_id)
    if job is None:
        logger.error("IngestJob not found — skipping", extra={"job_id": str(job_id)})
        return

    try:
        # ── PROCESSING ────────────────────────────────────────────────────────
        job.status = IngestStatus.PROCESSING
        await db.commit()

        job_dir = _job_dir(job_id, recipes_dir)
        image_paths = sorted(job_dir.glob("image_*"))
        if not image_paths:
            raise ValueError(f"No images found in {job_dir}")

        # Rate-limit check before the (expensive) Bedrock call
        await check_and_increment(redis_client)

        # LLM call — raw response intentionally NOT logged (would bloat NAS logs)
        from app.services.bedrock import call_ingestion_llm
        raw_response, parsed = await call_ingestion_llm(image_paths)

        # Persist raw response immediately so it survives validation failures
        llm_out = LlmOutput(
            ingest_job_id=job_id,
            raw_llm_response=raw_response,
            parsed_result={},  # filled after normalisation below
        )
        db.add(llm_out)
        await db.flush()  # obtain llm_out.id before further operations

        # Validate LLM output structure
        errors = _validate_llm_result(parsed)
        if errors:
            raise ValueError("; ".join(errors))

        # Run normaliser on every ingredient (lookup + fuzzy only; no nested LLM calls)
        from app.services.normaliser import resolve_ingredient

        enriched: list[dict] = []
        unresolved: list[str] = []

        for ing in parsed.get("ingredients", []):
            result = await resolve_ingredient(
                raw_name=ing["raw_name"],
                db=db,
                redis_client=redis_client,
                use_llm=False,
            )
            entry = dict(ing)
            if result.ingredient:
                entry["ingredient_id"] = str(result.ingredient.id)
                entry["resolved"] = True
            else:
                entry["ingredient_id"] = None
                entry["resolved"] = False
                unresolved.append(ing["raw_name"])
            enriched.append(entry)

        # Store enriched result in llm_outputs (without the raw image data)
        parsed_result = {
            **{k: v for k, v in parsed.items() if k != "ingredients"},
            "ingredients": enriched,
            "unresolved_ingredients": unresolved,
        }
        llm_out.parsed_result = parsed_result
        job.status = IngestStatus.REVIEW
        await db.commit()
        ingestion_total.labels(status="success").inc()

        logger.info(
            "ingestion pipeline complete — awaiting user review",
            extra={
                "job_id": str(job_id),
                "title": parsed.get("title"),
                "unresolved_count": len(unresolved),
                "unresolved": unresolved,
            },
        )

    except RateLimitExceeded as exc:
        job.status = IngestStatus.FAILED
        job.error_message = str(exc)
        await db.commit()
        logger.warning(
            "ingestion aborted — rate limit exceeded",
            extra={"job_id": str(job_id), "retry_after": exc.retry_after},
        )

    except Exception as exc:
        job.status = IngestStatus.FAILED
        job.error_message = str(exc)
        await db.commit()
        ingestion_total.labels(status="error").inc()
        logger.error(
            "ingestion failed",
            extra={"job_id": str(job_id), "error": str(exc)},
            exc_info=True,
        )


# ── URL ingestion ─────────────────────────────────────────────────────────────

def _fetch_page_text(url: str, timeout: int = 10) -> str:
    """
    Fetch a URL and return stripped plain text (no HTML tags).
    Raises ValueError on HTTP errors or timeouts.
    """
    import html
    import re
    import urllib.request

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "WhatsForTea/1.0 (recipe import; contact via GitHub)",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # nosec B310 — URL validated by caller via HttpUrl
            raw = resp.read()
            charset = "utf-8"
            ct = resp.headers.get("Content-Type", "")
            if "charset=" in ct:
                charset = ct.split("charset=")[-1].split(";")[0].strip()
            page_html = raw.decode(charset, errors="replace")
    except Exception as exc:
        raise ValueError(f"Failed to fetch URL: {exc}") from exc

    # Remove <script>, <style>, <noscript> blocks
    page_html = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", page_html, flags=re.DOTALL | re.IGNORECASE)
    # Strip all remaining HTML tags
    text = re.sub(r"<[^>]+>", " ", page_html)
    # Decode HTML entities
    text = html.unescape(text)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


async def run_url_ingestion(
    job_id: uuid.UUID,
    url: str,
    db: AsyncSession,
    redis_client,
) -> None:
    """
    URL ingestion pipeline: fetch HTML → LLM extraction → normalise → REVIEW.

    Runs synchronously in the API request context (no arq queue).
    Updates IngestJob.status and stores LlmOutput on completion.
    """
    job = await db.get(IngestJob, job_id)
    if job is None:
        logger.error("IngestJob not found", extra={"job_id": str(job_id)})
        return

    try:
        job.status = IngestStatus.PROCESSING
        await db.commit()

        # Rate-limit before the LLM call
        await check_and_increment(redis_client)

        # Fetch + strip HTML (sync, run in thread to avoid blocking event loop)
        import asyncio
        import urllib.parse
        source_domain = urllib.parse.urlparse(url).netloc or url

        loop = asyncio.get_event_loop()
        page_text = await loop.run_in_executor(None, _fetch_page_text, url)

        # LLM call
        from app.services.bedrock import call_url_ingestion_llm
        raw_response, parsed = await call_url_ingestion_llm(page_text, source_domain)

        # Persist raw response
        llm_out = LlmOutput(
            ingest_job_id=job_id,
            raw_llm_response=raw_response,
            parsed_result={},
        )
        db.add(llm_out)
        await db.flush()

        # Validate
        errors = _validate_llm_result(parsed)
        if errors:
            raise ValueError("; ".join(errors))

        # Normalise ingredients
        from app.services.normaliser import resolve_ingredient
        enriched: list[dict] = []
        unresolved: list[str] = []

        for ing in parsed.get("ingredients", []):
            result = await resolve_ingredient(
                raw_name=ing["raw_name"],
                db=db,
                redis_client=redis_client,
                use_llm=False,
            )
            entry = dict(ing)
            if result.ingredient:
                entry["ingredient_id"] = str(result.ingredient.id)
                entry["resolved"] = True
            else:
                entry["ingredient_id"] = None
                entry["resolved"] = False
                unresolved.append(ing["raw_name"])
            enriched.append(entry)

        parsed_result = {
            **{k: v for k, v in parsed.items() if k != "ingredients"},
            "ingredients": enriched,
            "unresolved_ingredients": unresolved,
            "source_url": url,
        }
        llm_out.parsed_result = parsed_result
        job.status = IngestStatus.REVIEW
        await db.commit()
        ingestion_total.labels(status="success").inc()

        logger.info(
            "url ingestion complete — awaiting review",
            extra={
                "job_id": str(job_id),
                "url": url,
                "title": parsed.get("title"),
                "unresolved_count": len(unresolved),
            },
        )

    except RateLimitExceeded as exc:
        job.status = IngestStatus.FAILED
        job.error_message = str(exc)
        await db.commit()
        logger.warning("url ingestion aborted — rate limit", extra={"job_id": str(job_id)})

    except Exception as exc:
        job.status = IngestStatus.FAILED
        job.error_message = str(exc)
        await db.commit()
        ingestion_total.labels(status="error").inc()
        logger.error("url ingestion failed", extra={"job_id": str(job_id), "error": str(exc)}, exc_info=True)


# ── Receipt ingestion ─────────────────────────────────────────────────────────

def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract plain text from a PDF (e.g. Ocado order confirmation)."""
    import io
    import pdfplumber
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages)


async def run_receipt_ingestion(
    image_paths: list[Path] | None,
    text_content: str | None,
    db: AsyncSession,
    redis_client,
) -> list[dict]:
    """
    Synchronous receipt pipeline: LLM extraction → normalise each item.

    Returns a list of enriched dicts:
      {raw_name, quantity, unit, ingredient_id, resolved}

    No IngestJob needed — the flow is stateless; the frontend holds results
    until the user confirms, then calls /api/v1/pantry/bulk-confirm.
    """
    from app.services.bedrock import call_receipt_llm
    from app.services.normaliser import resolve_ingredient
    from app.services.rate_limiter import check_and_increment

    await check_and_increment(redis_client)

    _, items = await call_receipt_llm(image_paths, text_content)

    enriched: list[dict] = []
    for item in items:
        raw_name = item.get("raw_name", "").strip()
        if not raw_name:
            continue
        result = await resolve_ingredient(
            raw_name=raw_name,
            db=db,
            redis_client=redis_client,
            use_llm=False,
        )
        entry = {
            "raw_name": raw_name,
            "quantity": item.get("quantity", 1),
            "unit": item.get("unit"),
            "ingredient_id": str(result.ingredient.id) if result.ingredient else None,
            "resolved": result.ingredient is not None,
        }
        enriched.append(entry)

    logger.info(
        "receipt ingestion complete",
        extra={
            "item_count": len(enriched),
            "resolved_count": sum(1 for e in enriched if e["resolved"]),
        },
    )
    return enriched


# ── Confirm ───────────────────────────────────────────────────────────────────

def _crop_step_image(
    source_path: Path,
    bbox: list,
    dest_path: Path,
) -> bool:
    """
    Crop a step photo region from source_path using normalised bbox [x1,y1,x2,y2].
    Saves result as JPEG to dest_path. Returns True on success.
    """
    try:
        from PIL import Image
        with Image.open(source_path) as img:
            w, h = img.size
            x1 = int(bbox[0] * w)
            y1 = int(bbox[1] * h)
            x2 = int(bbox[2] * w)
            y2 = int(bbox[3] * h)
            # Sanity check — bbox must be a meaningful region
            if x2 <= x1 or y2 <= y1 or (x2 - x1) < 20 or (y2 - y1) < 20:
                return False
            crop = img.crop((x1, y1, x2, y2))
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            crop.save(dest_path, "JPEG", quality=85)
        return True
    except Exception as exc:
        logger.warning("step crop failed", extra={"source": str(source_path), "error": str(exc)})
        return False


async def confirm_recipe(
    job_id: uuid.UUID,
    recipe_data: RecipeCreate,
    db: AsyncSession,
    force: bool = False,
) -> Recipe:
    """
    User-confirmed: validate, insert Recipe into the DB, and mark job COMPLETE.

    Raises ValueError for:
    - Job not found or not in REVIEW status
    - Any ingredient without ingredient_id (must be resolved before confirming)
    """
    unresolved = [
        ing.raw_name for ing in recipe_data.ingredients if ing.ingredient_id is None
    ]
    if unresolved:
        logger.info(
            "confirming recipe with unresolved ingredients — they won't contribute to pantry matching",
            extra={"unresolved": unresolved},
        )

    job = await db.get(IngestJob, job_id)
    if job is None:
        raise ValueError(f"IngestJob {job_id} not found")
    if job.status == IngestStatus.COMPLETE:
        # Already confirmed — return the saved recipe idempotently
        llm_stmt = (
            select(LlmOutput)
            .where(LlmOutput.ingest_job_id == job_id)
            .order_by(LlmOutput.created_at.desc())
            .limit(1)
        )
        llm_out = (await db.execute(llm_stmt)).scalar_one_or_none()
        if llm_out and llm_out.recipe_id:
            recipe_stmt = (
                select(Recipe)
                .options(selectinload(Recipe.ingredients), selectinload(Recipe.steps))
                .where(Recipe.id == llm_out.recipe_id)
            )
            return (await db.execute(recipe_stmt)).scalar_one()
        raise ValueError(f"Job {job_id} is complete but recipe not found")
    if job.status != IngestStatus.REVIEW:
        raise ValueError(
            f"Job {job_id} cannot be confirmed — current status: {job.status.value!r} "
            f"(expected 'review')"
        )

    # Load the most recent LlmOutput for this job (to link recipe_id and store corrections)
    stmt = (
        select(LlmOutput)
        .where(LlmOutput.ingest_job_id == job_id)
        .order_by(LlmOutput.created_at.desc())
        .limit(1)
    )
    llm_out = (await db.execute(stmt)).scalar_one_or_none()

    # Use the LLM's front_cover_index to pick the hero image.
    # Falls back to the last image if the field is absent or out of range.
    job_dir = Path(job.image_dir)
    image_paths = sorted(job_dir.glob("image_*"))
    if image_paths:
        llm_stmt_hero = (
            select(LlmOutput)
            .where(LlmOutput.ingest_job_id == job_id)
            .order_by(LlmOutput.created_at.desc())
            .limit(1)
        )
        llm_out_hero = (await db.execute(llm_stmt_hero)).scalar_one_or_none()
        front_idx = None
        if llm_out_hero and llm_out_hero.parsed_result:
            raw_idx = llm_out_hero.parsed_result.get("front_cover_index")
            if isinstance(raw_idx, int) and 0 <= raw_idx < len(image_paths):
                front_idx = raw_idx
        if front_idx is None:
            front_idx = len(image_paths) - 1  # fallback: last image
        hero_image_path = str(image_paths[front_idx])
    else:
        hero_image_path = None

    # ── Duplicate detection ───────────────────────────────────────────────────
    fingerprint: str | None = None
    if hero_image_path and Path(hero_image_path).exists():
        try:
            fingerprint = _compute_dhash(Path(hero_image_path))

            if not force:
                # Check all existing recipes for a near-duplicate image
                existing_stmt = select(Recipe).where(Recipe.image_fingerprint.isnot(None))
                existing = (await db.execute(existing_stmt)).scalars().all()
                for existing_recipe in existing:
                    if existing_recipe.image_fingerprint and \
                            _hamming_distance(fingerprint, existing_recipe.image_fingerprint) <= 8:
                        raise DuplicateRecipeError(existing_recipe.id, existing_recipe.title)
        except DuplicateRecipeError:
            raise
        except Exception as e:
            logger.warning("image fingerprinting failed — skipping duplicate check", extra={"error": str(e)})
            fingerprint = None

    # Fuzzy title check — soft warning only (logged, not a hard block)
    from rapidfuzz import fuzz as rfuzz
    title_stmt = select(Recipe.id, Recipe.title)
    existing_titles = (await db.execute(title_stmt)).all()
    for eid, etitle in existing_titles:
        score = rfuzz.token_sort_ratio(recipe_data.title.lower(), etitle.lower()) / 100
        if score >= 0.90:
            logger.warning(
                "similar recipe title detected — possible duplicate",
                extra={"new_title": recipe_data.title, "existing_title": etitle, "similarity": score},
            )
            break

    # Pick up source_url from LlmOutput (set by URL imports) or from the recipe data itself
    source_url = recipe_data.source_url
    if not source_url and llm_out and llm_out.parsed_result:
        source_url = llm_out.parsed_result.get("source_url")

    from datetime import datetime, timezone
    nutrition_dict = recipe_data.nutrition.model_dump() if recipe_data.nutrition else None
    nutrition_at = datetime.now(timezone.utc) if nutrition_dict else None

    recipe = Recipe(
        title=recipe_data.title,
        hello_fresh_style=recipe_data.hello_fresh_style,
        cooking_time_mins=recipe_data.cooking_time_mins,
        base_servings=recipe_data.base_servings,
        source_type=recipe_data.source_type,
        source_reference=recipe_data.source_reference,
        source_url=source_url,
        mood_tags=recipe_data.mood_tags,
        hero_image_path=hero_image_path,
        image_fingerprint=fingerprint,
        nutrition_estimate=nutrition_dict,
        nutrition_estimated_at=nutrition_at,
    )
    db.add(recipe)
    await db.flush()  # get recipe.id

    for ing_data in recipe_data.ingredients:
        db.add(RecipeIngredient(
            recipe_id=recipe.id,
            ingredient_id=ing_data.ingredient_id,
            raw_name=ing_data.raw_name,
            quantity=ing_data.quantity,
            unit=ing_data.unit,
            servings_quantities=ing_data.servings_quantities,
        ))

    # Build bbox lookup from LlmOutput for step crop extraction
    llm_step_bboxes: dict[int, list] = {}
    if llm_out and llm_out.parsed_result:
        for s in llm_out.parsed_result.get("steps", []):
            bbox = s.get("image_bbox")
            if bbox and isinstance(bbox, list) and len(bbox) == 4:
                llm_step_bboxes[s.get("order", 0)] = bbox

    # Use the back image (index 0 per HelloFresh convention = back = steps side) for crops
    back_image_path: Path | None = None
    if image_paths:
        back_idx = 1 - (front_idx or 0) if len(image_paths) > 1 else (front_idx or 0)
        back_idx = max(0, min(back_idx, len(image_paths) - 1))
        back_image_path = image_paths[back_idx]

    for step_data in recipe_data.steps:
        crop_path: str | None = None
        bbox = llm_step_bboxes.get(step_data.order)
        if bbox and back_image_path and back_image_path.exists():
            crop_dest = job_dir / f"step_{step_data.order:02d}_crop.jpg"
            if _crop_step_image(back_image_path, bbox, crop_dest):
                crop_path = str(crop_dest)

        db.add(Step(
            recipe_id=recipe.id,
            order=step_data.order,
            text=step_data.text,
            timer_seconds=step_data.timer_seconds,
            image_description=step_data.image_description,
            image_crop_path=crop_path,
        ))

    if llm_out:
        llm_out.recipe_id = recipe.id
        # Record user corrections if the confirmed data differs from the LLM parse
        confirmed_dict = recipe_data.model_dump(mode="json")
        if confirmed_dict != llm_out.parsed_result:
            llm_out.user_corrected = confirmed_dict

    job.status = IngestStatus.COMPLETE
    await db.commit()

    # Reload with relationships eagerly — lazy loading doesn't work in async SQLAlchemy
    stmt = (
        select(Recipe)
        .options(selectinload(Recipe.ingredients), selectinload(Recipe.steps))
        .where(Recipe.id == recipe.id)
    )
    recipe = (await db.execute(stmt)).scalar_one()

    logger.info(
        "recipe confirmed and saved",
        extra={"recipe_id": str(recipe.id), "title": recipe.title},
    )
    return recipe
