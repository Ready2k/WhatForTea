# WhatsForTea — Build Checkpoint

Use this document to resume work across sessions. Update it as each phase completes.

---

## Current Status

| Phase | Status | Notes |
|-------|--------|-------|
| 0 — Scaffolding | ✅ Complete | All services start; health endpoint returns `{"status":"ok"}` |
| 1 — Data Layer | ✅ Complete | 13 tables + alembic_version; 16 unit_conversions seeded |
| 2 — Ingredient Normaliser | ✅ Complete | 55/55 golden set (100%); 5/5 tests pass |
| 3 — LLM Ingestion Pipeline | ✅ Complete | Upload → LLM → normalise → review → confirm flow |
| 4 — Pantry Intelligence | ✅ Complete | CRUD + decay scheduler + availability + consume |
| 5 — Hangry Matcher | ✅ Complete | Continuous scoring, 3 buckets, category filter |
| 6 — Planner & Shopping List | ✅ Complete | Week plan, pack-size rounding, WhatsApp export |
| 7 — Frontend UI | ✅ Complete | All 6 views; cooking mode with swipe/timer/voice |
| 8 — Security | ⏳ Pending | |
| 9 — Observability | ✅ Complete | JSON logs with timestamp/level/route/duration_ms; /metrics with 3 custom metrics |
| 10 — Testing | ⏳ Pending | |

---

## Confirmed Decisions

| # | Decision | Value |
|---|----------|-------|
| Docker Hub user | Registry for pushed images | `ready2k` |
| NAS IP | Synology hostname | `192.168.4.2` |
| NAS data path | Bind mount root on NAS | `/volume1/docker/whatsfortea/` |
| AWS Bedrock | Provider for vision LLM | Configured — user to populate `.env` |
| API port | Default | `8000` |
| Frontend port | Default | `3000` |

---

## What Has Been Built (Phase 0)

### Directory structure
```
WhatsForTea/
├── backend/
│   ├── Dockerfile              # multi-stage: development + production targets
│   ├── pyproject.toml          # Poetry deps
│   ├── alembic.ini
│   ├── alembic/env.py          # async-compatible migration runner
│   ├── alembic/versions/       # migrations live here
│   ├── app/
│   │   ├── main.py             # FastAPI app, lifespan, JSON logging, /health
│   │   ├── config.py           # pydantic-settings (reads .env)
│   │   ├── database.py         # async SQLAlchemy engine + session factory
│   │   ├── errors.py           # error codes + exception handlers
│   │   ├── logging_config.py   # structured JSON logging setup
│   │   └── api/v1/health.py    # GET /health
│   ├── agent_config/
│   │   ├── agent_settings.yaml # model, temperature, rate limits
│   │   ├── ingestion_prompt.md # Jinja2 prompt for card ingestion
│   │   └── normaliser_prompt.md# Jinja2 prompt for ingredient resolution
│   └── config/
│       └── pack_sizes.yaml     # shopping list rounding rules
├── frontend/
│   ├── Dockerfile              # multi-stage: development + production targets
│   ├── package.json
│   ├── next.config.ts          # output: standalone, API proxy rewrites
│   ├── tailwind.config.ts
│   └── src/app/                # Next.js App Router skeleton
├── scripts/
│   ├── push-images.sh          # buildx cross-compile → Docker Hub (linux/amd64)
│   └── backup.sh               # pg_dump + images → timestamped tarball
├── docker-compose.yml          # local dev (builds from source, hot reload)
├── docker-compose.synology.yml # NAS production (pulls from Docker Hub)
├── .env.example
├── Makefile
└── data/                       # gitignored — created by `make init-dirs`
    ├── db/
    ├── recipes/
    └── backups/
```

### Verified behaviours (Phase 0 gate)
- [ ] `make init-dirs && docker-compose up` — all 4 services reach healthy state
- [ ] `curl http://localhost:8000/health` → `{"status":"ok"}`
- [ ] `curl http://localhost:3000` → Next.js placeholder page

---

## How to Resume

