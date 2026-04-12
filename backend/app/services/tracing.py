"""
Langfuse tracing utility.

Usage in any LangGraph / LangChain call:

    from app.services.tracing import get_langfuse_handler

    handler = get_langfuse_handler(user_id="abc", session_id=thread_id)
    await graph.ainvoke(state, config={"callbacks": [handler]})

Returns None when Langfuse is not configured so callers can pass
``callbacks=[h for h in [handler] if h]`` without branching.
"""
import logging
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)

_langfuse_client = None


def _client():
    """Lazily initialise the Langfuse client (once per process)."""
    global _langfuse_client
    if _langfuse_client is not None:
        return _langfuse_client
    if not settings.langfuse_public_key or not settings.langfuse_secret_key:
        return None
    try:
        from langfuse import Langfuse
        _langfuse_client = Langfuse(
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key,
            host=settings.langfuse_host,
        )
        logger.info("Langfuse tracing enabled → %s", settings.langfuse_host)
    except Exception:
        logger.warning("Langfuse initialisation failed — tracing disabled", exc_info=True)
    return _langfuse_client


def get_langfuse_handler(
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
) -> Optional[object]:
    """
    Return a LangChain CallbackHandler for the given user/session, or None
    if Langfuse is not configured.
    """
    client = _client()
    if client is None:
        return None
    try:
        from langfuse.callback import CallbackHandler
        return CallbackHandler(
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key,
            host=settings.langfuse_host,
            user_id=user_id,
            session_id=session_id,
            trace_name="teabot",
        )
    except Exception:
        logger.warning("Could not create Langfuse callback handler", exc_info=True)
        return None
