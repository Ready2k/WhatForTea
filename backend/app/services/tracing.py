"""
Langfuse tracing utility.

Usage in any LangGraph / LangChain call:

    from app.services.tracing import get_langfuse_handler

    handler = get_langfuse_handler(user_id="abc", session_id=thread_id)
    await graph.ainvoke(state, config={"callbacks": [handler]})

Usage in raw boto3 LLM calls (bedrock.py):

    from langfuse.decorators import observe, langfuse_context

    @observe(as_type="generation", name="my_llm_call")
    async def call_something_llm(...):
        ...
        langfuse_context.update_current_observation(model=model, input=..., output=text,
            usage={"input": prompt_tokens, "output": completion_tokens})

Returns None from get_langfuse_handler when Langfuse is not configured so callers can pass
``callbacks=[h for h in [handler] if h]`` without branching.
"""
import logging
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)

_langfuse_client = None


def init_langfuse() -> None:
    """
    Eagerly initialise the Langfuse client at startup so the enabled/disabled
    log fires immediately rather than on the first LLM request.
    """
    _client()
    if not _langfuse_client:
        logger.info("Langfuse tracing disabled (keys not configured)")


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


def score_trace(trace_id: str, value: float, comment: Optional[str] = None) -> None:
    """
    Attach a numeric score to a Langfuse trace.
    value=1 → thumbs up, value=-1 → thumbs down.
    No-op if Langfuse is not configured.
    """
    client = _client()
    if client is None:
        return
    try:
        client.score(
            trace_id=trace_id,
            name="user_feedback",
            value=value,
            data_type="NUMERIC",
            comment=comment,
        )
    except Exception:
        logger.warning("Failed to submit Langfuse score", exc_info=True)


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
