# WhatsForTea v2.0 — Agent-Driven Interface Specification

> **Status**: Draft
> **Author**: Architecture review, April 2026
> **Scope**: Full platform redesign from static React UI to agent-driven, conversational interface using custom SSE + LangGraph + A2UI declarative rendering

---

## 1. Executive Summary

WhatsForTea v1.x is a conventional web app: fixed pages, fixed components, users navigate to features. The AI lives in the backend — it parses cards, scores matches, normalises ingredients — but the UI never *knows* what the agent is thinking or doing.

v2.0 inverts this. The AI agent becomes the primary surface. Users talk to **TeaBot**, a persistent kitchen assistant, and TeaBot drives the interface — streaming in recipe cards, building the week plan inline, walking through cooking steps, prompting for pantry updates — all without page navigation. The fixed pages become fallbacks, not the primary path.

**Core technologies added:**
- **LangGraph** (open-source, Apache 2.0) — agent orchestration: multi-turn logic, sub-agents (Pantry, Planner, etc.), state persistence, and human-in-the-loop interrupts.
- **A2UI v0.8** (open-source, Apache 2.0) — declarative UI protocol: agent returns flat JSON component descriptors (using `<widget>` tags in the SSE stream); frontend renders them as native React widgets.
- **Custom SSE Pipeline** — extending the existing `/api/v1/chat` endpoint to handle state sync and complex tool calls without external frameworks.

**What stays:** PostgreSQL, Redis, AWS Bedrock, FastAPI CRUD endpoints, all existing data models. The agent layer *calls* the existing API rather than replacing it.

---

## 2. The v1 vs v2 Mental Model

### v1 — Navigate then act
```
User → taps "Pantry" → fixed PantryPage → sees items → taps "Add" → form
User → taps "Planner" → fixed PlannerPage → sees week → taps "Auto-fill"
```

### v2 — Talk then act
```
User → "I've got chicken and leeks, what can I make tonight?"
TeaBot → streams recipe cards inline (A2UI), shows match scores, asks "cook this one?"
User → "yes" → TeaBot starts session, renders step-by-step UI inline
User → "add leeks to the pantry while I'm at it"
TeaBot → renders PantryCard inline, pre-fills quantity, waits for confirm (human-in-the-loop)
```

The pages still exist but the TeaBot panel/overlay is the primary entry point.

---

## 3. Technology Deep Dive

### 3.1 LangGraph Orchestration

Instead of a single "one-shot" LLM call, TeaBot uses a LangGraph state machine. This allows:
- **Stateful conversation**: TeaBot remembers what recipe you are looking at or what you just added to the pantry.
- **Sub-agents**: Routing complex requests to specialised nodes (e.g. `PlannerAgent` for week-long logic).
- **Tool calls**: TeaBot can trigger backend functions (e.g. `upsert_pantry_item`) and see the results before replying to the user.
- **Human-in-the-loop**: The agent can pause, render a confirmation widget, and wait for a user response before proceeding with a destructive action (like clearing the fridge).

### 3.2 A2UI (Agent-to-UI) Protocol

TeaBot doesn't just return prose; it returns a flat JSON array of component descriptors wrapped in `<widget>` tags. The Next.js client has an A2UI renderer mapping these types to pre-built React widgets.

**Example A2UI message from TeaBot:**
```json
<widget>
[
  { "type": "heading", "text": "Chicken & Leek Pie", "level": 2 },
  { "type": "recipe_card", "recipe_id": "abc123", "match_score": 87, "cook_time": 35 },
  { "type": "ingredient_list", "items": ["chicken breast", "leeks", "crème fraîche"] },
  { "type": "action_button", "label": "Start Cooking", "action": "start_session", "params": { "recipe_id": "abc123" } }
]
</widget>
```

---

## 4. Architecture: v1 → v2 Delta

### 4.1 Backend changes

#### NEW: LangGraph Agents (`backend/app/agents/`)
```
backend/app/agents/
├── teabot.py              ← Root orchestrator — routes to sub-agents
├── pantry_agent.py        ← Pantry read/write + barcode + expiry
├── planner_agent.py       ← Week planning, shopping list, auto-fill
├── recipe_agent.py        ← Discovery, matching, detail lookup
└── tools.py               ← Shared tool definitions (call existing services)
```

#### UPDATED: `/api/v1/chat`
Extending the existing endpoint to:
1. Initialize/Resume a LangGraph thread.
2. Inject updated context (current page, active session).
3. Handle "Tool Outputs" from the frontend (e.g. user clicked "Confirm").

---

## 5. Implementation Strategy

### Phase 1 — A2UI Foundation
1. Formally define the A2UI widget registry in the frontend.
2. Update the `A2UIRenderer` to handle the JSON structure inside `<widget>` tags.
3. **Deliverable**: Any `/api/v1/chat` response containing a widget tag renders a rich React component.

### Phase 2 — LangGraph Integration
1. Migrate `backend/app/api/v1/chat.py` to use a LangGraph `StateGraph`.
2. Implement thread persistence in Redis so conversations survive page reloads.
3. **Deliverable**: Multi-turn conversations where TeaBot remembers context.

---

## 6. Implementation Rules

### 6.1 AgentState — Strict Typing Contract

Any field present in Python but absent (or differently named/typed) in the TypeScript counterpart will silently produce `undefined` in the widget.

**Rule: define the canonical shape once in Python, mirror it exactly in TypeScript.**

**Python side (`backend/app/agents/teabot.py`):**
```python
class TeaBotAgentState(TypedDict):
    messages: List[BaseMessage]
    hitl_status: Literal["idle", "waiting", "applied", "rejected"]
    a2ui: List[dict]
    error: str | None
```

**TypeScript mirror (`frontend/src/lib/agents.ts`):**
```typescript
export interface TeaBotAgentState {
  hitl_status: 'idle' | 'waiting' | 'applied' | 'rejected';
  a2ui: A2UIDescriptor[];
  error: string | null;
}
```

---

## 7. Human-in-the-Loop — Visual States

LangGraph `interrupt()` pauses the agent graph. The UI must make this waiting state explicit.

**Every HITL widget must implement these states:**

| `hitl_status` | Visual requirement | Action available |
|--------------|-------------------|-----------------|
| `idle` | Normal display | — |
| `waiting` | **Amber pulsing border** + "Waiting for you" label | Confirm / Reject buttons active |
| `applied` | **Green checkmark** overlay + fields locked | None (read-only) |
| `rejected` | **Muted / strikethrough** styling | None |

---

## 8. A2UI Renderer Registry

**`frontend/src/lib/a2ui.ts` is the single source of truth.** Unknown types must render a visible warning in development but fail silently in production to avoid crashing the whole chat panel.
