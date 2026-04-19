from typing import Literal, Optional
from pydantic import BaseModel


class VoiceCommandRequest(BaseModel):
    transcript: str
    context: Optional[str] = None  # e.g. "session_notes" to bias intent detection


class VoiceCommandResponse(BaseModel):
    intent: Literal["add_to_list", "session_note", "navigation", "cooking_question", "repeat", "stop", "unknown"]
    item: Optional[str] = None       # for add_to_list: the extracted item name
    note: Optional[str] = None       # for session_note: cleaned note text
    direction: Optional[str] = None  # for navigation: "next" or "back"
    answer: Optional[str] = None     # for cooking_question: spoken response
    raw_transcript: str
