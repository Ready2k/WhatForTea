from typing import TypedDict, Literal, List, Optional
from langgraph.graph import StateGraph, END
from langchain_core.messages import BaseMessage
from app.agents.teabot import teabot_node

class PendingUpsert(TypedDict):
    """
    State for a pending pantry item add/update—see Section 11.1.
    """
    raw_name: str
    quantity: float
    unit: Optional[str]
    ingredient_id: Optional[str]

class PantryAgentState(TypedDict):
    """
    Strict state mirror for the Pantry CoAgent.
    """
    messages: List[BaseMessage]
    items: List[dict]           # list of PantryItem-shaped dicts
    pending_upsert: Optional[PendingUpsert]
    hitl_status: Literal["idle", "waiting", "applied", "rejected"]
    a2ui: List[dict]
    error: Optional[str]

from app.database import AsyncSessionLocal
from app.services.pantry import get_available, upsert_pantry_item
from app.schemas.pantry import PantryItemCreate
import uuid

# Phase 2 Implementation
async def pantry_node(state: PantryAgentState):
    """
    Reads pantry availability and constructs A2UI.
    Handles HITL intercepts for pending upserts.
    """
    try:
        async with AsyncSessionLocal() as db:
            available_items = await get_available(db)
            
            items_data = []
            for item in available_items:
                items_data.append({
                    "id": str(item.pantry_item_id),
                    "ingredient": item.ingredient.model_dump() if item.ingredient else None,
                    "quantity": item.total_quantity,
                    "unit": item.unit,
                    "confidence": item.confidence
                })
                
            # If there's a pending upsert, we need HITL
            hitl_status = state.get("hitl_status", "idle")
            pending = state.get("pending_upsert")
            
            a2ui = []
            if hitl_status == "waiting" and pending:
                a2ui.append({
                    "type": "pantry_confirm",
                    "raw_name": pending["raw_name"],
                    "quantity": pending["quantity"],
                    "unit": pending["unit"],
                    "ingredient_id": pending["ingredient_id"]
                })
            else:
                a2ui.append({
                    "type": "heading",
                    "text": "Your Pantry",
                    "level": 3
                })
                # Just show top 5 items for demo
                top_items = sorted(items_data, key=lambda x: str((x.get("ingredient") or {}).get("canonical_name", "")))
                for item in top_items[:5]:
                    a2ui.append({
                        "type": "pantry_card",
                        "item": item
                    })

            return {
                "items": items_data,
                "hitl_status": hitl_status,
                "a2ui": a2ui,
                "error": None
            }
            
    except Exception as e:
        return {
            "error": str(e),
            "hitl_status": state.get("hitl_status", "idle")
        }

workflow = StateGraph(PantryAgentState)
workflow.add_node("pantry", pantry_node)
workflow.set_entry_point("pantry")
workflow.add_edge("pantry", END)

pantry_agent = workflow.compile()

from copilotkit import LangGraphAGUIAgent
pantry_coagent = LangGraphAGUIAgent(
    name="pantry",
    description="Manages pantry inventory and availability.",
    graph=pantry_agent,
)


