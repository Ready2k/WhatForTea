# 🍽️ WhatsForTea — Implementation Plan

> Derived from [`spec/original_spec.md`](spec/original_spec.md)  
> Project: Locally-hosted recipe manager & kitchen assistant (Docker / Synology NAS)

---

## Guiding Principles

| Principle | Implication |
|---|---|
| Offline-first cooking | PWA service-worker caching; preload next steps |
| Human-correctable AI | Every LLM output is editable before persistence |
| Canonical ingredient model | Build the normaliser *first* — everything depends on it |
| Low-friction UX | Swipe interface, voice commands, large tap targets |

---

## Phase 0 — Project Scaffolding

**Goal:** Runnable skeleton with all services connected.

### 0.1 Repo & Docker Compose skeleton

```
WhatsForTea/
├── backend/          # FastAPI app
├── frontend/         # Next.js app
├── db/               # Init SQL / migrations
├── data/             # gitignored; bind-mounted volumes
│   ├── db/
│   └── recipes/      # uploaded images
├── docker-compose.yml
├── docker-compose.override.yml   # local dev overrides
└── .env.example
```

- Define four Compose services: `api`, `frontend`, `db`, `redis` (**included from day one**)
- Volume mounts per spec:
  - `./backend` → `/app`
  - `../data/db` → PostgreSQL data dir
  - `../data/recipes` → image storage
- Health checks on `db` before `api` starts

### 0.2 Backend bootstrap

- `poetry` for dependency management
- FastAPI with `uvicorn` (async-first)
- Alembic for database migrations
- `pydantic-settings` for env-based config
- Structured JSON logging from day one (see Phase 9)

### 0.3 Frontend bootstrap

- `create-next-app` (TypeScript, App Router)
- Tailwind CSS
- `next-pwa` for service worker / offline support

### 0.4 CI skeleton (optional but recommended)

- GitHub Actions: lint → test → build Docker images

**Deliverables:** `docker-compose up` brings all services healthy; API returns `{"status":"ok"}` on `GET /health`.

---

## Phase 1 — Data Layer & Migrations

**Goal:** All database models defined, migrated, and testable.

### 1.1 PostgreSQL schema (Alembic migrations)

#### `ingredients` (Canonical Ingredient Model)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `canonical_name` | text UNIQUE | e.g. "Shallot" |
| `aliases` | text[] | e.g. ["Echalion Shallot"] |
| `category` | enum | PRODUCE, DAIRY, MEAT, PANTRY, SPICE, … |
| `dimension` | enum | `mass` \| `volume` \| `count` \| `pack` — the unit class for this ingredient |
| `typical_unit` | text | canonical storage unit (g, ml, unit) |
| `count_to_mass_g` | numeric (nullable) | heuristic: 1 onion ≈ 150 g — enables count ↔ mass conversion |

#### `unit_conversions`

Global conversion graph for the unit normalisation layer. Mass ↔ mass and volume ↔ volume conversions are universal. Count ↔ mass requires an ingredient-specific heuristic (stored on `ingredients.count_to_mass_g`).

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `from_unit` | text | e.g. "tbsp" |
| `to_unit` | text | e.g. "ml" |
| `factor` | numeric | multiply `from_unit` × factor = `to_unit` |

Seeded conversion examples:

| from | to | factor |
|---|---|---|
| tbsp | ml | 15 |
| tsp | ml | 5 |
| kg | g | 1000 |
| l | ml | 1000 |
| oz | g | 28.35 |

**NormalizedAmount** — a value-type used throughout the codebase (not a table; computed in Python):

```python
@dataclass
class NormalizedAmount:
    quantity: Decimal
    unit: str            # always the canonical unit (g, ml, or count)
    dimension: str       # "mass" | "volume" | "count" | "pack"

def normalize(raw_qty, raw_unit, ingredient) -> NormalizedAmount:
    """Convert any quantity/unit pair to the ingredient's canonical dimension."""
    ...
```

