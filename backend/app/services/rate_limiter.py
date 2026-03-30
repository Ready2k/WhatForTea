"""
Redis-backed sliding-window rate limiter for LLM calls.
Uses hourly buckets keyed by Unix epoch // 3600.
Limit is read from agent_config/agent_settings.yaml so it can be
tuned without touching Python code.
"""
import time
from functools import lru_cache
from pathlib import Path

import yaml

_SETTINGS_PATH = Path(__file__).parent.parent.parent / "agent_config" / "agent_settings.yaml"
_KEY_PREFIX = "rate_limit:llm"


@lru_cache(maxsize=1)
def _get_limit() -> int:
    with open(_SETTINGS_PATH) as f:
        cfg = yaml.safe_load(f)
    return int(cfg.get("llm_rate_limit_per_hour", 20))


class RateLimitExceeded(Exception):
    """Raised when the hourly LLM call limit is exceeded."""

    def __init__(self, limit: int, retry_after: int) -> None:
        self.limit = limit
        self.retry_after = retry_after
        super().__init__(f"LLM rate limit of {limit}/hour exceeded. Retry after {retry_after}s.")


async def check_and_increment(redis_client) -> None:
    """
    Increment the hourly LLM call counter and raise RateLimitExceeded if over limit.
    Uses hour-bucketed keys so counters reset automatically without a scheduled job.
    """
    limit = _get_limit()
    hour_bucket = int(time.time()) // 3600
    key = f"{_KEY_PREFIX}:{hour_bucket}"

    count = await redis_client.incr(key)
    if count == 1:
        # First call this hour — set TTL slightly past the hour so the bucket
        # survives the full window even if checked right at the boundary.
        await redis_client.expire(key, 3700)

    if count > limit:
        retry_after = 3600 - (int(time.time()) % 3600)
        raise RateLimitExceeded(limit=limit, retry_after=retry_after)
