# WhatsForTea v2.0 — Agent-Driven Interface Specification

> **Status**: Draft
> **Author**: Architecture review, April 2026
> **Scope**: Full platform redesign from static React UI to agent-driven, conversational interface using CopilotKit CoAgents + A2UI declarative rendering

---

## 1. Executive Summary

WhatsForTea v1.x is a conventional web app: fixed pages, fixed components, users navigate to features. The AI lives in the backend — it parses cards, scores matches, normalises ingredients — but the UI never *knows* what the agent is thinking or doing.

v2.0 inverts this. The AI agent becomes the primary surface. Users talk to **TeaBot**, a persistent kitchen assistant, and TeaBot drives the interface — streaming in recipe cards, building the week plan inline, walking through cooking steps, prompting for pantry updates — all without page navigation. The fixed pages become fallbacks, not the primary path.

**Core technologies added:**
- **CopilotKit** (open-source, Apache 2.0) — agent-frontend plumbing: CoAgents (LangGraph), shared bidirectional state, human-in-the-loop interrupts, generative UI hooks, AG-UI protocol over SSE
- **A2UI v0.8** (open-source, Apache 2.0) — declarative UI protocol: agent returns flat JSON component descriptions; frontend renders them as native React widgets, safely, without executing agent-generated code

**What stays:** PostgreSQL, Redis, AWS Bedrock, FastAPI CRUD endpoints, all existing data models, Docker Compose deployment. The agent layer *calls* the existing API rather than replacing it.

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

The pages still exist but the copilot sidebar/overlay is the primary entry point.

---

## 3. Technology Deep Dive

### 3.1 CopilotKit

**CopilotRuntime** — backend middleware mounted inside the existing FastAPI app (Python SDK). Acts as the bridge between the frontend CopilotKit hooks and the LangGraph CoAgents. Handles SSE streaming, tool call routing, state sync.

**CoAgents** — LangGraph graphs exposed as named agents. Each agent has typed state. The frontend can read and write agent state directly via `useCoAgent()`. When the agent updates state, the frontend re-renders reactively.

**Key hooks used in v2:**
| Hook | Purpose |
|------|---------|
| `useCopilotChat` | Main chat interface — sends messages, receives streamed responses |
| `useCoAgent(name)` | Binds React component to a named LangGraph agent's state |
| `useCopilotAction` | Registers a frontend action the agent can call (e.g. "navigate to step 3") |
| `useRenderTool` | Maps agent tool calls to specific React components |
| `useCopilotReadable` | Exposes current page context to the agent (what recipe is open, pantry state) |

**Human-in-the-loop** — agent calls `interrupt()` in LangGraph to pause and request user confirmation. CopilotKit surfaces this as a blocked state; the frontend renders an approval UI (A2UI card) and resumes on confirm.

### 3.2 A2UI

Agent returns a flat JSON array of component descriptors instead of Markdown prose. The Next.js client has an A2UI renderer that maps descriptor types to pre-built React components. No arbitrary code executes — only declared, pre-approved widgets render.

**Example A2UI message from TeaBot:**
```json
[
  { "type": "heading", "text": "Chicken & Leek Pie", "level": 2 },
  { "type": "recipe_card", "recipe_id": "abc123", "match_score": 87, "cook_time": 35 },
  { "type": "ingredient_list", "items": ["chicken breast", "leeks", "crème fraîche"] },
  { "type": "action_button", "label": "Start Cooking", "action": "start_session", "params": { "recipe_id": "abc123" } },
  { "type": "action_button", "label": "See other options", "action": "replan", "style": "secondary" }
]
```

**v2 A2UI component registry** (pre-approved widgets):

