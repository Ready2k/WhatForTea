"""
Redis-backed sliding-window rate limiter for LLM calls.
Uses hourly buckets keyed by Unix epoch // 3600.
Limit is read from agent_config/agent_settings.yaml so it can be
tuned without touching Python code (changes take effect within 30 seconds).
"""
import logging
import time
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger("whatsfortea.audit")

_SETTINGS_PATH = Path(__file__).parent.parent.parent / "agent_config" / "agent_settings.yaml"
_KEY_PREFIX = "rate_limit:llm"

# Simple TTL cache — re-reads YAML at most once every 30 seconds so edits
# take effect quickly without hammering the filesystem on every request.
_settings_cache: dict[str, Any] = {}
_settings_cache_at: float = 0.0
_SETTINGS_TTL = 30.0


def _load_settings() -> dict[str, Any]:
    global _settings_cache, _settings_cache_at
    now = time.monotonic()
    if _settings_cache and (now - _settings_cache_at) < _SETTINGS_TTL:
        return _settings_cache
    try:
        with open(_SETTINGS_PATH) as f:
            _settings_cache = yaml.safe_load(f) or {}
        _settings_cache_at = now
    except Exception:
        logger.warning("rate_limiter: failed to read agent_settings.yaml — using cached values")
    return _settings_cache


def _get_limit() -> int:
    return int(_load_settings().get("llm_rate_limit_per_hour", 20))


def _get_chat_limit() -> int:
    return int(_load_settings().get("chat_rate_limit_per_minute", 20))


class RateLimitExceeded(Exception):
    """Raised when the hourly LLM call limit is exceeded."""

    def __init__(self, limit: int, retry_after: int) -> None:
        self.limit = limit
        self.retry_after = retry_after
        super().__init__(f"LLM rate limit of {limit}/hour exceeded. Retry after {retry_after}s.")


async def check_user_chat_rate(redis_client, user_id: str) -> None:
    """
    Per-user per-minute rate limit for TeaBot chat.
    Falls back to a shared key when user_id is empty (legacy auth mode).
    Silently skips enforcement if Redis is unavailable.
    """
    limit = _get_chat_limit()
    minute_bucket = int(time.time()) // 60
    safe_id = user_id if user_id else "anon"
    key = f"rate_limit:chat:{safe_id}:{minute_bucket}"

    try:
        count = await redis_client.incr(key)
        if count == 1:
            await redis_client.expire(key, 120)
    except Exception:
        logger.warning("rate_limit.redis_error — skipping chat rate limit", exc_info=True)
        return

    if count > limit:
        retry_after = 60 - (int(time.time()) % 60)
        logger.warning("rate_limit.chat_exceeded", extra={"user_id": safe_id, "count": count, "limit": limit})
        raise RateLimitExceeded(limit=limit, retry_after=retry_after)


async def check_and_increment(redis_client) -> None:
    """
    Increment the hourly LLM call counter and raise RateLimitExceeded if over limit.
    Uses hour-bucketed keys so counters reset automatically without a scheduled job.
    Silently skips enforcement if Redis is unavailable.
    """
    limit = _get_limit()
    hour_bucket = int(time.time()) // 3600
    key = f"{_KEY_PREFIX}:{hour_bucket}"

    try:
        count = await redis_client.incr(key)
        if count == 1:
            # First call this hour — set TTL slightly past the hour so the bucket
            # survives the full window even if checked right at the boundary.
            await redis_client.expire(key, 3700)
    except Exception:
        logger.warning("rate_limit.redis_error — skipping LLM rate limit", exc_info=True)
        return

    if count > limit:
        retry_after = 3600 - (int(time.time()) % 3600)
        raise RateLimitExceeded(limit=limit, retry_after=retry_after)
