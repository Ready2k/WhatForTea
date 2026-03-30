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

### Critical Path (implementation order)
1. **Phase 0** ✅ — Docker Compose skeleton
2. **Phase 1** — PostgreSQL schema + Alembic migrations (13 tables)
3. **Phase 2** — **Ingredient Normaliser** — blocks all downstream logic
4. **Phase 3** — LLM ingestion pipeline (image → Bedrock → validated recipe)
5. **Phase 4** — Pantry intelligence (confidence decay)
6. **Phase 5** — "Hangry" recipe matcher
7. **Phase 6** — Planner & shopping list
8. **Phase 7** — Frontend UI
9. **Phases 8–10** — Security, observability, testing

### Backend structure
```
backend/
├── app/
│   ├── main.py             # FastAPI app entry point, lifespan, route registration
│   ├── config.py           # pydantic-settings (reads .env)
│   ├── database.py         # async SQLAlchemy engine + get_db() dependency
│   ├── errors.py           # AppError base class + error codes (ErrorCode)
│   ├── logging_config.py   # JSON structured logging setup
│   ├── models/             # SQLAlchemy ORM models (added Phase 1)
│   ├── schemas/            # Pydantic request/response schemas (added Phase 1)
│   ├── services/           # Business logic (normaliser, matcher, etc.)
│   └── api/v1/             # Route handlers — all prefixed /api/v1/
├── alembic/                # Migrations; env.py uses async engine
├── agent_config/           # LLM prompts (Jinja2 .md) + agent_settings.yaml
└── config/
    └── pack_sizes.yaml     # Shopping list rounding rules (edit without restart)
```

### API conventions
- All routes prefixed `/api/v1/` — do not skip the prefix
- Error envelope: `{ "error": { "code": "SCREAMING_SNAKE_CASE", "message": "...", "details": {} } }`
- Success: raw object or plain JSON array (no envelope wrapper)
- Error codes defined in `backend/app/errors.py` — add new codes there

### Frontend proxy
`next.config.ts` rewrites `/api/*` → `http://api:8000/api/*` (internal Docker network). The browser only ever talks to the Next.js container on port 3000.

### Ingredient Normaliser (Phase 2 — the critical foundation)
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
- APScheduler runs daily decay at 03:00; fridge −0.1/day, pantry −0.02/day
- Always use `GET /api/v1/pantry/available` — never read `pantry_items.quantity` directly
- `pantry_reservations` table prevents double-counting across planner + active sessions

### Hangry matcher (continuous scoring)
- Per-ingredient: `min(available / required, 1.0)`
- Recipe score: mean × 100
- ≥90% = "Cook Now", 50–89% = "Almost There", <50% = "Planner"

## Key Configuration Files

| File | Purpose |
|------|---------|
| `backend/agent_config/agent_settings.yaml` | Model ID, temp, rate limits, fuzzy thresholds |
| `backend/agent_config/ingestion_prompt.md` | Vision LLM prompt (Jinja2) |
| `backend/agent_config/normaliser_prompt.md` | Ingredient resolution prompt (Jinja2) |
| `backend/config/pack_sizes.yaml` | Shopping list rounding rules |
| `docker-compose.yml` | Local dev (build from source) |
| `docker-compose.synology.yml` | NAS production (pull from Docker Hub) |

## Testing Strategy
- `tests/fixtures/` — golden recipe test set (5+ HelloFresh cards with expected parse output)
- Ingredient normaliser must hit ≥95% of golden set before Phase 2 is considered complete
- Integration tests use a separate test PostgreSQL schema
- Mocked LLM responses for non-golden-set tests

## Out of Scope (v1)
Barcode scanning, supermarket integrations, nutrition tracking, multi-user profiles, expiry-date recognition, step image cropping, native mobile app.