| A2UI type | Renders as | Interactive? |
|-----------|-----------|-------------|
| `recipe_card` | Recipe summary card with match badge | tap → open detail |
| `recipe_grid` | 2-col grid of recipe_cards | — |
| `ingredient_list` | Styled ingredient list | — |
| `pantry_card` | Single pantry item with quantity input | editable |
| `pantry_confirm` | Pantry upsert form with confirm/cancel | human-in-the-loop |
| `week_plan` | 7-day planner grid | drag/tap to change |
| `shopping_list` | Grouped shopping list with tick boxes | tickable |
| `cooking_step` | Single step card with timer | timer start/stop |
| `nutrition_summary` | Macro table | — |
| `barcode_prompt` | Trigger barcode scanner | launches scanner |
| `ingest_review` | Recipe review form from ingest | editable + confirm |
| `action_button` | CTA button | fires agent action |
| `confirm_dialog` | Yes/No interrupt prompt | human-in-the-loop |
| `text` | Plain prose | — |
| `heading` | Section heading h1–h4 | — |

---

## 4. Architecture: v1 → v2 Delta

### 4.1 Backend changes

#### NEW: CopilotRuntime endpoint
```
POST /api/copilot          ← CopilotRuntime SSE endpoint (CopilotKit Python SDK)
```
Mounted in `backend/app/main.py` alongside existing routes. All existing `/api/v1/*` routes remain untouched — the CoAgents call them internally.

#### NEW: LangGraph CoAgents (`backend/app/agents/`)
```
backend/app/agents/
├── teabot.py              ← Root orchestrator — routes to sub-agents
├── pantry_agent.py        ← Pantry read/write + barcode + expiry
├── planner_agent.py       ← Week planning, shopping list, auto-fill
├── recipe_agent.py        ← Discovery, matching, detail lookup
├── cooking_agent.py       ← Session management, step navigation, voice
└── ingest_agent.py        ← Photo/URL ingest, review, confirm flow
```

Each agent is a LangGraph `StateGraph` with:
- Typed `AgentState` (Pydantic model synced to frontend via CoAgent shared state)
- Tool nodes that call existing FastAPI service functions directly (not HTTP — internal Python calls)
- A2UI generator node that converts agent state → A2UI JSON for the frontend to render
- Interrupt nodes for human-in-the-loop confirmation points

**Example: PantryAgent state**
```python
class PantryAgentState(TypedDict):
    messages: list[AnyMessage]
    items: list[dict]           # current pantry snapshot — synced to frontend
    pending_upsert: dict | None # item awaiting user confirmation
    a2ui: list[dict]            # current UI descriptor — rendered by frontend
    intent: str | None
```

#### CHANGED: `backend/app/services/voice.py`
Voice intent parsing becomes a LangGraph node inside `cooking_agent.py` rather than a standalone HTTP endpoint. The `/api/v1/voice/command` endpoint is kept as a thin wrapper for backwards compatibility but delegates to the agent.

#### UNCHANGED
- All SQLAlchemy models
- All Pydantic schemas
- All existing `/api/v1/*` route handlers (called by agents as internal service calls)
- Alembic migrations
- APScheduler (decay, expiry, LLM cleanup)
- AWS Bedrock client
- Ingredient normaliser pipeline
- Barcode service

### 4.2 Frontend changes

#### NEW: CopilotKit provider + runtime connection
```typescript
// frontend/src/app/layout.tsx  — wrap with CopilotKit
<CopilotKit runtimeUrl="/api/copilot">
  {children}
</CopilotKit>
```

#### NEW: TeaBot sidebar/overlay (`frontend/src/components/TeaBot/`)
```
frontend/src/components/TeaBot/
├── TeaBotPanel.tsx        ← Sliding panel (desktop) / bottom sheet (mobile)
├── TeaBotTrigger.tsx      ← Floating action button in nav
├── A2UIRenderer.tsx       ← Maps A2UI JSON → React components
└── widgets/
    ├── RecipeCard.tsx      ← A2UI recipe_card widget
    ├── PantryConfirm.tsx   ← A2UI pantry_confirm widget (human-in-loop)
    ├── WeekPlan.tsx        ← A2UI week_plan widget
    ├── ShoppingList.tsx    ← A2UI shopping_list widget
    ├── CookingStep.tsx     ← A2UI cooking_step widget
    ├── IngestReview.tsx    ← A2UI ingest_review widget
    └── ...                 ← one file per A2UI type
```

