"""
TeaBot chat endpoint.

POST /api/v1/chat  — SSE stream of LLM response tokens.

Injects live kitchen context. The LLM emits <widget> tags that the frontend
either renders (recipe_card, pantry_confirm) or executes silently
(end_cooking_session, start_cooking, plan_meal, navigate).
"""
import json
import logging
import uuid
from datetime import date, timedelta, timezone
from typing import List, Optional

import boto3
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from langchain_aws import ChatBedrock
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from pydantic import BaseModel

from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["chat"])

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


def _week_start() -> str:
    """ISO date string for this week's Monday."""
    today = date.today()
    return (today - timedelta(days=today.weekday())).isoformat()


async def _build_context(user_id: Optional[str] = None) -> str:
    """
    Build the kitchen context injected into every chat request.

    Token strategy:
    - All recipes: compact one-liner (title + id + tags + last cooked) — ~30 tok each
    - Top 8 by pantry match: detailed row with score + missing ingredients — ~20 tok extra
    - Pantry: up to 20 items with ingredient IDs — ~40 tok each
    - Meal plan, active session, date: minimal overhead
    Total budget for a 50-recipe library: ~2500 tokens — well within Haiku's 200k window.
    """
    lines: List[str] = []
    try:
        from sqlalchemy import select as sa_select
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
            # Active cooking session
            active = await get_active_session(db)
            if active:
                lines.append(
                    f"Active cooking session: \"{active.recipe_title}\" "
                    f"[session_id:{active.id}] step {active.current_step}"
                )

            # Pantry — include ingredient IDs so LLM can reference them in pantry_confirm
            available = await get_available(db)
            if available:
                items = [
                    f"{a.ingredient.canonical_name} [iid:{a.ingredient.id}] ({a.total_quantity:.0f} {a.unit or ''})"
                    for a in available[:20]
                    if a.ingredient
                ]
                lines.append("Pantry (available): " + ", ".join(items))

            # Current week meal plan
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

            # Recently cooked — completed sessions in the last 14 days
            cutoff = date.today() - timedelta(days=14)
            cutoff_dt = cutoff.isoformat()
            recent_stmt = (
                sa_select(CookingSessionModel)
                .where(CookingSessionModel.ended_at.isnot(None))
                .where(CookingSessionModel.ended_at >= cutoff_dt)
                .order_by(CookingSessionModel.ended_at.desc())
            )
            recent_sessions = (await db.execute(recent_stmt)).scalars().all()
            if recent_sessions:
                recently_cooked: dict[str, int] = {}
                for s in recent_sessions:
                    rid = str(s.recipe_id)
                    if rid not in recently_cooked:
                        days_ago = (date.today() - s.ended_at.date()).days
                        recently_cooked[rid] = days_ago
                cooked_parts = []
                for rid, days_ago in list(recently_cooked.items())[:10]:
                    cooked_parts.append(f"[id:{rid}] {days_ago}d ago")
                lines.append("Recently cooked (avoid suggesting within 5 days): " + ", ".join(cooked_parts))

            # Top matches — detailed (score, missing ingredients, ingredient list)
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

            # Load ingredients for top-8 recipes
            if match_ids:
                top_stmt = (
                    sa_select(RecipeModel)
                    .where(RecipeModel.id.in_([uuid.UUID(rid) for rid in match_ids]))
                    .options(__import__("sqlalchemy.orm", fromlist=["selectinload"]).selectinload(RecipeModel.ingredients))
                )
                top_recipes = (await db.execute(top_stmt)).scalars().all()
                for r in top_recipes:
                    parts = []
                    for ing in r.ingredients:
                        qty = f"{ing.quantity:.0f}" if ing.quantity == int(ing.quantity) else f"{ing.quantity}"
                        unit = f" {ing.unit}" if ing.unit else ""
                        parts.append(f"{qty}{unit} {ing.raw_name}")
                    ingredient_map[str(r.id)] = parts

            # Full recipe library — compact index so TeaBot knows ALL recipes
            all_recipes_stmt = sa_select(RecipeModel).order_by(RecipeModel.title)
            all_recipes = (await db.execute(all_recipes_stmt)).scalars().all()

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


_MAX_MESSAGES = 40          # ~20 turns — enough for any real conversation
_MAX_MSG_CHARS = 4_000      # single message cap (~1k tokens)
_ALLOWED_ROLES = {"user", "assistant"}


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    thread_id: Optional[str] = None


@router.post("/chat")
async def chat(body: ChatRequest, request: Request):
    # Input validation — reject obviously abusive payloads before touching Bedrock
    if len(body.messages) > _MAX_MESSAGES:
        raise HTTPException(status_code=400, detail="Too many messages in conversation history.")
    for msg in body.messages:
        if msg.role not in _ALLOWED_ROLES:
            raise HTTPException(status_code=400, detail=f"Invalid message role: {msg.role!r}")
        if len(msg.content) > _MAX_MSG_CHARS:
            raise HTTPException(status_code=400, detail="Message content exceeds maximum length.")

    thread_id = body.thread_id or str(uuid.uuid4())
    user_id = getattr(request.state, "user_id", None)

    async def generate():
        try:
            context = await _build_context(user_id)
            system = SYSTEM_PROMPT
            if context:
                system += f"\n\n## Current kitchen context\n{context}"

            lc_messages = [SystemMessage(content=system)]
            for msg in body.messages:
                if msg.role == "user":
                    lc_messages.append(HumanMessage(content=msg.content))
                elif msg.role == "assistant":
                    lc_messages.append(AIMessage(content=msg.content))

            llm = _build_llm()
            async for chunk in llm.astream(lc_messages):
                if chunk.content:
                    yield f"data: {json.dumps({'type': 'text_delta', 'content': chunk.content})}\n\n"

            yield f"data: {json.dumps({'type': 'done', 'thread_id': thread_id})}\n\n"

        except Exception as exc:
            logger.error("Chat stream error", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
