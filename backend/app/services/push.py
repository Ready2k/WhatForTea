"""Web Push notification service using pywebpush + VAPID."""
import asyncio
import json
import logging
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)


def _send_sync(subscription_info: dict[str, Any], payload: dict[str, Any]) -> None:
    """Synchronous pywebpush call — run in a thread executor to avoid blocking."""
    from pywebpush import webpush, WebPushException  # type: ignore[import]

    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps(payload),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": f"mailto:{settings.vapid_claims_email}"},
        )
    except WebPushException as exc:
        status = getattr(exc.response, "status_code", None)
        if status == 410:
            raise _GoneError(subscription_info["endpoint"]) from exc
        logger.warning("push send failed", extra={"status": status, "error": str(exc)})
        raise


class _GoneError(Exception):
    def __init__(self, endpoint: str) -> None:
        self.endpoint = endpoint


async def send_to_subscription(subscription_info: dict[str, Any], payload: dict[str, Any]) -> bool:
    """Send one push notification. Returns False if the subscription is stale (410 Gone)."""
    if not settings.vapid_private_key:
        return True
    try:
        await asyncio.to_thread(_send_sync, subscription_info, payload)
        return True
    except _GoneError:
        return False
    except Exception as exc:
        logger.warning("push notification failed", extra={"error": str(exc)})
        return True


async def send_to_household(household_id: str, payload: dict[str, Any]) -> None:
    """Send a push notification to every subscription registered for a household."""
    if not settings.vapid_private_key:
        return

    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.push import PushSubscription
    import uuid

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PushSubscription).where(PushSubscription.household_id == uuid.UUID(str(household_id)))
        )
        subs = result.scalars().all()

    stale_endpoints: list[str] = []
    for sub in subs:
        info = {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}}
        still_valid = await send_to_subscription(info, payload)
        if not still_valid:
            stale_endpoints.append(sub.endpoint)

    if stale_endpoints:
        await _remove_stale(stale_endpoints)


async def _remove_stale(endpoints: list[str]) -> None:
    from sqlalchemy import delete
    from app.database import AsyncSessionLocal
    from app.models.push import PushSubscription

    async with AsyncSessionLocal() as db:
        await db.execute(delete(PushSubscription).where(PushSubscription.endpoint.in_(endpoints)))
        await db.commit()
    logger.info("removed stale push subscriptions", extra={"count": len(endpoints)})