#### NEW: CoAgent state hooks per page
Each page exposes its current context to TeaBot via `useCopilotReadable`:

```typescript
// frontend/src/app/recipes/[id]/page.tsx
useCopilotReadable({ description: "Currently open recipe", value: recipe });

// frontend/src/app/pantry/page.tsx
useCopilotReadable({ description: "Current pantry state", value: pantryItems });
```

And registers frontend actions the agent can trigger:

```typescript
useCopilotAction({
  name: "navigate_to_step",
  description: "Jump to a specific cooking step",
  parameters: [{ name: "step", type: "number" }],
  handler: ({ step }) => setCurrentStep(step),
});
```

#### CHANGED: `frontend/src/components/nav.tsx`
Add TeaBot trigger button alongside existing nav items.

#### UNCHANGED
- All existing pages (recipes, pantry, planner, ingest, collections, profile, cook)
- All existing hooks in `lib/hooks.ts`
- All existing API calls in `lib/api.ts`
- Tailwind config, theme, dark mode

---

## 5. Feature Redesign: v1 vs v2 UX

### 5.1 Recipe Discovery

**v1:** User navigates to `/recipes`, scrolls match list, taps a card.

**v2:**
```
User: "what can I make with what I've got?"
TeaBot: [recipe_grid with top 4 matches, each showing match score + missing ingredients]
User: "what about something quick, under 20 mins?"
TeaBot: [recipe_grid filtered, re-scored] "Here are 3 quick options..."
User: "the pasta one"
TeaBot: [recipe_card expanded with full ingredients] "Want to start cooking or add missing items first?"
```

Agent uses `useCopilotReadable` pantry context — no extra API call needed.

### 5.2 Pantry Management

**v1:** Navigate to `/pantry`, tap `+`, fill form, save.

**v2:**
```
User: "I just bought a block of cheddar and some eggs"
TeaBot: [pantry_confirm card for cheddar — pre-filled name/unit, quantity input]
        [pantry_confirm card for eggs — pre-filled]
        "Confirm both to add them, or adjust quantities first"
→ human-in-the-loop interrupt — agent waits
User: taps confirm on both
TeaBot: "Done — you now have enough for 3 more recipes including the pasta bake"
```

Agent calls `POST /api/v1/pantry` internally after confirmation.

### 5.3 Barcode Scanning

**v1:** Tap barcode icon in pantry page → modal → scan → form.

**v2:**
```
User: "scan this" (or taps barcode widget in chat)
TeaBot: [barcode_prompt widget — launches BarcodeScanner inline in chat]
→ scan resolves to product
TeaBot: [pantry_confirm pre-filled with product name, quantity input]
→ confirm
```

### 5.4 Meal Planning

**v1:** Navigate to `/planner`, click auto-fill, adjust days manually.

**v2:**
```
User: "plan next week, nothing too heavy, we've got 4 people Wednesday"
TeaBot: [week_plan widget with 7 days filled]
        "Here's a plan based on your pantry. Wednesday has a 4-serving recipe.
         Want me to swap anything?"
User: "change Thursday to something veggie"
TeaBot: [week_plan updates Thursday slot in real-time via shared state]
User: "looks good"
TeaBot: [shopping_list widget] "Here's what you'll need to buy..."
→ human-in-the-loop: "Save this plan?" [confirm_dialog]
```

PlannerAgent updates `AgentState.week_plan` which syncs to the A2UI `week_plan` widget via CoAgent shared state — the grid updates in the chat in real time as the agent fills it.

### 5.5 Recipe Ingest (Photo)

**v1:** Navigate to `/ingest`, take 2 photos, wait, review form, confirm.