All pantry comparisons and match scoring operate on `NormalizedAmount` values, never on raw `quantity + unit` strings directly.

---

#### `recipes`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `title` | text | |
| `hero_image_path` | text | |
| `hello_fresh_style` | smallint | 1–3 |
| `cooking_time_mins` | smallint | |
| `base_servings` | smallint | e.g. 2 — all ingredient quantities are for this serving count |
| `source_type` | enum | `hellofresh` \| `manual` \| `imported` |
| `source_reference` | text (nullable) | original card filename / scan batch ID |
| `mood_tags` | text[] | LLM-generated |
| `created_at` | timestamptz | |

#### `recipe_ingredients`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `recipe_id` | UUID FK → recipes | |
| `ingredient_id` | UUID FK → ingredients | |
| `raw_name` | text | as parsed from card |
| `quantity` | numeric | for `base_servings` |
| `unit` | text | raw unit string from LLM |
| `normalized_quantity` | numeric | stored after normalisation pass |
| `normalized_unit` | text | canonical unit (g, ml, count) |

#### `steps`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `recipe_id` | UUID FK → recipes | |
| `order` | smallint | |
| `text` | text | |
| `timer_seconds` | int (nullable) | |
| `image_crop_path` | text (nullable) | |

> **Step image policy:** `image_crop_path` is nullable and **not populated in v1**. Phase 1 stores text-only steps. Automatic crop extraction from recipe card images is a future enhancement (would require a second CV pass over the uploaded images). Do not implement this field during ingestion — it exists in the schema only to avoid a migration later.

#### `pantry_items`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `ingredient_id` | UUID FK | |
| `quantity` | numeric | total physical quantity in the house |
| `unit` | text | canonical unit |
| `confidence` | float | 0–1 |
| `last_confirmed_at` | timestamptz | |
| `last_used_at` | timestamptz | |
| `decay_rate` | float | per day |

#### `pantry_reservations`

Prevents the same ingredient being double-counted across the matcher, planner, and active cooking sessions.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `pantry_item_id` | UUID FK → pantry_items | |
| `recipe_id` | UUID FK → recipes | |
| `quantity` | numeric | reserved in canonical units |
| `reserved_for` | enum | `plan` \| `active_cook` |
| `created_at` | timestamptz | |

**Availability calculation** (computed, not stored):
```python
available_quantity = pantry_item.quantity * pantry_item.confidence
                   - sum(reservations where reserved_for='plan')
                   - sum(reservations where reserved_for='active_cook')
```

All matching and planning logic must operate on `available_quantity`, not raw `quantity`. Reservations are removed when a cooking session completes or a plan is cleared.

#### `ingest_jobs`

Explicit state model for the async ingestion pipeline. Required for retry, review queue, and debugging.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | returned as `job_id` on upload |
| `status` | enum | `queued` \| `processing` \| `review` \| `complete` \| `failed` |
| `image_dir` | text | path to stored image files |
| `source_type` | enum | `hellofresh` \| `manual` \| `imported` |
| `error_message` | text (nullable) | populated on `failed` status |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

#### `llm_outputs` (Versioning / Audit)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `ingest_job_id` | UUID FK → ingest_jobs | |
| `recipe_id` | UUID FK (nullable) | null until job reaches `complete` |
| `raw_llm_response` | jsonb | full response; **not** written to general logs |
| `parsed_result` | jsonb | |
| `user_corrected` | jsonb (nullable) | |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | retention policy: default 90 days |

#### `ingredient_substitutes`

Data model for known substitutions. Not used in v1 matching logic, but defined now to avoid a schema migration later.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `ingredient_id` | UUID FK → ingredients | the required ingredient |
| `substitute_ingredient_id` | UUID FK → ingredients | the substitute |
| `equivalence_note` | text | e.g. "use same volume" |
| `penalty_score` | float | 0–1; 0 = perfect substitute, 1 = poor substitute |

Used in future iterations to improve hangry matching (allow partial credit for substitutes) and zero-waste suggestions.

