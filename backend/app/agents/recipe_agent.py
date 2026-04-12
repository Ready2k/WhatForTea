from typing import TypedDict, Literal, List, Optional
from langgraph.graph import StateGraph, END
from langchain_core.messages import BaseMessage
from app.database import AsyncSessionLocal
from app.services.matcher import score_all_recipes

class RecipeAgentState(TypedDict):
    """
    State for the Recipe Discovery CoAgent.
    Must be mirrored in frontend/src/lib/agents.ts.
    """
    messages: List[BaseMessage]
    recipes: List[dict] # Serialized RecipeMatchResult
    hitl_status: Literal["idle", "waiting", "applied", "rejected"]
    a2ui: List[dict]
    error: Optional[str]

async def recipe_discovery_node(state: RecipeAgentState):
    """
    Finds recipes matching the current pantry and generates A2UI.
    """
    try:
        async with AsyncSessionLocal() as db:
            results = await score_all_recipes(db)
            
            # Format top 4 recipes for the grid (like specified in v2 UX section)
            top_matches = results[:4]
            recipes_data = [r.model_dump() for r in top_matches]
            
            # Generate A2UI JSON descriptor
            a2ui = []
            if top_matches:
                a2ui.append({
                    "type": "heading",
                    "text": "Here are some top matches based on your pantry",
                    "level": 3
                })
                
                grid_items = []
                for match in top_matches:
                    missing_names = [m.raw_name for m in match.hard_missing]
                    grid_items.append({
                        "recipe_id": str(match.recipe.id),
                        "title": match.recipe.title,
                        "match_score": match.score,
                        "cook_time": match.recipe.cook_time,
                        "missing_ingredients": missing_names[:3] # Show up to 3 missing
                    })
                    
                a2ui.append({
                    "type": "recipe_grid",
                    "recipes": grid_items
                })

        return {
            "recipes": recipes_data,
            "hitl_status": "idle",
            "a2ui": a2ui,
            "error": None
        }
        
    except Exception as e:
        return {
            "error": str(e),
            "hitl_status": "idle"
        }

workflow = StateGraph(RecipeAgentState)
workflow.add_node("discover", recipe_discovery_node)
workflow.set_entry_point("discover")
workflow.add_edge("discover", END)

recipe_agent = workflow.compile()