**v2:**
```
User: "add a new recipe" (or shares photos directly in chat)
TeaBot: "Got it — take a photo of the front of the card, then the back"
        [camera_prompt widget appears]
→ photos captured in chat
TeaBot: [processing indicator — streaming status updates as LLM works]
        [ingest_review widget — full editable form inline in chat]
        "Here's what I read — does this look right?"
→ human-in-the-loop interrupt
User: edits ingredient name inline
User: taps "Looks good"
TeaBot: "Saved! Chicken Pie is now in your library. Match score: 72% with current pantry."
        [recipe_card inline confirmation]
```

IngestAgent wraps the existing ingestion pipeline, streaming status via CoAgent state.

### 5.6 Cooking Session

**v1:** Navigate to `/recipes/[id]/cook`, step through manually, tap timer.

**v2:**
```
User: "let's cook the chicken pie"
TeaBot: [cooking_step widget — step 1 with timer]
        "Step 1: Preheat oven to 220°C..."
User: (voice or text) "done"  /  "next"  /  "how long does it simmer?"
TeaBot: [cooking_step advances to step 2] or [answers inline then returns to step]
User: "actually what temperature was that again?"
TeaBot: "220°C fan. Still on step 1 — ready to move on?"
```

CookingAgent uses the existing session CRUD internally, exposes `current_step` as shared state so the `cooking_step` widget always reflects the true session state.

---

## 6. New Dependencies

### Backend
```toml
# pyproject.toml additions
copilotkit = ">=0.5"          # CopilotRuntime Python SDK
langgraph = ">=0.2"           # CoAgent graph runtime
langchain-core = ">=0.3"      # LangChain base (LangGraph dep)
a2ui = ">=0.8"                # A2UI Python builder/validator (if package exists, else inline schema)
```

### Frontend
```json
// package.json additions
"@copilotkit/react-core": "^1.x",
"@copilotkit/react-ui": "^1.x",
"@copilotkit/runtime-client-gql": "^1.x"
```

---

## 7. New File Inventory

### Backend — new files
| File | Description |
|------|-------------|
| `backend/app/agents/__init__.py` | Package init |
| `backend/app/agents/teabot.py` | Root orchestrator graph |
| `backend/app/agents/pantry_agent.py` | Pantry CoAgent |
| `backend/app/agents/planner_agent.py` | Planner CoAgent |
| `backend/app/agents/recipe_agent.py` | Recipe discovery CoAgent |
| `backend/app/agents/cooking_agent.py` | Cooking session CoAgent |
| `backend/app/agents/ingest_agent.py` | Ingest flow CoAgent |
| `backend/app/agents/a2ui_builder.py` | Helper: converts agent state → A2UI JSON |
| `backend/app/agents/tools.py` | Shared tool definitions (call existing services) |
| `backend/agent_config/teabot_system.md` | TeaBot system prompt (Jinja2) |

### Backend — modified files
| File | Change |
|------|--------|
| `backend/app/main.py` | Mount CopilotRuntime at `/api/copilot` |
| `backend/pyproject.toml` | Add copilotkit, langgraph deps |

### Frontend — new files
| File | Description |
|------|-------------|
| `frontend/src/components/TeaBot/TeaBotPanel.tsx` | Main chat panel |
| `frontend/src/components/TeaBot/TeaBotTrigger.tsx` | FAB in nav |
| `frontend/src/components/TeaBot/A2UIRenderer.tsx` | A2UI → React renderer |
| `frontend/src/components/TeaBot/widgets/RecipeCard.tsx` | |
| `frontend/src/components/TeaBot/widgets/PantryConfirm.tsx` | |
| `frontend/src/components/TeaBot/widgets/WeekPlan.tsx` | |
| `frontend/src/components/TeaBot/widgets/ShoppingList.tsx` | |
| `frontend/src/components/TeaBot/widgets/CookingStep.tsx` | |
| `frontend/src/components/TeaBot/widgets/IngestReview.tsx` | |
| `frontend/src/components/TeaBot/widgets/ActionButton.tsx` | |
| `frontend/src/components/TeaBot/widgets/ConfirmDialog.tsx` | |
| `frontend/src/components/TeaBot/widgets/BarcodePrompt.tsx` | |
| `frontend/src/lib/a2ui.ts` | A2UI type definitions + renderer map |

