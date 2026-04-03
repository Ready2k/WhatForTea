# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**WhatsForTea** is a locally-hosted recipe manager and kitchen assistant for Synology NAS deployments via Docker. It digitizes physical HelloFresh recipe cards and provides intelligent meal planning with confidence-based pantry management.

See `CHECKPOINT.md` for current build status and `plan.md` for the full implementation specification.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12 + FastAPI (async), Poetry, Alembic |
| Frontend | Next.js 15 (App Router) + TypeScript, Tailwind CSS, React Query |
| Database | PostgreSQL 16 |
| Cache / Queue | Redis 7 |
| LLM | AWS Bedrock (Claude 3.5 Sonnet) via boto3 |
| Scheduling | APScheduler (embedded in FastAPI — no Celery) |
| Infrastructure | Docker Compose (4 services: `api`, `frontend`, `db`, `redis`) |

## Development Commands

```bash
make init-dirs           # create ./data/db ./data/recipes ./data/backups (run once)
make up                  # start all services with hot reload
make down                # stop all services
make logs                # tail all logs
make migrate             # run pending Alembic migrations inside container
make shell-api           # bash into api container
```

**First time setup:**
```bash
cp .env.example .env     # then fill in POSTGRES_PASSWORD and JWT_SECRET
make init-dirs
make up
make migrate
```

**Running a single test:**
```bash
docker-compose exec api poetry run pytest tests/unit/test_normalizer.py -v
docker-compose exec api poetry run pytest tests/ -v     # all tests
```

**Alembic migrations:**
```bash
# Create a new migration (after editing models)
docker-compose exec api poetry run alembic revision --autogenerate -m "description"
# Apply
make migrate
```

## Deployment to Synology NAS (192.168.4.2)

```bash
# On dev machine — build linux/amd64 images and push to Docker Hub (ready2k)
make push-prod           # or: ./scripts/push-images.sh --prod

# On NAS (SSH in first)
docker-compose -f docker-compose.synology.yml pull
docker-compose -f docker-compose.synology.yml up -d
```

- NAS data path: `/volume1/docker/whatsfortea/`
- Images tagged: `ready2k/whatsfortea-api:latest`, `ready2k/whatsfortea-frontend:latest`
- Buildx builder name: `whatsfortea-builder` (created automatically by push script)
- **Do not use plain `docker build` for NAS deploys** — arm64 → amd64 requires `buildx`

## Architecture

### All phases complete
All 10 core phases and all 4 post-v1 tiers are implemented. The project is feature-complete.

### Backend structure
```
backend/
├── app/
│   ├── main.py             # FastAPI app entry point, lifespan, route registration, default user seeder
│   ├── config.py           # pydantic-settings (reads .env)
│   ├── database.py         # async SQLAlchemy engine + get_db() dependency
│   ├── errors.py           # AppError base class + error codes (ErrorCode)
│   ├── logging_config.py   # JSON structured logging setup
│   ├── middleware/
│   │   ├── auth.py         # JWT cookie validation; stores user_id + household_id in request.state
│   │   └── logging.py      # Request/response structured logging
│   ├── models/             # SQLAlchemy ORM models
│   │   ├── ingredient.py   # Ingredient, UnitConversion, IngredientSubstitute
│   │   ├── recipe.py       # Recipe, RecipeIngredient, Step
│   │   ├── pantry.py       # PantryItem, PantryReservation (+ expires_at)
│   │   ├── plan.py         # MealPlan, MealPlanEntry
│   │   ├── session.py      # CookingSession (+ user_id FK)
│   │   ├── ingest.py       # IngestJob, LlmOutput
│   │   ├── collection.py   # Collection, recipe_collections (M2M)
│   │   ├── user.py         # Household, User
│   │   └── normalised_amount.py  # NormalizedAmount value object
│   ├── schemas/            # Pydantic request/response schemas
│   ├── services/           # Business logic
│   │   ├── normaliser.py   # 4-layer ingredient normalisation pipeline
│   │   ├── bedrock.py      # AWS Bedrock client
│   │   ├── ingestion.py    # LLM ingest pipeline + job management
│   │   ├── pantry.py       # CRUD, decay (+ expiry override), availability, consumption
│   │   ├── matcher.py      # Hangry score calculation + use-it-up mode
│   │   ├── planner.py      # Week plan + shopping list + auto-fill
│   │   ├── cooking.py      # Cooking session CRUD + history
│   │   ├── barcode.py      # Open Food Facts lookup + Redis cache
│   │   ├── scheduler.py    # APScheduler: decay (03:00), expiry check (03:05), LLM cleanup (04:00)
│   │   └── voice.py        # Voice command intent parsing via LLM
│   └── api/v1/             # Route handlers — all prefixed /api/v1/
│       ├── auth.py         # Login, refresh, logout, /me
│       ├── ingredients.py
│       ├── recipes.py
│       ├── pantry.py       # + GET /expiring
│       ├── matcher.py
│       ├── planner.py
│       ├── cooking.py      # + ?mine=true history filter
│       ├── barcode.py
│       ├── collections.py
│       ├── users.py        # /users/me, /household, /household/join
│       └── voice.py
├── alembic/                # Migrations; env.py uses async engine
├── agent_config/           # LLM prompts (Jinja2 .md) + agent_settings.yaml
└── config/
    └── pack_sizes.yaml     # Shopping list rounding rules (edit without restart)
```

