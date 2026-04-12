"""
TeaBot LangGraph agent.

The graph is a single node for now; sub-agent routing is Phase 4.
Compiled WITHOUT a checkpointer here — the checkpointer is injected at
runtime from app.state so it can be swapped (Redis vs MemorySaver).
"""
import json
import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, List, Literal, Optional, TypedDict

import boto3
from langchain_aws import ChatBedrock
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from langgraph.types import interrupt

from app.config import settings

logger = logging.getLogger(__name__)

# ── State ─────────────────────────────────────────────────────────────────────

class TeaBotAgentState(TypedDict):
    """
    Canonical state shape — mirror field-for-field in frontend/src/lib/agents.ts.
    `messages` uses the add_messages reducer so each turn appends rather than replaces.
    """
    messages: Annotated[List[BaseMessage], add_messages]
    hitl_status: Literal["idle", "waiting", "applied", "rejected"]
    a2ui: List[dict]
    error: Optional[str]


# ── System prompt ──────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are TeaBot, a friendly and concise kitchen assistant for WhatsForTea — a home recipe manager.
Keep responses short — this is a mobile-first chat panel. Use markdown for formatting (bold, lists).

When the user asks what to cook without being specific (e.g. "what's for tea?"), ask one quick follow-up question to narrow down: how much time do they have, or what mood they're in (e.g. quick, comfort, light, vegetarian). Then use the mood tags and cook times from the recipe library to give a personalised suggestion. Avoid recommending recipes cooked recently (within 5 days).

## Widget protocol
Append ONE widget tag at the very end of your response when appropriate.

### Show a recipe card (recommending a specific recipe from the context):
<widget>{"type":"recipe_card","recipe_id":"RECIPE_ID","title":"Title","match_score":85,"cook_time":30,"missing_ingredients":[]}</widget>

### Start cooking a recipe (user says "let's cook X", "start X", "make X tonight"):
<widget>{"type":"start_cooking","recipe_id":"RECIPE_ID","recipe_title":"Title"}</widget>

### Plan a meal for a day this week (user says "put X on Thursday", "plan X for Monday"):
<widget>{"type":"plan_meal","recipe_id":"RECIPE_ID","recipe_title":"Title","day_of_week":3,"day_name":"Thursday","week_start":"WEEK_START_FROM_CONTEXT"}</widget>
day_of_week: 0=Monday 1=Tuesday 2=Wednesday 3=Thursday 4=Friday 5=Saturday 6=Sunday

### End the active cooking session (user says stop/quit/finish/done cooking):
<widget>{"type":"end_cooking_session","session_id":"SESSION_ID","confirmed":false}</widget>
Set confirmed=true only if user explicitly says they finished and want pantry deducted.

### Add or update a pantry item (user says "I bought X", "I have X", "add X to pantry"):
<widget>{"type":"pantry_confirm","raw_name":"chicken mince","quantity":500,"unit":"g","ingredient_id":"INGREDIENT_ID_IF_KNOWN_FROM_CONTEXT"}</widget>
Include ingredient_id if the item appears in the pantry context. Omit it for new items.
Units: g, kg, ml, l, count, tbsp, tsp, bunch, pack, sachet

### Navigate to a page (user asks to go somewhere):
<widget>{"type":"navigate","path":"/pantry","label":"My Pantry"}</widget>
Valid paths: /pantry  /recipes  /planner  /ingest  /collections