### Frontend — modified files
| File | Change |
|------|--------|
| `frontend/src/app/layout.tsx` | Wrap with `<CopilotKit>`, add `<TeaBotPanel>` |
| `frontend/src/components/nav.tsx` | Add `<TeaBotTrigger>` |
| `frontend/src/app/recipes/[id]/page.tsx` | Add `useCopilotReadable`, `useCopilotAction` |
| `frontend/src/app/pantry/page.tsx` | Add `useCopilotReadable` |
| `frontend/src/app/planner/page.tsx` | Add `useCopilotReadable`, `useCoAgent` for plan state |
| `frontend/src/app/recipes/[id]/cook/page.tsx` | Add `useCoAgent` for session state |
| `frontend/package.json` | Add CopilotKit deps |

### Unchanged
- All SQLAlchemy models, Pydantic schemas, Alembic migrations
- All `/api/v1/*` route handlers
- All existing lib/hooks.ts, lib/api.ts, lib/types.ts
- All existing page components (pages become agent-readable but otherwise unchanged)
- Docker Compose, Makefile, deployment scripts

---

## 8. Data Flow Diagram

```
User message
     │
     ▼
CopilotKit frontend (SSE)
     │
     ▼
CopilotRuntime (/api/copilot)  ← mounted in FastAPI
     │
     ▼
TeaBotAgent (LangGraph)
     │  routes to sub-agent
     ▼
PantryAgent / PlannerAgent / RecipeAgent / CookingAgent / IngestAgent
     │  calls internal service functions
     ▼
Existing service layer (pantry.py, planner.py, matcher.py, etc.)
     │
     ▼
PostgreSQL / Redis / AWS Bedrock
     │
     ▼
Agent state updated → A2UI JSON generated
     │  streamed via SSE
     ▼
CopilotKit frontend receives state update
     │
     ▼
A2UIRenderer maps JSON → React widgets
     │
     ▼
User sees live UI update in TeaBot panel
```

---

## 9. Migration Strategy

### Phase 1 — Foundation (no UX change)
1. Add LangGraph + CopilotKit deps to backend
2. Mount CopilotRuntime endpoint (no agents wired yet)
3. Add CopilotKit provider to Next.js layout (invisible to user)
4. Add `useCopilotReadable` to all pages (context only, no actions)
5. Build A2UIRenderer + full widget library — **see Section 12 for strict widget contract rules**
6. Define and lock all `AgentState` Pydantic models before writing any agent logic — **see Section 12 for typing rules**
7. **Deliverable**: TeaBot panel opens, user can chat, agent reads page context but only replies in prose

### Phase 2 — Agent layer
1. Build TeaBotAgent + RecipeAgent (read-only: discovery, matching)
2. Build PantryAgent with human-in-the-loop confirm
3. Build PlannerAgent with week_plan shared state
4. A2UI widgets connected to agent actions
5. **Deliverable**: Full conversational pantry + planning flows working alongside existing pages

### Phase 3 — Cooking + Ingest
1. Build CookingAgent — session state synced to chat
2. Build IngestAgent — photo/URL ingest as conversational flow
3. Voice input in TeaBot panel (CopilotKit voice support)
4. **Deliverable**: Full v2.0 feature parity via TeaBot

### Phase 4 — Polish + deprecation
1. Make TeaBot the default entry point (open on first visit)
2. Optionally hide fixed pages behind "Advanced" nav
3. A2UI widget visual consistency pass
4. Mobile bottom sheet UX tuning

---