#### `meal_plans`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `week_start` | date | ISO Monday of the week |
| `created_at` | timestamptz | |

#### `meal_plan_entries`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `meal_plan_id` | UUID FK → meal_plans | |
| `day_of_week` | smallint | 0 = Monday … 6 = Sunday |
| `recipe_id` | UUID FK → recipes | |

#### `cooking_sessions`

| Column | Type |
|---|---|
| `id` | UUID PK |
| `recipe_id` | UUID FK |
| `current_step` | smallint |
| `completed_steps` | int[] |
| `timers` | jsonb |
| `started_at` | timestamptz |
| `ended_at` | timestamptz (nullable) |

### 1.2 SQLAlchemy ORM models

Map all tables above as SQLAlchemy ORM classes with relationships.

### 1.3 Pydantic schemas

Response/request schemas (separate from ORM models) for every entity.

**Deliverables:** `alembic upgrade head` runs cleanly; all tables exist with correct constraints.

---

## Phase 2 — ⚠️ Critical: Ingredient Normaliser

> This is the foundation of the entire system. Build and test it before any other logic.

**Goal:** Given a raw ingredient string, return the canonical `Ingredient` record (or create one).

### 2.1 Lookup table (primary strategy)

- Seed database with common aliases → canonical mappings
- Exact match on `aliases` array (case-insensitive)

### 2.2 Fuzzy match (fallback)

- Use `rapidfuzz` (Python) for edit-distance matching against `canonical_name` + `aliases`
- Configurable confidence threshold (e.g. ≥ 0.85 → auto-accept)
- Below threshold → surface to user for manual resolution

### 2.3 LLM-assisted normalisation (optional enhancement)

- When fuzzy score is low, call Claude via Bedrock using the prompt in `backend/agent_config/normaliser_prompt.md`
- Prompt template asks: "Is '{raw}' the same ingredient as '{candidate}'? Reply YES or NO with a confidence score."
- All prompt wording is in the `.md` file — tunable without touching Python code
- Cache result in Redis to prevent repeated calls

### 2.4 User override loop

- Frontend presents unresolved ingredients
- User selects or creates canonical
- Override persisted to `aliases` on the `ingredients` table

### 2.5 API surface

```
POST /api/ingredients/resolve
  body: { raw_name: string }
  response: { ingredient: Ingredient, confidence: float, source: "lookup" | "fuzzy" | "llm" | "new" }

POST /api/ingredients/override
  body: { raw_name: string, canonical_id: UUID }
```

### 2.6 Testing (Golden set)

- 50+ raw ingredient names with expected canonical mappings
- Tests must pass before this phase is considered complete

**Deliverables:** `POST /api/ingredients/resolve` correctly maps ≥95% of a golden test set.

---

## Phase 3 — LLM Ingestion Pipeline

**Goal:** Upload a recipe card image → fully structured `Recipe` in the database, with human review step.

### 3.1 Image upload

```
POST /api/recipes/ingest
  multipart: images[] (front + back of card)
  response: { job_id: UUID }
```

- **Mobile browser capture**: use `<input type="file" accept="image/*" capture="environment">` — triggers the native camera on mobile without a native app
- Support both camera capture and gallery/photo-library selection
- Store image files to `../data/recipes/{job_id}/`
- Enqueue processing job to **Redis** (via `rq` or `arq`); frontend polls `GET /api/recipes/ingest/{job_id}/status`

### 3.2 Vision LLM call (AWS Bedrock — Claude)

- **Provider**: AWS Bedrock, model `anthropic.claude-3-5-sonnet-*` (or latest vision-capable Claude)
- **Client**: `boto3` with `bedrock-runtime` — credentials via env vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `BEDROCK_MODEL_ID`)
- **Externalised prompt config** — all prompt text, model parameters, and output schema live in a dedicated file, **not** in application code:

  ```
  backend/
  └── agent_config/
      ├── ingestion_prompt.md      # System + user prompt templates (Jinja2)
      ├── normaliser_prompt.md     # Low-confidence normalisation assist prompt
      └── agent_settings.yaml     # model_id, temperature, max_tokens, retry policy
  ```

  `agent_settings.yaml` example:
  ```yaml
  model_id: anthropic.claude-3-5-sonnet-20241022-v2:0
  temperature: 0.2
  max_tokens: 4096
  llm_rate_limit_per_hour: 20
  retry_attempts: 2
  ```