1. Read this file and `CLAUDE.md` for context.
2. Read `plan.md` for the full specification of the next phase.
3. Check git log for any changes since this checkpoint was written.
4. Start the next pending phase.

---

## What Has Been Built (Phase 1)

### ORM Models (`backend/app/models/`)
| File | Models |
|------|--------|
| `ingredient.py` | `Ingredient`, `UnitConversion`, `IngredientSubstitute` + enums |
| `recipe.py` | `Recipe`, `RecipeIngredient`, `Step` + `SourceType` enum |
| `pantry.py` | `PantryItem`, `PantryReservation` + `ReservationType` enum |
| `plan.py` | `MealPlan`, `MealPlanEntry` |
| `session.py` | `CookingSession` |
| `ingest.py` | `IngestJob`, `LlmOutput` + `IngestStatus`, `IngestSourceType` enums |
| `normalised_amount.py` | `NormalizedAmount` dataclass (value object, not a table) |
| `__init__.py` | Re-exports all above for Alembic autogenerate detection |

### Pydantic Schemas (`backend/app/schemas/`)
One schema file per model group; request/response/summary variants where needed.

### Migrations
| Revision | Description |
|----------|-------------|
| `b65776dded38` | `initial_schema` — all 13 tables + PostgreSQL enum types |
| `5067703d24c7` | `seed_unit_conversions` — 16 bidirectional unit conversion rows |

### Key design notes
- All UUID PKs use Python-side `uuid.uuid4` default
- `steps.image_crop_path` is nullable — not populated in v1 ingestion
- `llm_outputs.expires_at` defaults to `now() + interval '90 days'` (server_default)
- `PYTHONPATH=/app` set in Dockerfile so `alembic` and `pytest` can import `app`

---

## What Has Been Built (Phase 2)

### Services
- `backend/app/services/normaliser.py` — 4-layer pipeline (lookup → fuzzy → LLM → unresolved)
- `backend/app/services/bedrock.py` — AWS Bedrock client; reads prompts from `agent_config/*.md`

### API endpoints (`/api/v1/ingredients/`)
- `POST /resolve` — runs full pipeline, returns ingredient + confidence + source
- `POST /override` — appends alias to ingredients.aliases, persists mapping
- `GET /` — list all canonical ingredients
- `GET /{id}` — get single ingredient

### Migrations
- `e38f3283b1e4` — GIN index on `ingredients.aliases`, lower() index on `canonical_name`
- `2bd943073a70` — 35 seeded canonical ingredients with aliases (common HelloFresh items)

### Tests
- `tests/unit/test_normaliser.py` — 5 tests including golden set gate
- `tests/fixtures/golden_ingredients.json` — 55 raw→canonical mappings
- **Result: 55/55 (100%) — exceeds 95% threshold**

---

## What Has Been Built (Phase 3)

### Services
- `backend/app/services/rate_limiter.py` — hourly-bucket Redis rate limiter; raises `RateLimitExceeded` with `retry_after`
- `backend/app/services/ingestion.py` — full pipeline: `save_images`, `run_ingestion` (arq task body), `confirm_recipe`
- `backend/app/services/bedrock.py` — added `call_ingestion_llm(image_paths)` → `(raw_response, parsed_dict)`

### Worker
- `backend/app/worker.py` — arq `WorkerSettings`; `task_process_ingest_job` task; startup/shutdown DB + Redis lifecycle
  - Run: `poetry run arq app.worker.WorkerSettings` inside the api container

### API (`/api/v1/recipes/`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/ingest` | Multipart upload; saves images; enqueues arq job; returns `{job_id}` |
| GET | `/ingest/{id}/status` | Poll: `queued / processing / review / complete / failed` |
| GET | `/ingest/{id}/review` | Parsed recipe draft + unresolved ingredient list |
| POST | `/ingest/confirm/{id}` | User-confirmed recipe → inserts to DB; returns full Recipe |
| GET | `/` | List all recipes (summary cards) |
| GET | `/{id}` | Full recipe with ingredients + steps |