## 10. Risks & Considerations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| AgentState type mismatch between Python and React | **High** | Strict typing rules — see Section 12.1 |
| HITL UX confusion — user doesn't know agent is waiting | **High** | Explicit visual states on every blocking widget — see Section 12.2 |
| A2UI v0.8 is pre-1.0 — spec may shift | Medium | Own the renderer — see Section 12.3 |
| CopilotKit adds latency to every interaction (SSE overhead) | Low | Existing pages unchanged; copilot is additive, not a replacement for direct navigation |
| LangGraph agent complexity vs current simple service functions | Medium | Build agents as thin orchestrators calling existing services — don't rewrite business logic |
| Bedrock costs increase (more LLM calls for conversational turns) | Medium | TeaBot uses a cheaper/faster model (Haiku) for routing/prose; Sonnet only for ingest/normalisation |
| AG-UI protocol compatibility between CopilotKit and A2UI | Low | A2UI is framework-agnostic JSON; CopilotKit renders it via `useRenderTool` — no deep coupling |
| Mobile UX of bottom-sheet chat + A2UI widgets | Medium | Phase 3 includes dedicated mobile UX pass; existing pages remain as fallback |

---

## 11. Implementation Rules (Phase 1 must-haves)

### 11.1 AgentState — Strict Typing Contract

`useCoAgent` syncs state between Python and React over SSE. Any field present in Python but absent (or differently named/typed) in the TypeScript counterpart will silently produce `undefined` in the widget — causing blank UI, broken conditionals, or incorrect renders that are hard to trace.

**Rule: define the canonical shape once in Python, generate or mirror it exactly in TypeScript. Never let them drift.**

**Python side — no `Any`, no bare `dict`:**
```python
# backend/app/agents/pantry_agent.py
from typing import TypedDict, Literal

class PendingUpsert(TypedDict):
    raw_name: str
    quantity: float
    unit: str | None
    ingredient_id: str | None

class PantryAgentState(TypedDict):
    messages: list           # LangGraph messages — opaque to frontend
    items: list[dict]        # list of PantryItem-shaped dicts
    pending_upsert: PendingUpsert | None   # None = no pending action
    hitl_status: Literal["idle", "waiting", "applied", "rejected"]
    a2ui: list[dict]
    error: str | None
```

**TypeScript mirror — must match field-for-field:**
```typescript
// frontend/src/lib/agents.ts  — single source of truth for all agent state types
export interface PendingUpsert {
  raw_name: string;
  quantity: number;
  unit: string | null;
  ingredient_id: string | null;
}

export interface PantryAgentState {
  items: PantryItem[];
  pending_upsert: PendingUpsert | null;  // null not undefined — match Python None
  hitl_status: 'idle' | 'waiting' | 'applied' | 'rejected';
  a2ui: A2UIDescriptor[];
  error: string | null;
}
```

**Rules:**
- All optional fields use `| null` (not `?:` optional) — Python `None` serialises to JSON `null`, not omitted
- Enums/literals match exactly — a Python `Literal["waiting"]` that becomes `"Waiting"` in TS will never match
- `a2ui` is always `list[dict]` / `A2UIDescriptor[]` — never omit it, default to `[]`
- `hitl_status` is on **every** agent state — widgets read this field to know their visual state
- Add a CI check or Zod schema validation that catches drift at startup, not at runtime

---

### 11.2 Human-in-the-Loop — Visual State Requirements

LangGraph `interrupt()` pauses the agent graph. From the user's perspective the agent has gone silent — indistinguishable from a crash unless the UI makes the waiting state explicit.

**Every HITL widget must implement all four states:**

| `hitl_status` | Visual requirement | Action available |
|--------------|-------------------|-----------------|
| `idle` | Normal display | — |
| `waiting` | **Amber pulsing border** + "Waiting for you" label + agent avatar indicator in panel header | Confirm / Reject buttons active |
| `applied` | **Green checkmark** overlay + fields locked | None (read-only) |
| `rejected` | **Muted / strikethrough** styling | None |

