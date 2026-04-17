from typing import TypedDict, Literal, List, Optional
from langgraph.graph import StateGraph, END
from langchain_core.messages import BaseMessage

class IngestAgentState(TypedDict):
    """
    Ingest Session CoAgent.
    Handles URL and Image imports.
    """
    messages: List[BaseMessage]
    job_id: Optional[str]
    source_url: Optional[str]
    parsed_recipe: Optional[dict]
    hitl_status: Literal["idle", "waiting", "applied", "rejected"]
    a2ui: List[dict]
    error: Optional[str]

async def ingest_node(state: IngestAgentState):
    """
    Manages active ingest session and renders Review UI.
    Requires HITL to confirm an import.
    """
    job_id = state.get("job_id")
    source_url = state.get("source_url")
    hitl_status = state.get("hitl_status", "idle")
    
    a2ui = []
    
    # If hitl_status is waiting, we present the IngestReview widget
    if hitl_status == "waiting" and job_id:
        # We would theoretically load the LlmOutput here for review
        a2ui.append({
            "type": "heading",
            "text": "Review Recipe Import",
            "level": 3
        })
        a2ui.append({
            "type": "ingest_review",
            "job_id": job_id,
            "parsed_recipe": state.get("parsed_recipe")
        })
        
        return {
            "a2ui": a2ui,
            "hitl_status": hitl_status
        }
    
    # If there's a new URL provided but no job_id, we could trigger run_url_ingestion
    # For now, we just pass through
    if not job_id and not source_url:
        a2ui.append({
            "type": "text",
            "text": "Paste a URL or upload a recipe image to import it into your collection."
        })
        
    return {
        "a2ui": a2ui,
        "hitl_status": "idle",
        "error": state.get("error")
    }

workflow = StateGraph(IngestAgentState)
workflow.add_node("ingest", ingest_node)
workflow.set_entry_point("ingest")
workflow.add_edge("ingest", END)

ingest_agent = workflow.compile()