### Key design notes
- Images stored to `/data/recipes/{job_id}/image_NN.{ext}` (bind-mounted from `./data/recipes`)
- Raw LLM response stored in `llm_outputs.raw_llm_response` — intentionally NOT logged
- Validation: rejects qty ≤ 0, empty ingredients/steps, `cooking_time_mins` = 0 or > 300
- Normaliser runs on every ingredient (lookup+fuzzy only; no nested LLM); unresolved flagged for UI
- `confirm_recipe` requires all `ingredient_id` fields set; 422 returned otherwise
- `docker-compose.yml` updated: `./data/recipes:/data/recipes` volume added to api service

### Tests
- `tests/unit/test_ingestion.py` — 8 tests: 7 pure-function validation tests + 3 integration tests (mocked Bedrock + rate limiter, real DB)

---

## What Has Been Built (Phase 4)

### Services
- `backend/app/services/pantry.py`
  - `calculate_confidence(decay_rate, last_confirmed_at, now)` — pure function; idempotent from confirmation point
  - `upsert_pantry_item` — insert or update by ingredient_id; resets confidence to 1.0 on update
  - `update_pantry_item` — partial PATCH
  - `confirm_pantry_item` — sets confidence=1.0, last_confirmed_at=now
  - `delete_pantry_item`
  - `get_available` — `(quantity × live_confidence) − sum(reservations)`, floored at 0
  - `apply_decay_all` — recalculates all items from last_confirmed_at (idempotent, called by scheduler)
  - `consume_from_pantry(recipe_id, db)` — deducts recipe quantities; extra penalty if confidence < 0.7

- `backend/app/services/scheduler.py`
  - `create_scheduler()` → `AsyncIOScheduler` with two cron jobs:
    - `daily_decay` at 03:00 — runs `apply_decay_all`
    - `llm_output_cleanup` at 04:00 — deletes expired `llm_outputs` rows

### API (`/api/v1/pantry/`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/available` | Availability view (confidence-weighted, minus reservations) |
| GET | `/` | Raw pantry items list |
| POST | `/` | Add / upsert pantry item |
| PATCH | `/{id}` | Partial update |
| POST | `/{id}/confirm` | Reset confidence to 1.0 |
| DELETE | `/{id}` | Remove item |

### Key design notes
- Decay is recalculated from `last_confirmed_at` — idempotent, safe to replay
- Fridge default `decay_rate=0.1/day`, pantry `decay_rate=0.02/day` (per-item, user-overridable)
- `GET /available` is the only correct read path for downstream systems
- `consume_from_pantry` does unit conversion via `unit_conversions` table; logs warnings for unknown pairs
- APScheduler starts/stops in `main.py` lifespan; misfire grace = 1 hour (survives brief restarts)

### Tests
- `tests/unit/test_pantry.py` — 6 pure decay function tests + 5 integration tests (real DB)

---

## What Has Been Built (Phase 5)

### Services
- `backend/app/services/matcher.py`
  - `ingredient_score(available_qty, required_qty)` — pure; `min(avail/req, 1.0)`, 0.0 if missing/zero
  - `get_category(score)` — pure; thresholds 90/50
  - `score_recipe(recipe, avail_map, db)` — async; converts units, categorises each ingredient
  - `score_all_recipes(db)` — loads all recipes + availability, returns sorted results

### Schemas
- `backend/app/schemas/matcher.py`
  - `IngredientMatchDetail` — per-ingredient score, required/available qty, confidence
  - `RecipeMatchResult` — recipe summary + score + category + four ingredient lists

