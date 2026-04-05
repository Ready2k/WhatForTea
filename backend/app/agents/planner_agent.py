from typing import TypedDict, Literal, List, Optional
from datetime import date, datetime, timedelta, timezone
from langgraph.graph import StateGraph, END
from langchain_core.messages import BaseMessage
from app.database import AsyncSessionLocal
from app.services.planner import auto_fill_week, get_or_create_plan, generate_shopping_list

class PlannerAgentState(TypedDict):
    """
    Strict state mirror for the Planner CoAgent.
    Must map perfectly in frontend/src/lib/agents.ts.
    """
    messages: List[BaseMessage]
    week_start: str # YYYY-MM-DD
    plan_entries: List[dict]
    shopping_list: Optional[dict]
    hitl_status: Literal["idle", "waiting", "applied", "rejected"]
    a2ui: List[dict]
    error: Optional[str]

def get_current_week_start() -> str:
    """Helper to get the start of the current week (Monday)."""
    today = datetime.now(timezone.utc).date()
    monday = today - timedelta(days=today.weekday())
    return monday.isoformat()

async def planner_node(state: PlannerAgentState):
    """
    Fetches the week plan and shopping list, and formats A2UI widgets.
    """
    week_start_str = state.get("week_start") or get_current_week_start()
    week_start = date.fromisoformat(week_start_str)
    
    try:
        async with AsyncSessionLocal() as db:
            plan = await get_or_create_plan(week_start, db)
            
            # Format entries for state
            entries = []
            for entry in plan.entries:
                entries.append({
                    "day_of_week": entry.day_of_week,
                    "recipe_id": str(entry.recipe_id),
                    "servings": entry.servings,
                    # Fallback to the parsed relationship if available
                    "title": entry.recipe.title if hasattr(entry, 'recipe') and entry.recipe else "Unknown Recipe"
                })
                
            # Attempt to generate shopping list
            shopping_list_data = None
            try:
                sl = await generate_shopping_list(week_start, db)
                shopping_list_data = sl.model_dump()
            except ValueError:
                pass # Emty plan usually

            # Build A2UI
            a2ui = []
            a2ui.append({
                "type": "heading",
                "text": f"Meal Plan (Week of {week_start_str})",
                "level": 3
            })
            
            a2ui.append({
                "type": "week_plan",
                "week_start": week_start_str,
                "entries": entries
            })
            
            if shopping_list_data:
                a2ui.append({
                    "type": "shopping_list",
                    "zones": shopping_list_data.get("zones", {})
                })

            return {
                "week_start": week_start_str,
                "plan_entries": entries,
                "shopping_list": shopping_list_data,
                "hitl_status": "idle",
                "a2ui": a2ui,
                "error": None
            }
            
    except Exception as e:
        return {
            "error": str(e),
            "hitl_status": "idle"
        }

workflow = StateGraph(PlannerAgentState)
workflow.add_node("plan", planner_node)
workflow.set_entry_point("plan")
workflow.add_edge("plan", END)

planner_agent = workflow.compile()

from copilotkit import LangGraphAGUIAgent
planner_coagent = LangGraphAGUIAgent(
    name="planner",
    description="Manages weekly meal plans and shopping lists.",
    graph=planner_agent,
)