### API conventions
- All routes prefixed `/api/v1/` — do not skip the prefix
- Auth routes use `/api/auth/` prefix (no v1)
- Error envelope: `{ "error": { "code": "SCREAMING_SNAKE_CASE", "message": "...", "details": {} } }`
- Success: raw object or plain JSON array (no envelope wrapper)
- Error codes defined in `backend/app/errors.py` — add new codes there

### Frontend structure
```
frontend/src/
├── app/
│   ├── layout.tsx          # Root layout with Nav + Providers
│   ├── page.tsx            # Dashboard (hangry matcher + resume banner)
│   ├── login/              # Login page
│   ├── recipes/            # Recipe library + collection filter chips
│   ├── pantry/             # Pantry CRUD + expiry badges + barcode scan button
│   ├── planner/            # Week planner + shopping list
│   ├── ingest/             # Recipe ingest (photo upload + URL import + review)
│   ├── collections/        # Collection management page
│   └── profile/            # User profile + password change + household/invite
├── components/
│   ├── nav.tsx             # Bottom nav with current user name + profile link
│   ├── providers.tsx       # React Query + ThemeContext providers
│   └── BarcodeScanner.tsx  # Camera/BarcodeDetector modal with manual fallback
└── lib/
    ├── types.ts            # All shared TypeScript interfaces
    ├── api.ts              # All API call functions
    └── hooks.ts            # All React Query hooks
```

### Frontend proxy
`next.config.ts` rewrites `/api/*` → `http://api:8000/api/*` (internal Docker network). The browser only ever talks to the Next.js container on port 3000.

### Auth system
- JWT httpOnly cookies: `whatsfortea_access` (15 min) + `whatsfortea_refresh` (7 days)
- JWT payload: `{ sub: user_id, household_id, exp }`
- Auth middleware stores `request.state.user_id` and `request.state.household_id` after decode
- Login checks `users` table first; falls back to env `household_username`/`household_password_hash` for backwards compatibility
- On first startup with empty `users` table, a default household + admin user is seeded from env creds
- New users join via invite code: `POST /api/v1/household/join`

### Ingredient Normaliser (the critical foundation)
Layered pipeline:
1. **Lookup** — case-insensitive alias match against `ingredients.aliases`
2. **Fuzzy** — `rapidfuzz` ≥ 0.85 threshold (config: `fuzzy_threshold_auto_accept`)
3. **LLM** — Claude via Bedrock when fuzzy < 0.60 (config: `fuzzy_threshold_llm_assist`)
4. **User override** — persisted to `ingredients.aliases`

### LLM configuration
- Prompts are Jinja2 templates in `backend/agent_config/*.md` — **edit there, not in Python**
- Model + rate limits in `backend/agent_config/agent_settings.yaml` — tunable without restart
- Raw LLM responses stored in `llm_outputs` table (90-day retention, not in general logs)

### Pantry intelligence
- `effective_quantity = quantity × confidence`
- If `expires_at` is set, confidence is derived from days remaining vs category shelf life instead of time decay
- APScheduler runs daily decay at 03:00; fridge −0.1/day, pantry −0.02/day
- Expiry check at 03:05 logs items expiring within 3 days
- Always use `GET /api/v1/pantry/available` — never read `pantry_items.quantity` directly
- `pantry_reservations` table prevents double-counting across planner + active sessions

### Hangry matcher (continuous scoring)
- Per-ingredient: `min(available / required, 1.0)`
- Recipe score: mean × 100
- ≥90% = "Cook Now", 50–89% = "Almost There", <50% = "Planner"
- "Use it up" mode re-scores by weighting items closest to expiry or zero

### Barcode lookup
- `POST /api/v1/barcode/lookup` — checks Redis cache, then Open Food Facts, then runs normaliser
- Redis cache key: `barcode:{barcode}`, TTL 30 days
- Frontend uses `BarcodeDetector` Web API (Chrome/Edge) with manual numeric entry fallback

### Collections
- M2M via `recipe_collections` association table
- Client-side filtering: `GET /collections/{id}/recipe-ids` returns compact ID list; frontend filters without touching the matcher pipeline

## Key Configuration Files

| File | Purpose |
|------|---------|
| `backend/agent_config/agent_settings.yaml` | Model ID, temp, rate limits, fuzzy thresholds |
| `backend/agent_config/ingestion_prompt.md` | Vision LLM prompt (Jinja2) |
| `backend/agent_config/normaliser_prompt.md` | Ingredient resolution prompt (Jinja2) |
| `backend/agent_config/nutrition_prompt.md` | Nutrition estimation prompt (Jinja2) |
| `backend/agent_config/voice_prompt.md` | Voice command intent parsing prompt (Jinja2) |
| `backend/config/pack_sizes.yaml` | Shopping list rounding rules |
| `docker-compose.yml` | Local dev (build from source) |
| `docker-compose.synology.yml` | NAS production (pull from Docker Hub) |

## Testing Strategy
- `tests/fixtures/` — golden recipe test set (5+ HelloFresh cards with expected parse output)
- Ingredient normaliser hits 55/55 (100%) of golden set
- Integration tests use a real test PostgreSQL schema (no mocks for DB)
- Mocked LLM responses for non-golden-set tests

## Out of Scope
Supermarket integrations, native mobile app.