Rules:
- Only emit a widget when it directly answers the user's request.
- Only use IDs present in the context — never fabricate them.
- start_cooking, end_cooking_session, plan_meal, navigate are executed automatically.
- pantry_confirm and recipe_card are shown to the user.
- One widget per response maximum."""


# ── Context builder ────────────────────────────────────────────────────────────

def _week_start() -> str:
    today = date.today()
    return (today - timedelta(days=today.weekday())).isoformat()


async def _build_context(user_id: Optional[str] = None) -> str:
    """
    Build the live kitchen context injected into every chat request.
    Built fresh each turn — not persisted in graph state.
    """
    lines: List[str] = []
    try:
        from sqlalchemy import select as sa_select
        from sqlalchemy.orm import selectinload

        from app.database import AsyncSessionLocal
        from app.models.recipe import Recipe as RecipeModel
        from app.models.session import CookingSession as CookingSessionModel
        from app.services.cooking import get_active_session
        from app.services.matcher import score_all_recipes
        from app.services.pantry import get_available
        from app.services.planner import get_plan

        week_start = _week_start()
        today = date.today()
        day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        lines.append(f"Today: {day_names[today.weekday()]} {today.isoformat()} | Week starts: {week_start}")

        async with AsyncSessionLocal() as db:
            active = await get_active_session(db)
            if active:
                lines.append(
                    f"Active cooking session: \"{active.recipe_title}\" "
                    f"[session_id:{active.id}] step {active.current_step}"
                )

            available = await get_available(db)
            if available:
                items = [
                    f"{a.ingredient.canonical_name} [iid:{a.ingredient.id}] ({a.total_quantity:.0f} {a.unit or ''})"
                    for a in available[:20]
                    if a.ingredient
                ]
                lines.append("Pantry (available): " + ", ".join(items))

            try:
                plan = await get_plan(date.fromisoformat(week_start), db)
                if plan and plan.entries:
                    plan_parts = [
                        f"{day_names[e.day_of_week]}: {e.recipe.title}"
                        for e in sorted(plan.entries, key=lambda e: e.day_of_week)
                    ]
                    lines.append("This week's plan: " + ", ".join(plan_parts))
                else:
                    lines.append("This week's plan: nothing planned yet")
            except Exception:
                pass

            cutoff = datetime.now(timezone.utc) - timedelta(days=14)
            recent_stmt = (
                sa_select(CookingSessionModel)
                .where(CookingSessionModel.ended_at.isnot(None))
                .where(CookingSessionModel.ended_at >= cutoff)
                .order_by(CookingSessionModel.ended_at.desc())
            )
            recent_sessions = (await db.execute(recent_stmt)).scalars().all()
            if recent_sessions:
                recently_cooked: dict[str, int] = {}
                for s in recent_sessions:
                    rid = str(s.recipe_id)
                    if rid not in recently_cooked:
                        recently_cooked[rid] = (date.today() - s.ended_at.date()).days
                cooked_parts = [f"[id:{rid}] {days}d ago" for rid, days in list(recently_cooked.items())[:10]]
                lines.append("Recently cooked (avoid suggesting within 5 days): " + ", ".join(cooked_parts))

            matches = await score_all_recipes(db)
            match_ids: set = set()
            match_map: dict = {}
            ingredient_map: dict = {}
            if matches:
                for m in matches[:8]:
                    rid = str(m.recipe.id)
                    match_ids.add(rid)
                    missing_names = [d.raw_name for d in (m.hard_missing or [])][:3]
                    match_map[rid] = (
                        f"{m.score:.0f}% match"
                        + (f", missing: {', '.join(missing_names)}" if missing_names else "")
                    )

            if match_ids:
                top_stmt = (
                    sa_select(RecipeModel)
                    .where(RecipeModel.id.in_([uuid.UUID(rid) for rid in match_ids]))
                    .options(selectinload(RecipeModel.ingredients))
                )
                top_recipes = (await db.execute(top_stmt)).scalars().all()
                for r in top_recipes:
                    parts = []
                    for ing in r.ingredients:
                        qty = f"{ing.quantity:.0f}" if ing.quantity == int(ing.quantity) else f"{ing.quantity}"
                        unit = f" {ing.unit}" if ing.unit else ""
                        parts.append(f"{qty}{unit} {ing.raw_name}")
                    ingredient_map[str(r.id)] = parts

            all_recipes = (await db.execute(sa_select(RecipeModel).order_by(RecipeModel.title))).scalars().all()
            if all_recipes:
                recipe_lines = []
                for r in all_recipes:
                    tags = ", ".join(r.mood_tags) if r.mood_tags else ""
                    cook_time = f"{r.cooking_time_mins}m" if r.cooking_time_mins else ""
                    meta = " | ".join(filter(None, [cook_time, tags]))
                    line = f"- {r.title} [id:{r.id}]"
                    if meta:
                        line += f" ({meta})"
                    rid = str(r.id)
                    if rid in match_ids:
                        line += f" ← {match_map[rid]}"
                        if rid in ingredient_map:
                            line += f"\n  Ingredients: {', '.join(ingredient_map[rid])}"
                    recipe_lines.append(line)
                lines.append("Your recipe library:\n" + "\n".join(recipe_lines))

    except Exception:
        logger.warning("Could not load chat context", exc_info=True)

    return "\n".join(lines)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_pantry_confirm(text: str) -> Optional[dict]:
    """Extract a pantry_confirm widget descriptor from LLM response text, or None."""
    match = re.search(r'<widget>([\s\S]*?)</widget>', text)
    if not match:
        return None
    try:
        widget = json.loads(match.group(1).strip())
        if isinstance(widget, dict) and widget.get("type") == "pantry_confirm":
            return widget
    except Exception:
        pass
    return None


async def _do_pantry_upsert(widget: dict, quantity: float) -> None:
    """Execute the pantry upsert after HITL confirmation."""
    ingredient_id_str = widget.get("ingredient_id")
    if not ingredient_id_str:
        logger.warning("pantry_confirm upsert skipped — no ingredient_id in widget")
        return

    from app.database import AsyncSessionLocal
    from app.schemas.pantry import PantryItemCreate
    from app.services.pantry import upsert_pantry_item

    async with AsyncSessionLocal() as db:
        await upsert_pantry_item(
            PantryItemCreate(
                ingredient_id=uuid.UUID(ingredient_id_str),
                quantity=quantity,
                unit=widget.get("unit", "count"),
                confidence=1.0,
            ),
            db,
        )
        await db.commit()


# ── LLM factory ───────────────────────────────────────────────────────────────

def _build_llm() -> ChatBedrock:
    from app.services.bedrock import _model_id
    client = boto3.client(
        service_name="bedrock-runtime",
        aws_access_key_id=settings.aws_access_key_id or None,
        aws_secret_access_key=settings.aws_secret_access_key or None,
        region_name=settings.aws_region,
    )
    return ChatBedrock(
        client=client,
        model_id=_model_id(vision=False),
        streaming=True,
    )


# ── Node ──────────────────────────────────────────────────────────────────────

async def teabot_node(state: TeaBotAgentState) -> dict:
    """
    Main TeaBot node.

    Normal turn: builds context, calls LLM, returns AI response.
    Pantry confirm: calls interrupt() to pause; on resume executes the upsert
    and returns a confirmation message — the graph never relies on the frontend
    to mutate data.
    """
    user_id: Optional[str] = state.get("_user_id")

    context = await _build_context(user_id)
    system_content = SYSTEM_PROMPT
    if context:
        system_content += f"\n\n## Current kitchen context\n{context}"

    llm_messages: List[BaseMessage] = [SystemMessage(content=system_content)] + list(state["messages"])
    llm = _build_llm()
    response: AIMessage = await llm.ainvoke(llm_messages)

    # HITL: pause the graph when the LLM wants to add a pantry item
    pantry_widget = _parse_pantry_confirm(response.content)
    if pantry_widget:
        # interrupt() pauses execution; returns the resume payload when /chat/resume is called
        decision: dict = interrupt({"widget": pantry_widget})

        dec = decision.get("decision", "reject")
        qty = float(decision.get("quantity", pantry_widget.get("quantity", 1)))
        raw_name = pantry_widget.get("raw_name", "item")
        unit = pantry_widget.get("unit", "")

        if dec == "confirm":
            await _do_pantry_upsert(pantry_widget, qty)
            qty_str = f"{qty:g}"
            unit_str = f" {unit}" if unit else ""
            confirmation = f"Done! I've added **{qty_str}{unit_str} {raw_name}** to your pantry."
            return {
                "messages": [AIMessage(content=confirmation)],
                "hitl_status": "applied",
                "a2ui": [],
                "error": None,
            }
        else:
            return {
                "messages": [AIMessage(content=f"No problem, I won't add {raw_name} to your pantry.")],
                "hitl_status": "rejected",
                "a2ui": [],
                "error": None,
            }

    return {
        "messages": [response],
        "hitl_status": "idle",
        "a2ui": [],
        "error": None,
    }


# ── Graph (compiled without checkpointer — injected at runtime) ───────────────

_workflow = StateGraph(TeaBotAgentState)
_workflow.add_node("teabot", teabot_node)
_workflow.set_entry_point("teabot")
_workflow.add_edge("teabot", END)

teabot_workflow = _workflow  # compile(checkpointer=...) called in main.py lifespan