- `ingestion_prompt.md` contains the full Jinja2 system prompt. The LLM is instructed to return structured JSON:
  ```json
  {
    "title": "...",
    "cooking_time_mins": 30,
    "hello_fresh_style": 2,
    "mood_tags": ["quick", "comfort"],
    "ingredients": [{ "raw_name": "...", "quantity": 1, "unit": "tbsp" }],
    "steps": [{ "order": 1, "text": "...", "timer_seconds": null }]
  }
  ```
- Store raw response in `llm_outputs.raw_llm_response`
- Rate-limit LLM calls via `llm_rate_limit_per_hour` from `agent_settings.yaml`

### 3.3 Validation layer

Reject / flag if:
- Any ingredient has `quantity ≤ 0`
- Ingredients list is empty
- Steps list is empty or contains implausible text (< 5 chars, or > 1000 chars)
- `cooking_time_mins` is 0 or > 300

Errors are returned to the frontend for user correction, not silently dropped.

### 3.4 Normalisation pass

- Run every raw ingredient name through the Phase 2 normaliser
- Unresolved items flagged for user review

### 3.5 Human review UI

- Frontend shows parsed recipe draft
- User can edit any field inline
- Unresolved ingredients highlighted with resolution UI
- On confirm → `parsed_result` and optionally `user_corrected` written to `llm_outputs`

### 3.6 Persistence

- `POST /api/recipes/ingest/confirm/{job_id}` finalises recipe → inserts into `recipes`, `recipe_ingredients`, `steps`

**Deliverables:** Upload a HelloFresh card image → confirm parsed recipe → record in DB.

---

## Phase 4 — Pantry Intelligence

**Goal:** Track ingredient inventory with confidence decay; update on cooking events.

### 4.1 Pantry CRUD API

```
GET    /api/pantry
POST   /api/pantry          # add/update item
PATCH  /api/pantry/{id}     # adjust quantity or confirm
DELETE /api/pantry/{id}
```

### 4.2 Confidence decay