### API
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/recipes/match` | All recipes scored, sorted by score desc; `?category=` filter |

### Key design notes
- Matcher router registered in `main.py` **before** recipes router — prevents "match" being parsed as a UUID
- Scoring uses live confidence-decayed availability (`get_available()`) — never stale
- Unknown unit conversions → ingredient treated as `hard_missing` (conservative)
- `?category=cook_now|almost_there|planner` filter available on the match endpoint

### Tests
- `tests/unit/test_matcher.py` — 9 pure function tests + 4 integration tests

---

## What Has Been Built (Phase 6)

### Migration
- `a9d2e4f6c801` — adds nullable `servings` column to `meal_plan_entries` (NULL = use recipe.base_servings)

### Services
- `backend/app/services/planner.py`
  - `round_to_pack_size(required, name, unit)` — pure; YAML-driven pack-size lookup (exact → word → unit default)
  - `set_week_plan(data, db)` — replace week plan; deletes old entries+reservations, creates new ones
  - `get_plan(week_start, db)` — load with entries+recipes
  - `delete_plan_entry(entry_id, db)` — remove entry + its pantry reservations
  - `generate_shopping_list(week_start, db)` — aggregate → subtract pantry → round → zone-group
  - `_format_text_export(zones)` — plain-text export for WhatsApp sharing
  - `zero_waste_suggestions(...)` — scaffolded (returns `[]`; full logic future phase)

### API (`/api/v1/planner/`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/week` | Create/replace week plan + rebuild reservations |
| GET | `/week/current` | Current ISO week plan (creates empty if absent) |
| GET | `/week/{week_start}` | Specific week plan |
| DELETE | `/entries/{id}` | Remove entry + reservations |
| GET | `/shopping-list?week_start=` | Shopping list with pack rounding + WhatsApp URL |
| GET | `/zero-waste-suggestions` | Scaffolded endpoint |

### Key design notes
- `servings` on `MealPlanEntry` overrides `recipe.base_servings` for scaling (NULL = no override)
- Pack sizes from `config/pack_sizes.yaml` — edit YAML to change sizes without touching Python
- Shopping list includes `text_export` string and `whatsapp_url` (`whatsapp://send?text=...`)
- Pantry reservations created only for ingredients that exist in the pantry; others appear on shopping list
- `GET /week/current` registered before `GET /week/{week_start}` to avoid "current" parsed as a date

### Tests
- `tests/unit/test_planner.py` — 10 pure function tests + 2 integration tests

---

## Next Up: Phase 6 — Planner & Shopping List (done — see above)

## Next Up: Phase 7 — Frontend UI

**Goal:** Schedule meals for the week; generate a consolidated shopping list.

**Files to create:**
- `backend/app/services/planner.py` — create/update meal plan; generate shopping list
- `backend/app/api/v1/planner.py` — plan CRUD + shopping list endpoint

**Key implementation rules:**
- `POST /api/v1/plan` — create/replace week plan with `{entries: [{date, recipe_id, servings}]}`
- `GET /api/v1/plan` — current week plan with recipe summaries
- `GET /api/v1/plan/shopping-list` — consolidated ingredient list (shortfall only: required − available)
  - Group by ingredient; round up to nearest pack size from `config/pack_sizes.yaml`
  - Skip ingredients where pantry fully covers the need
- `POST /api/v1/plan/{entry_id}/reserve` — create `pantry_reservations` for a plan entry
- Scale quantities by `servings / recipe.base_servings`

---

## Open Questions / Blockers

None — Phase 3 can start immediately.

**Goal:** `POST /api/v1/ingredients/resolve` correctly maps ≥95% of a golden test set.

**Files to create:**
- `backend/app/services/normaliser.py` — 4-layer pipeline (lookup → fuzzy → LLM → user)
- `backend/app/services/bedrock.py` — AWS Bedrock client wrapper (reads `agent_config/`)
- `backend/app/api/v1/ingredients.py` — `/resolve` and `/override` endpoints
- `tests/unit/test_normaliser.py` — golden set (50+ raw names → expected canonical)
- `tests/fixtures/golden_ingredients.json` — the golden set data

**Key implementation rules:**
- Lookup: case-insensitive match on `ingredients.aliases` (GIN index on aliases column)
- Fuzzy: `rapidfuzz.fuzz.token_sort_ratio` against `canonical_name` + each alias; threshold from `agent_settings.yaml`
- LLM assist: only triggered when fuzzy < `fuzzy_threshold_llm_assist`; response cached in Redis
- User override: `POST /api/v1/ingredients/override` appends `raw_name` to `ingredient.aliases`
- All normaliser calls must be async; DB access via `get_db()` dependency injection

---

## Open Questions / Blockers

None — Phase 2 can start immediately.
