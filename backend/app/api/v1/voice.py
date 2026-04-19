"""
Voice command API — parses a speech transcript into a structured intent.
"""
import logging

from fastapi import APIRouter, HTTPException

from app.schemas.voice import VoiceCommandRequest, VoiceCommandResponse
from app.services.bedrock import call_voice_command_llm

_MAX_TRANSCRIPT_CHARS = 500
_MAX_CONTEXT_CHARS = 100

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/voice", tags=["voice"])


@router.post("/command", response_model=VoiceCommandResponse)
async def process_voice_command(body: VoiceCommandRequest):
    """
    Parse a voice transcript into a structured intent.

    Intents:
    - add_to_list: user wants to add an item to the shopping list
    - session_note: user is narrating a cook note (cleaned up text returned)
    - navigation: next/back step command
    - unknown: could not classify

    The `context` field biases intent detection — pass "session_notes" when
    capturing post-cook dictation to favour the session_note intent.
    """
    if len(body.transcript) > _MAX_TRANSCRIPT_CHARS:
        raise HTTPException(status_code=400, detail="Transcript too long.")
    if body.context and len(body.context) > _MAX_CONTEXT_CHARS:
        raise HTTPException(status_code=400, detail="Context field too long.")

    parsed = await call_voice_command_llm(body.transcript, body.context)

    intent = parsed.get("intent", "unknown")
    if intent not in ("add_to_list", "session_note", "navigation", "cooking_question", "repeat", "stop", "unknown"):
        intent = "unknown"

    return VoiceCommandResponse(
        intent=intent,
        item=parsed.get("item") or None,
        note=parsed.get("note") or None,
        direction=parsed.get("direction") or None,
        answer=parsed.get("answer") or None,
        raw_transcript=body.transcript,
    )
