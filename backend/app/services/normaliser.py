"""
Ingredient Normaliser — 4-layer pipeline:

  1. Lookup    — case-insensitive exact match on ingredient.aliases
  2. Fuzzy     — rapidfuzz token_sort_ratio across all canonical names + aliases
  3. LLM       — Claude via Bedrock for borderline fuzzy scores (result cached in Redis)
  4. User      — unresolved items returned to the caller for manual override

Thresholds are read from agent_config/agent_settings.yaml so they can be
tuned without touching Python code.
"""
import json
import logging
from dataclasses import dataclass
from enum import Enum
from functools import lru_cache
from pathlib import Path
from typing import Optional

import yaml
from rapidfuzz import fuzz
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ingredient import Ingredient

logger = logging.getLogger(__name__)

_SETTINGS_PATH = Path(__file__).parent.parent.parent / "agent_config" / "agent_settings.yaml"


@lru_cache(maxsize=1)
def _load_thresholds() -> dict:
    with open(_SETTINGS_PATH) as f:
        cfg = yaml.safe_load(f)
    return {
        "auto_accept": float(cfg.get("fuzzy_threshold_auto_accept", 0.85)),
        "llm_assist": float(cfg.get("fuzzy_threshold_llm_assist", 0.60)),
    }


class ResolveSource(str, Enum):
    LOOKUP = "lookup"
    FUZZY = "fuzzy"
    LLM = "llm"
    NEW = "new"


@dataclass
class ResolveResult:
    ingredient: Optional[Ingredient]
    confidence: float
    source: ResolveSource


async def resolve_ingredient(
    raw_name: str,
    db: AsyncSession,
    redis_client=None,
    use_llm: bool = True,
) -> ResolveResult:
    """
    Resolve a raw ingredient name to a canonical Ingredient row.

    Returns ResolveResult with:
    - ingredient=None if unresolved (source="new", confidence=0.0)
    - ingredient=<row> with confidence + source for resolved cases
    """
    normalised_raw = raw_name.strip().lower()

    # ── Layer 1: Lookup ───────────────────────────────────────────────────────
    result = await _lookup(normalised_raw, db)
    if result:
        return ResolveResult(ingredient=result, confidence=1.0, source=ResolveSource.LOOKUP)

    # ── Layer 2: Fuzzy ────────────────────────────────────────────────────────
    thresholds = _load_thresholds()
    all_ingredients = await _fetch_all(db)

    best_score = 0.0
    best_ingredient: Optional[Ingredient] = None

    for ingredient in all_ingredients:
        score = _fuzzy_score(normalised_raw, ingredient)
        if score > best_score:
            best_score = score
            best_ingredient = ingredient

    if best_score >= thresholds["auto_accept"] and best_ingredient:
        logger.info(
            "normaliser fuzzy match",
            extra={"raw": raw_name, "canonical": best_ingredient.canonical_name, "score": best_score},
        )
        return ResolveResult(
            ingredient=best_ingredient,
            confidence=best_score,
            source=ResolveSource.FUZZY,
        )

    # ── Layer 3: LLM assist ──────────────────────────────────────────────────
    if (
        use_llm
        and best_ingredient is not None
        and best_score >= thresholds["llm_assist"]
    ):
        llm_result = await _llm_assist(
            raw_name, best_ingredient, redis_client
        )
        if llm_result is not None:
            return llm_result

    # ── Layer 4: Unresolved ───────────────────────────────────────────────────
    logger.info(
        "normaliser unresolved",
        extra={"raw": raw_name, "best_score": best_score},
    )
    return ResolveResult(ingredient=None, confidence=0.0, source=ResolveSource.NEW)


async def apply_override(
    raw_name: str,
    canonical_id,
    db: AsyncSession,
) -> Ingredient:
    """
    Persist a user-supplied mapping: append raw_name to ingredient.aliases.
    Raises ValueError if the canonical_id doesn't exist.
    """
    result = await db.get(Ingredient, canonical_id)
    if result is None:
        raise ValueError(f"Ingredient {canonical_id} not found")

    normalised = raw_name.strip().lower()
    existing = [a.lower() for a in (result.aliases or [])]
    if normalised not in existing:
        result.aliases = list(result.aliases or []) + [raw_name.strip()]
        await db.commit()
        await db.refresh(result)
        logger.info(
            "normaliser override applied",
            extra={"raw": raw_name, "canonical": result.canonical_name},
        )
    return result


# ── Private helpers ───────────────────────────────────────────────────────────

async def _lookup(normalised_raw: str, db: AsyncSession) -> Optional[Ingredient]:
    """Case-insensitive exact match against canonical_name and all aliases."""
    stmt = select(Ingredient).where(
        Ingredient.canonical_name.ilike(normalised_raw)
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row:
        return row

    # Check aliases — PostgreSQL ARRAY contains any element case-insensitively
    # We fetch all and check in Python to avoid complex array SQL; for large
    # datasets this should be replaced with a GIN-indexed array query.
    all_ingredients = await _fetch_all(db)
    for ingredient in all_ingredients:
        if any(a.lower() == normalised_raw for a in (ingredient.aliases or [])):
            return ingredient

    return None


async def _fetch_all(db: AsyncSession) -> list[Ingredient]:
    """Fetch all ingredients. Result is cached within a request via SQLAlchemy identity map."""
    result = await db.execute(select(Ingredient))
    return list(result.scalars().all())


def _fuzzy_score(normalised_raw: str, ingredient: Ingredient) -> float:
    """Return the best rapidfuzz score (0–1) across canonical name and all aliases."""
    candidates = [ingredient.canonical_name.lower()] + [
        a.lower() for a in (ingredient.aliases or [])
    ]
    best = max(
        fuzz.token_sort_ratio(normalised_raw, candidate) / 100.0
        for candidate in candidates
    )
    return best


async def _llm_assist(
    raw_name: str,
    candidate: Ingredient,
    redis_client,
) -> Optional[ResolveResult]:
    """
    Call Claude via Bedrock to decide if raw_name matches candidate.
    Caches the result in Redis to avoid repeated calls for the same pair.
    Returns ResolveResult if LLM says match, else None.
    """
    cache_key = f"normaliser:llm:{raw_name.lower()}:{candidate.canonical_name.lower()}"

    # Check Redis cache first
    if redis_client is not None:
        try:
            cached = await redis_client.get(cache_key)
            if cached:
                data = json.loads(cached)
                if data.get("match"):
                    return ResolveResult(
                        ingredient=candidate,
                        confidence=float(data.get("confidence", 0.8)),
                        source=ResolveSource.LLM,
                    )
                return None
        except Exception as exc:
            logger.warning("Redis cache read failed", extra={"error": str(exc)})

    # Import here to avoid circular imports and keep LLM calls lazy
    from app.services.bedrock import call_normaliser_llm

    data = await call_normaliser_llm(raw_name, candidate.canonical_name)

    # Cache for 24 hours
    if redis_client is not None:
        try:
            await redis_client.set(cache_key, json.dumps(data), ex=86400)
        except Exception as exc:
            logger.warning("Redis cache write failed", extra={"error": str(exc)})

    if data.get("match"):
        confidence = float(data.get("confidence", 0.8))
        logger.info(
            "normaliser LLM match",
            extra={"raw": raw_name, "canonical": candidate.canonical_name, "confidence": confidence},
        )
        return ResolveResult(
            ingredient=candidate,
            confidence=confidence,
            source=ResolveSource.LLM,
        )
    return None