- **Scheduler: APScheduler** (embedded in the FastAPI process — no Celery needed for this app's scale). Runs daily at 03:00 local time.

  ```python
  effective_quantity = quantity * confidence
  confidence -= decay_rate * days_since_last_confirmed
  confidence = max(0.0, confidence)
  ```

- APScheduler also handles: stale inventory prompts, backup trigger hooks
- Fridge items: default `decay_rate = 0.1` / day
- Pantry items: default `decay_rate = 0.02` / day
- `decay_rate` is user-overridable per item

### 4.3 Consumption on cook

- `POST /api/cooking-sessions/{id}/complete` triggers:
  - For each `recipe_ingredient`: subtract `normalized_quantity` from matching `pantry_item` (using `NormalizedAmount` comparison, not raw strings)
  - Remove `pantry_reservations` records for this session
  - If pantry quantity was uncertain (confidence < 0.7): add additional confidence penalty
  - Quantities that go to 0 or below → item removed or set to 0 with confidence 0

### 4.5 Availability API

```
GET /api/pantry/available
  response: [{ ingredient, total_quantity, reserved_quantity, available_quantity, confidence }]
```

All downstream systems (matcher, planner, shopping list) must call this endpoint rather than reading `pantry_items.quantity` directly.

### 4.4 Pantry UI

- List view: ingredient name, quantity, confidence bar, last confirmed date
- "Confirm" button (bumps `confidence` back to 1.0 and updates `last_confirmed_at`)
- Quick-add from shopping list (after buying)

**Deliverables:** Pantry items decay correctly over simulated time; cooking a recipe decrements pantry.

---

## Phase 5 — "Hangry" Matcher

**Goal:** Score every recipe against current pantry; surface ranked results.

### 5.1 Match score calculation

Scoring operates on **normalised, available quantities** (not raw strings). Each ingredient is scored continuously, not binary:

```python
def ingredient_score(pantry_available: NormalizedAmount, required: NormalizedAmount) -> float:
    """Returns 0.0–1.0. Full credit at 1.0, partial below, 0.0 if missing."""
    if pantry_available is None:
        return 0.0
    return min(pantry_available.quantity / required.quantity, 1.0)

def recipe_match_score(recipe, pantry_available) -> MatchResult:
    scores = []
    hard_missing = []
    low_confidence = []
    partial = []

    for ri in recipe.ingredients:
        avail = pantry_available.get(ri.ingredient_id)  # NormalizedAmount
        s = ingredient_score(avail, ri.normalized_amount)
        scores.append(s)
        if s == 0.0:
            hard_missing.append(ri)
        elif avail.confidence < 0.7:
            low_confidence.append(ri)
        elif s < 1.0:
            partial.append(ri)

    return MatchResult(
        score=mean(scores) * 100,
        hard_missing=hard_missing,
        low_confidence=low_confidence,
        partial=partial,
    )
```

This makes recommendations honest: a recipe with 10 ingredients where you have half of each scores ~50%, not 0%.

### 5.2 Categories

| Score | Label | Emoji |
|---|---|---|
| ≥ 90% | Cook Now | 🟢 |
| 50–89% | Almost There | 🟡 |
| < 50% | Planner | 🔴 |

### 5.3 API

```
GET /api/recipes/match
  response: [
    {
      recipe,
      score: float,
      category: "cook_now" | "almost_there" | "planner",
      hard_missing: [{ ingredient, required_qty, required_unit }],
      partial: [{ ingredient, have_qty, required_qty }],
      low_confidence: [{ ingredient, confidence }]
    }
  ]
```

### 5.4 Hangry Mode UI

- Card-based layout, sorted by score descending
- Filter tabs: Cook Now / Almost There / Planner
- Expandable ingredient breakdown: ✅ full / 🟡 partial / ❌ missing / ⚠️ low-confidence

**Deliverables:** `GET /api/recipes/match` returns weighted scores with ingredient-level detail.

---

## Phase 6 — Planner & Zero-Waste Engine

**Goal:** Multi-recipe weekly planning with aggregated shopping list and waste reduction hints.

### 6.1 Weekly planner

- User adds recipes to a plan (Mon–Sun)
- `POST /api/planner/week` body: `{ week_start: date, entries: [{ day_of_week: 0–6, recipe_id: UUID }] }`
- Creates/updates `meal_plans` + `meal_plan_entries` records (see Phase 1 schema)
- Adding a recipe to the plan creates `pantry_reservations` (type `plan`) for each ingredient
- Removing a recipe from the plan deletes its reservations

### 6.2 Shopping list generation

Algorithm:
1. Aggregate all `recipe_ingredient` quantities across planned recipes
2. Subtract `effective_quantity` from pantry (what you already have)
3. Apply **smart rounding** — rules loaded from `backend/config/pack_sizes.yaml`:
   - 0.5 onion → 1 onion
   - 180 g mince → 250 g (nearest standard pack size from config)

  `pack_sizes.yaml` example:
  ```yaml
  # Quantities are in grams (g) or millilitres (ml) unless noted
  # "unit" items use count
  mince:      [250, 500, 750]
  onion:      [1, 2, 4]          # count
  cream:      [150, 300]
  butter:     [125, 250]
  default_g:  [100, 250, 500, 750, 1000]
  default_ml: [100, 200, 500, 1000]
  ```

  The rounding algorithm picks the **smallest pack size ≥ the required quantity**. Adding a new ingredient or changing a pack size requires only editing the YAML, not the code.

4. Group by ingredient category → store zone

```
GET /api/planner/shopping-list
  response: { zones: { [zone]: [{ ingredient, quantity, unit }] } }
```

### 6.3 Zero-waste suggestions

- After shopping list is generated, detect **leftover fractions** (e.g. you buy 500 g mince but only use 350 g)
- Suggest complementary recipes that use the remainder
- `GET /api/planner/zero-waste-suggestions`

### 6.4 Shopping list export

- Formatted plain-text export matching the spec:
  ```
  Whats for Tea? Shopping List:

  FRIDGE:
  * 500g Mince
  * Sour Cream
  ```
- WhatsApp deep-link: `whatsapp://send?text=[URLEncoded]`

### 6.5 Future hooks (scaffold only, not implemented)

- Cost estimation fields on `ingredients` table (`typical_price_per_unit`)
- Store-aware grouping config

**Deliverables:** Planner generates a deduplicated, rounded, zone-grouped shopping list; WhatsApp export works.

---

## Phase 7 — Frontend (Next.js)

**Goal:** Polished, mobile-first UI covering all four major views.

### 7.1 Dashboard

- Context-aware banner (e.g. "You still have 500g mince from Monday — use it tonight?")
  - Driven by pantry items with `last_confirmed_at` > 3 days ago and high quantity
- Mode toggle: **Planning** ↔ **Hangry**
- Quick-access tiles: Scan Card, My Pantry, Shopping List, Cook Now

### 7.2 Cooking Mode (swipe interface)

- Full-screen card per step
- Swipe right → complete step (animate tick)
- Swipe left → go back
- Step timer: auto-triggered if `timer_seconds` is set; counts down with audio alert
- **Always-visible tap buttons** (← Back / Next →) — core navigation must never depend on voice or swipe alone
- **Voice commands (optional enhancement):** "Next step" / "Repeat" via Web Speech API
  - Must not block render or cause an error if API is unavailable
  - Graceful degradation: if `window.SpeechRecognition` is undefined, voice UI is simply hidden
  - No server dependency — all recognition runs client-side
- Offline: steps pre-loaded into service worker cache

### 7.3 Shopping List view

- Grouped by zone (collapsible sections)
- Checkbox UI (local state)
- WhatsApp share button
- "I bought this" → triggers pantry update

### 7.4 Recipe Library

- Grid of recipe cards with hero image, title, match score badge
- Filter/sort: Cook Now first, by cooking time, by mood tag
- Tap → Recipe detail (ingredients + steps preview)

### 7.5 Pantry view

- Sortable list: ingredient, quantity, confidence bar, last confirmed
- Inline confidence confirm button
- Add item manually (triggers normaliser lookup)

### 7.6 Ingestion flow (admin)

- Upload UI with two modes on the same screen:
  - **📷 Take Photo** — `<input capture="environment">` opens rear camera immediately on mobile
  - **📁 Upload from gallery** — standard file picker fallback
- Support uploading front *and* back of the HelloFresh card (max 2 images per ingest job)
- Loading state with progress indicator while Bedrock/Claude processes
- Review form: editable recipe draft, ingredient resolution UI
- Confirm / reject

### 7.7 State management

- React Query for server state (recipes, pantry, matches)
- Local state for cooking session (`CookingSession` shape from spec)
- Events: `step_completed`, `ingredient_used`, `timer_started`

**Deliverables:** All views navigable; cooking mode works offline on mobile.

---

## Phase 8 — Security

**Goal:** Basic but necessary protection for a locally-hosted service.

### 8.1 Local authentication (shared household)

- Single shared household account — one login for everyone in the house
- JWT-based: `POST /api/auth/login` returns a short-lived access token (15 min) + refresh token (7 days)
- Credentials seeded via env vars: `HOUSEHOLD_USERNAME`, `HOUSEHOLD_PASSWORD_HASH` (bcrypt)
- Auth middleware on all API routes except `/health` and `/api/auth/login`
- **Token storage: `httpOnly`, `Secure`, `SameSite=Strict` cookies** (not localStorage)
  - Access token cookie: `whatsfortea_access` — short TTL
  - Refresh token cookie: `whatsfortea_refresh` — longer TTL, only sent to `/api/auth/refresh`
- **CSRF protection**: since cookies are `SameSite=Strict` and the app is same-origin, this is sufficient for a local-only deployment. If ever exposed cross-origin, add a `Double Submit Cookie` CSRF token pattern.
- **Token refresh**: frontend uses React Query's `onError` to detect 401 → calls `/api/auth/refresh` → retries original request transparently
- No per-user accounts, no roles — keep it simple

### 8.2 AWS Bedrock credential protection

- AWS credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) stored in `.env`, never exposed to frontend
- Recommend using an IAM role scoped to `bedrock:InvokeModel` on the specific model ARN only
- Frontend calls `/api/recipes/ingest` → backend calls Bedrock; credentials never leave server

