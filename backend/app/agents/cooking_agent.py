from typing import TypedDict, Literal, List, Optional
from langgraph.graph import StateGraph, END
from langchain_core.messages import BaseMessage
from app.database import AsyncSessionLocal
from app.services.cooking import get_active_session

class CookingAgentState(TypedDict):
    """
    Cooking Session CoAgent.
    Must map perfectly in frontend/src/lib/agents.ts.
    """
    messages: List[BaseMessage]
    session_id: Optional[str]
    recipe_title: Optional[str]
    current_step: int
    total_steps: int
    completed_steps: List[int]
    step_text: Optional[str]
    hitl_status: Literal["idle", "waiting", "applied", "rejected"]
    a2ui: List[dict]
    error: Optional[str]

async def cooking_node(state: CookingAgentState):
    """
    Manages active cooking session and renders the current step A2UI.
    """
    try:
        async with AsyncSessionLocal() as db:
            session = await get_active_session(db)
            
            a2ui = []
            
            if not session:
                a2ui.append({
                    "type": "text",
                    "text": "You aren't currently cooking anything. Tell me a recipe to start!"
                })
                return {
                    "session_id": None,
                    "hitl_status": "idle",
                    "a2ui": a2ui,
                    "error": None
                }
            
            # Since we have an active session, extract step info 
            # (In a full implementation, we'd query the Recipe's Steps here via the ID)
            # For this agent layout, we pass the generic active state.
            
            a2ui.append({
                "type": "heading",
                "text": f"Cooking: {session.recipe_title}",
                "level": 3
            })
            
            a2ui.append({
                "type": "cooking_step",
                "session_id": str(session.id),
                "step_number": session.current_step,
                # Placeholders for actual step details to be pushed or fetched
                "total_steps": 10,
                "text": "Proceed with current cooking step...", 
                "timers": session.timers
            })

            return {
                "session_id": str(session.id),
                "recipe_title": session.recipe_title,
                "current_step": session.current_step,
                "completed_steps": session.completed_steps,
                "hitl_status": "idle",
                "a2ui": a2ui,
                "error": None
            }
            
    except Exception as e:
        return {
            "error": str(e),
            "hitl_status": "idle"
        }

workflow = StateGraph(CookingAgentState)
workflow.add_node("cook", cooking_node)
workflow.set_entry_point("cook")
workflow.add_edge("cook", END)

cooking_agent = workflow.compile()

