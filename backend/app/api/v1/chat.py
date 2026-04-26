"""
TeaBot chat endpoint.

POST /api/v1/chat        — SSE stream; graph pauses at interrupt() for HITL
POST /api/v1/chat/resume — resume an interrupted thread after user decision

SSE event types:
  { "type": "text_delta",   "content": "..." }
  { "type": "hitl_waiting", "thread_id": "...", "widget": {...} }
  { "type": "done",         "thread_id": "..." }
  { "type": "error",        "message": "..." }
"""
import json
import logging
import uuid
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage
from langgraph.types import Command
from pydantic import BaseModel

from app.services.rate_limiter import RateLimitExceeded, check_user_chat_rate
from app.services.tracing import get_langfuse_handler, score_trace

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["chat"])

_MAX_MESSAGES = 40
_MAX_MSG_CHARS = 4_000
_ALLOWED_ROLES = {"user", "assistant"}
_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


# ── Schemas ───────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    thread_id: Optional[str] = None


class ResumeRequest(BaseModel):
    thread_id: str
    decision: Literal["confirm", "reject"]
    quantity: Optional[float] = None


class FeedbackRequest(BaseModel):
    trace_id: str
    value: Literal[1, -1]
    comment: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_graph(request: Request):
    graph = getattr(request.app.state, "teabot_graph", None)
    if graph is None:
        logger.warning("teabot_graph not on app.state — compiling without checkpointer")
        from app.agents.teabot import teabot_workflow
        return teabot_workflow.compile()
    return graph


async def _check_for_interrupt(graph, config: dict) -> Optional[dict]:
    """Return the interrupt widget dict if the graph is paused, else None."""
    try:
        state = await graph.aget_state(config)
        if state.next and state.tasks:
            for task in state.tasks:
                for intr in task.interrupts:
                    if isinstance(intr.value, dict) and "widget" in intr.value:
                        return intr.value["widget"]
    except Exception:
        logger.warning("Could not check graph interrupt state", exc_info=True)
    return None


# ── POST /api/v1/chat ─────────────────────────────────────────────────────────

@router.post("/chat")
async def chat(body: ChatRequest, request: Request):
    if len(body.messages) > _MAX_MESSAGES:
        raise HTTPException(status_code=400, detail="Too many messages in conversation history.")
    for msg in body.messages:
        if msg.role not in _ALLOWED_ROLES:
            raise HTTPException(status_code=400, detail=f"Invalid message role: {msg.role!r}")
        if len(msg.content) > _MAX_MSG_CHARS:
            raise HTTPException(status_code=400, detail="Message content exceeds maximum length.")

    user_messages = [m for m in body.messages if m.role == "user"]
    if not user_messages:
        raise HTTPException(status_code=400, detail="No user message found.")

    thread_id = body.thread_id or str(uuid.uuid4())
    user_id = getattr(request.state, "user_id", None)
    household_id = getattr(request.state, "household_id", None)

    redis_client = getattr(request.app.state, "redis", None)
    if redis_client is not None:
        try:
            await check_user_chat_rate(redis_client, str(user_id) if user_id else "anon")
        except RateLimitExceeded as exc:
            raise HTTPException(
                status_code=429,
                detail=f"Too many requests. Please wait {exc.retry_after} seconds.",
                headers={"Retry-After": str(exc.retry_after)},
            )
        except Exception:
            logger.warning("chat rate-limit check failed — skipping", exc_info=True)

    graph = _get_graph(request)

    async def generate():
        try:
            handler = get_langfuse_handler(user_id=str(user_id) if user_id else None, session_id=thread_id)
            config = {
                "configurable": {"thread_id": thread_id, "household_id": household_id},
                "callbacks": [h for h in [handler] if h],
            }
            input_state = {
                "messages": [HumanMessage(content=user_messages[-1].content)],
                "hitl_status": "idle",
                "a2ui": [],
                "error": None,
            }

            async for event in graph.astream_events(input_state, config=config, version="v2"):
                if event["event"] == "on_chat_model_stream":
                    chunk = event["data"]["chunk"]
                    if chunk.content:
                        yield f"data: {json.dumps({'type': 'text_delta', 'content': chunk.content})}\n\n"

            # Check whether the graph paused at a HITL interrupt
            widget = await _check_for_interrupt(graph, config)
            if widget:
                yield f"data: {json.dumps({'type': 'hitl_waiting', 'thread_id': thread_id, 'widget': widget})}\n\n"

            trace_id = None
            try:
                if handler is not None and getattr(handler, "trace", None) is not None:
                    trace_id = handler.trace.id
            except Exception:  # nosec B110 — Langfuse tracing is optional; never block response
                pass
            yield f"data: {json.dumps({'type': 'done', 'thread_id': thread_id, 'trace_id': trace_id})}\n\n"

        except Exception as exc:
            logger.error("Chat stream error", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream", headers=_SSE_HEADERS)


# ── POST /api/v1/chat/feedback ────────────────────────────────────────────────

@router.post("/chat/feedback", status_code=204)
async def chat_feedback(body: FeedbackRequest, request: Request):
    """Submit thumbs-up (value=1) or thumbs-down (value=-1) for a TeaBot response."""
    score_trace(trace_id=body.trace_id, value=body.value, comment=body.comment)


# ── POST /api/v1/chat/resume ──────────────────────────────────────────────────

@router.post("/chat/resume")
async def chat_resume(body: ResumeRequest, request: Request):
    """Resume a graph that is paused at a HITL interrupt."""
    graph = _get_graph(request)
    user_id = getattr(request.state, "user_id", None)
    household_id = getattr(request.state, "household_id", None)

    async def generate():
        try:
            handler = get_langfuse_handler(
                user_id=str(user_id) if user_id else None,
                session_id=body.thread_id,
            )
            config = {
                "configurable": {"thread_id": body.thread_id, "household_id": household_id},
                "callbacks": [h for h in [handler] if h],
            }
            resume_value: dict = {"decision": body.decision}
            if body.quantity is not None:
                resume_value["quantity"] = body.quantity

            async for event in graph.astream_events(
                Command(resume=resume_value),
                config=config,
                version="v2",
            ):
                if event["event"] == "on_chat_model_stream":
                    chunk = event["data"]["chunk"]
                    if chunk.content:
                        yield f"data: {json.dumps({'type': 'text_delta', 'content': chunk.content})}\n\n"

            # If the graph paused at a new interrupt (e.g. the LLM generated
            # another pantry_confirm after resume), surface it so the frontend
            # can wire up the HITL card with the correct thread_id.
            widget = await _check_for_interrupt(graph, config)
            if widget:
                yield f"data: {json.dumps({'type': 'hitl_waiting', 'thread_id': body.thread_id, 'widget': widget})}\n\n"

            yield f"data: {json.dumps({'type': 'done', 'thread_id': body.thread_id})}\n\n"

        except Exception as exc:
            logger.error("Chat resume error", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream", headers=_SSE_HEADERS)