### 8.3 Rate limiting on LLM calls

- Max N LLM calls per hour driven by `llm_rate_limit_per_hour` in `agent_settings.yaml` (not an env var — tunable without restart)
- Returns `429` with retry-after header when exceeded

### 8.4 Backup strategy

A **fully restorable backup** must include all of the following:

| Asset | Location | Included? |
|---|---|---|
| PostgreSQL DB | `pg_dump` output | ✅ |
| Recipe images | `../data/recipes/` | ✅ |
| Pack size config | `backend/config/pack_sizes.yaml` | ✅ |
| Agent prompts & settings | `backend/agent_config/` | ✅ (if user-edited in deployment) |
| `.env` file | project root | ⚠️ back up separately — contains credentials |

- `scripts/backup.sh` archives all of the above into a timestamped tarball in `../data/backups/`
- Retain last 7 daily + 4 weekly backups
- Triggered nightly via APScheduler hook (or Synology scheduled task)

**Deliverables:** Unauthenticated requests return 401; LLM rate limit is enforced; backup script runs.

---

## Phase 9 — Observability

**Goal:** Enough visibility to debug issues without a full APM stack.

### 9.1 Structured logging

- JSON logs from FastAPI via `python-json-logger`
- Fields: `timestamp`, `level`, `service`, `route`, `duration_ms`, `user_id`
- Log level controlled by `LOG_LEVEL` env var