**The TeaBot panel header must always show agent status:**
```
┌─────────────────────────────────────┐
│ 🤖 TeaBot  ● Waiting for you...     │  ← amber dot + text when any HITL active
│                                     │
│ [pantry_confirm widget — amber]     │
│  Cheddar  200g  ✓ Confirm  ✗ Cancel │
└─────────────────────────────────────┘
```

vs no HITL active:
```
┌─────────────────────────────────────┐
│ 🤖 TeaBot  ● Ready                  │  ← green dot
└─────────────────────────────────────┘
```

**Implementation requirement:** `TeaBotPanel.tsx` reads `hitl_status` from all active CoAgent states and sets a panel-level `isWaiting` flag. This controls the header indicator independently of which widget is rendering. Users must never be left wondering why the agent has stopped responding.

**Never use `confirm_dialog` or `pantry_confirm` without:**
1. The amber border on the widget
2. The panel header status changing to "Waiting for you"
3. A timeout fallback — if the user ignores the interrupt for >5 minutes, auto-reject and send a message explaining why

---

### 11.3 A2UI Renderer — Own the Registry, Never Auto-Generate

A2UI v0.8 is Apache 2.0 and production-stable, but pre-1.0 means field names, component types, and the JSON envelope may change in v0.9+. The mitigation is to treat the A2UI spec as an *input format we parse*, not a library we depend on.

**`frontend/src/lib/a2ui.ts` is the single source of truth. Rules:**

```typescript
// frontend/src/lib/a2ui.ts

// 1. All known component types are explicitly enumerated — no string passthrough
export type A2UIType =
  | 'recipe_card' | 'recipe_grid' | 'ingredient_list'
  | 'pantry_card' | 'pantry_confirm'
  | 'week_plan' | 'shopping_list'
  | 'cooking_step' | 'nutrition_summary'
  | 'barcode_prompt' | 'ingest_review'
  | 'action_button' | 'confirm_dialog'
  | 'text' | 'heading';

export interface A2UIDescriptor {
  type: A2UIType;
  [key: string]: unknown;   // widget-specific props — validated per-widget
}

// 2. Unknown types render a visible warning in dev, nothing in prod
export function renderA2UI(descriptor: A2UIDescriptor): React.ReactNode {
  const Widget = REGISTRY[descriptor.type];
  if (!Widget) {
    if (process.env.NODE_ENV === 'development') {
      return <UnknownWidgetWarning type={descriptor.type} />;
    }
    return null;  // silently skip unknown types in prod — don't crash
  }
  return <Widget {...descriptor} />;
}

// 3. Registry is a plain object — easy to audit, easy to extend
const REGISTRY: Record<A2UIType, React.ComponentType<any>> = {
  recipe_card:       RecipeCardWidget,
  recipe_grid:       RecipeGridWidget,
  pantry_confirm:    PantryConfirmWidget,
  // ...
};
```

**What this buys:** if A2UI v0.9 renames `action_button` to `cta_button`, the app doesn't crash — `renderA2UI` returns `null` for the unknown type, logs a warning in dev, and the rest of the message still renders. The fix is a one-line registry update.

**Never:**
- Import A2UI's own renderer package (if one exists) — we own rendering
- Allow the agent to pass arbitrary React component names as strings
- Auto-map A2UI type strings directly to dynamic imports

---

## 12. What v2.0 Is NOT

- Not a rewrite. Every existing page, API, model, and migration survives unchanged.
- Not replacing navigation. Users who prefer tapping fixed pages still can.
- Not adding a new database. No new persistence layer — agents read/write through existing services.
- Not a mobile app. Still a PWA. Flutter/GenUI from Google's A2UI blog is interesting but out of scope for v2.0; the A2UI *protocol* is used, not Flutter rendering.
- Not removing AWS Bedrock. CopilotKit is LLM-agnostic — TeaBot still calls Bedrock.
