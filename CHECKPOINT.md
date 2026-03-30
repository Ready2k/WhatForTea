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
| 4 — Pantry Intelligence | ⏳ Pending | |
| 5 — Hangry Matcher | ⏳ Pending | |
| 6 — Planner & Shopping List | ⏳ Pending | |
| 7 — Frontend UI | ⏳ Pending | |
| 8 — Security | ⏳ Pending | |
| 9 — Observability | ⏳ Pending | |
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

## Next Up: Phase 4 — Pantry Intelligence

**Goal:** Track ingredient inventory with confidence decay; update on cooking events.

**Files to create:**
- `backend/app/services/pantry.py` — CRUD + confidence-decay logic + availability query
- `backend/app/services/scheduler.py` — APScheduler embedded in FastAPI lifespan; daily decay job at 03:00
- `backend/app/api/v1/pantry.py` — CRUD + availability endpoints

**Key implementation rules:**
- `GET /api/v1/pantry` — list all pantry items
- `POST /api/v1/pantry` — add/update item (upsert by ingredient_id)
- `PATCH /api/v1/pantry/{id}` — adjust quantity or confirm (bumps confidence to 1.0)
- `DELETE /api/v1/pantry/{id}`
- `GET /api/v1/pantry/available` — returns `{ingredient, total_quantity, reserved_quantity, available_quantity, confidence}` list
- Confidence decay formula: `confidence -= decay_rate * days_since_last_confirmed; confidence = max(0.0, confidence)`
- Default `decay_rate`: fridge = 0.1/day, pantry = 0.02/day (stored per item, user-overridable)
- APScheduler job: daily 03:00 local time — apply decay to all items, zero out expired items
- `POST /api/v1/cooking-sessions/{id}/complete` should eventually trigger consumption (Phase 5+)

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