### 9.2 LLM tracing

Two distinct concerns — keep them separate:

**DB audit storage** (`llm_outputs` table):
- Full `raw_llm_response` (jsonb)
- `parsed_result`, `user_corrected`
- Retention policy: `expires_at = created_at + 90 days`; a daily APScheduler job deletes expired rows

**Runtime log entry** (structured JSON, one line per call):
- `prompt_tokens`, `completion_tokens`, `model`, `provider`
- `ingest_job_id`, `status` (`success` | `error`)
- `response_preview`: first 200 chars of the response only
- ❌ Do **not** log the full raw response — it bloats log volumes on the NAS

### 9.3 Metrics (lightweight)

- Prometheus-compatible `/metrics` endpoint (using `prometheus-fastapi-instrumentator`)
- Key metrics:
  - `ingestion_total` (counter, labels: `status=success|error`)
  - `match_score_histogram` (histogram)
  - `pantry_item_count` (gauge)

**Deliverables:** `docker-compose logs api` shows structured JSON; `/metrics` returns Prometheus data.

---

## Phase 10 — Testing

**Goal:** Confidence that the critical path works and regressions are caught.

### 10.1 Unit tests (pytest)

| Area | Coverage target |
|---|---|
| Ingredient Normaliser | ≥ 95% of golden set |
| Match score algorithm | All boundary conditions |
| Pantry decay | Time-simulated scenarios |
| Shopping list rounding | Edge cases (0.5 units, pack sizes) |

### 10.2 Integration tests

- DB-backed tests using a test PostgreSQL database (separate schema)
- Test ingestion pipeline end-to-end with a mocked LLM response
- Pantry consumption after cooking session completion

### 10.3 Frontend tests

- Component tests (React Testing Library) for swipe interaction
- Mock service worker for offline cooking mode

### 10.4 Golden recipe test set

- At least 5 HelloFresh recipe cards
- Pre-computed expected parse output (stored in `tests/fixtures/`)
- Run against real LLM in CI (but skip in unit test runs using mocks)

---

## Delivery Milestones

| Milestone | Phases | Goal |
|---|---|---|
| M0: Skeleton | 0 | `docker-compose up` works |
| M1: Data Layer | 1 | All tables exist |
| M2: Normaliser ✅ | 2 | 95% golden set pass |
| M3: Ingest | 3 | Card → DB confirmed |
| M4: Pantry | 4 | Decay + consumption correct |
| M5: Match | 5 | Hangry mode works |
| M6: Planner | 6 | Shopping list + WhatsApp |
| M7: Frontend | 7 | All views on mobile |
| M8: Hardening | 8, 9, 10 | Auth, logs, tests passing |

---

## 🚫 Non-Goals (v1)

Explicit scope boundary. These features are **not** in v1 and should be rejected if scope creep attempts them:

- No barcode scanning
- No supermarket integrations or price comparison
- No nutrition tracking
- No multi-user household profiles
- No automatic expiry-date recognition
- No automatic step image cropping (text-only steps in v1)
- No native mobile app (browser-only)
- No voice-only cooking mode (buttons always present)

---

## API Conventions

### Error response shape

All API errors return a consistent envelope:

```json
{
  "error": {
    "code": "INGREDIENT_UNRESOLVED",
    "message": "Ingredient could not be resolved with sufficient confidence",
    "details": { "raw_name": "Echalion Shallot", "best_match": "Shallot", "confidence": 0.71 }
  }
}
```

Error codes are `SCREAMING_SNAKE_CASE` strings, defined in `backend/app/errors.py`. HTTP status codes follow standard semantics (400 validation, 401 auth, 404 not found, 422 unprocessable, 429 rate limit, 500 server).

### Success response policy

- **Raw resource objects only** — no envelope wrapper on success responses
- List endpoints return plain JSON arrays
- Single resource endpoints return the object directly
- Pagination is cursor-based where needed: `{ items: [], next_cursor: string | null }`

### Versioning

- All routes are prefixed `/api/v1/` from day one, even for internal use
- This prevents painful rewrites if the app ever gets a second client

---

## Key Risks & Decisions

| Risk | Mitigation |
|---|---|
| LLM output quality varies | Strict validation + human review step; full response in DB for debugging |
| Unit mismatch in matching | NormalizedAmount layer; unit_conversions table seeded before Phase 2 |
| Pantry double-counting | pantry_reservations model; availability API required by all consumers |
| Normaliser mismatches | Golden test set gates Phase 2; user correction loop prevents silent errors |
| Offline cooking breaks | Service worker + step preloading; tap buttons never removed |
| Pantry drift | Frequent confirm prompts; visual confidence decay indicator |
| NAS volume bloat (LLM logs) | Full response in DB only; runtime logs truncated; 90-day retention policy |
| NAS volume performance | Bind mounts preferred over named volumes for image storage on Synology |

---

## ✅ Decisions Log

All open questions resolved — no blockers before starting Phase 0.

| # | Decision | Resolution |
|---|---|---|
| 1 | **LLM Provider** | **AWS Bedrock — Claude** (claude-3-5-sonnet). `boto3` client. All prompts + model params externalised to `backend/agent_config/` (`.md` + `.yaml` files). Tune without touching Python. |
| 2 | **Redis** | **Day 1** — included in Docker Compose from the start. Used for job queue (ingest) and LLM response caching (normaliser). |
| 3 | **Authentication** | **Shared household** — single JWT login, credentials in env vars. No per-user accounts. `httpOnly` cookie storage. |
| 4 | **Image capture** | **Mobile browser** — `<input type="file" capture="environment">`. No native app. Supports camera + gallery. |
| 5 | **Pack size rounding** | **Hardcoded in `backend/config/pack_sizes.yaml`** — edit the YAML to change pack sizes, no code change needed. |
