# WhatsForTea

A locally-hosted recipe manager and kitchen assistant designed for Synology NAS deployment via Docker. Digitizes physical HelloFresh recipe cards using AI vision and provides intelligent meal planning with confidence-based pantry management.

---

## Features

- **AI Recipe Ingestion** — photograph HelloFresh card fronts and backs; Claude (via AWS Bedrock) extracts structured recipe data with a human review step before saving
- **Hangry Matcher** — scores every recipe against your pantry in real time; ranks by what you can actually cook tonight
- **Pantry Intelligence** — tracks ingredient inventory with confidence decay (fridge items decay faster than pantry staples); prevents double-counting with a reservation model
- **Weekly Planner** — schedule meals Mon–Sun; generates a deduplicated, pack-size-rounded shopping list with WhatsApp export
- **Cooking Mode** — step-by-step full-screen UI with swipe navigation, countdown timers, and optional voice commands; works offline via service worker

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Browser / Mobile                 │
│              Next.js 15 (port 3000)                 │
│          Tailwind CSS · React Query · PWA           │
└──────────────────────┬──────────────────────────────┘
                       │  /api/* (proxied internally)
┌──────────────────────▼──────────────────────────────┐
│              FastAPI (port 8000)                    │
│  Python 3.12 · async SQLAlchemy · APScheduler      │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │  Normaliser │  │ Ingestion    │  │  Matcher  │  │
│  │  (4-layer)  │  │  Pipeline    │  │  Scorer   │  │
│  └─────────────┘  └──────┬───────┘  └───────────┘  │
└─────────────────────┬────┼─────────────────────────┘
                      │    │ boto3 / bedrock-runtime
┌─────────────────────▼─┐  └──────────────────────────►  AWS Bedrock
│   PostgreSQL 16        │                               (Claude 3.5 Sonnet)
│   13 tables            │
└────────────────────────┘
┌────────────────────────┐
│   Redis 7              │
│   Job queue · LLM cache│
└────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12 + FastAPI (async), Poetry, Alembic |
| Frontend | Next.js 15 (App Router) + TypeScript, Tailwind CSS, React Query |
| Database | PostgreSQL 16 |
| Cache / Queue | Redis 7 |
| LLM | AWS Bedrock (Claude 3.5 Sonnet) via boto3 |
| Scheduling | APScheduler (embedded in FastAPI) |
| Infrastructure | Docker Compose (4 services: `api`, `frontend`, `db`, `redis`) |

### Key Design Decisions

- **Canonical ingredient model** — all matching, planning, and consumption operates on normalised quantities (`NormalizedAmount`), never raw strings
- **4-layer normaliser** — lookup → fuzzy (rapidfuzz ≥ 0.85) → LLM assist → user override; every unresolved ingredient is surfaced for correction
- **Confidence decay** — pantry items carry a 0–1 confidence score that decays daily (fridge: −0.1/day, pantry: −0.02/day); effective quantity = `quantity × confidence`
- **Reservation model** — `pantry_reservations` prevents double-counting the same ingredient across the planner and active cooking sessions
- **Config-driven** — LLM prompts (Jinja2 `.md`), model parameters (`agent_settings.yaml`), and pack-size rounding rules (`pack_sizes.yaml`) are all edited without touching Python

---

## Repository Structure

```
WhatsForTea/
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI entry point, lifespan, route registration
│   │   ├── config.py           # pydantic-settings (reads .env)
│   │   ├── database.py         # async SQLAlchemy engine + get_db()
│   │   ├── errors.py           # AppError + ErrorCode enum
│   │   ├── models/             # SQLAlchemy ORM (13 tables)
│   │   ├── schemas/            # Pydantic request/response schemas
│   │   ├── services/           # Business logic
│   │   │   ├── normaliser.py   # 4-layer ingredient normalisation pipeline
│   │   │   ├── bedrock.py      # AWS Bedrock client
│   │   │   ├── ingestion.py    # LLM ingest pipeline + job management
│   │   │   ├── pantry.py       # CRUD, decay, availability, consumption
│   │   │   ├── matcher.py      # Hangry score calculation
│   │   │   ├── planner.py      # Week plan + shopping list generation
│   │   │   └── scheduler.py    # APScheduler jobs (decay, cleanup)
│   │   └── api/v1/             # Route handlers (all prefixed /api/v1/)
│   ├── agent_config/
│   │   ├── agent_settings.yaml # Model ID, temperature, rate limits, fuzzy thresholds
│   │   ├── ingestion_prompt.md # Vision LLM prompt (Jinja2)
│   │   └── normaliser_prompt.md# Ingredient resolution prompt (Jinja2)
│   ├── config/
│   │   └── pack_sizes.yaml     # Shopping list pack-size rounding rules
│   └── alembic/                # DB migrations
├── frontend/
│   ├── src/app/                # Next.js App Router
│   └── next.config.ts          # API proxy: /api/* → http://api:8000/api/*
├── scripts/
│   ├── push-images.sh          # buildx cross-compile → Docker Hub (linux/amd64)
│   └── backup.sh               # pg_dump + images → timestamped tarball
├── docker-compose.yml          # Local dev (hot reload, builds from source)
├── docker-compose.synology.yml # NAS production (pulls from Docker Hub)
├── Makefile
└── .env.example
```

---

## API Overview

All routes are prefixed `/api/v1/`. The frontend proxy rewrites `/api/*` to the API container — the browser only ever talks to the Next.js container on port 3000.

### Ingredients
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/ingredients/resolve` | Normalise a raw ingredient name |
| POST | `/api/v1/ingredients/override` | Persist a user-confirmed alias mapping |
| GET | `/api/v1/ingredients/` | List all canonical ingredients |

### Recipes & Ingestion
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/recipes/ingest` | Upload card images; returns `{job_id}` |
| GET | `/api/v1/recipes/ingest/{id}/status` | Poll job status |
| GET | `/api/v1/recipes/ingest/{id}/review` | Parsed draft + unresolved ingredients |
| POST | `/api/v1/recipes/ingest/confirm/{id}` | Confirm and persist recipe |
| GET | `/api/v1/recipes/match` | All recipes scored against pantry (`?category=cook_now\|almost_there\|planner`) |
| GET | `/api/v1/recipes/` | Recipe library |
| GET | `/api/v1/recipes/{id}` | Full recipe with ingredients + steps |

### Pantry
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/pantry/available` | Confidence-weighted availability (use this — not raw quantity) |
| GET | `/api/v1/pantry/` | Raw pantry items |
| POST | `/api/v1/pantry/` | Add / upsert item |
| PATCH | `/api/v1/pantry/{id}` | Partial update |
| POST | `/api/v1/pantry/{id}/confirm` | Reset confidence to 1.0 |
| DELETE | `/api/v1/pantry/{id}` | Remove item |

### Planner & Shopping
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/planner/week` | Create/replace week plan |
| GET | `/api/v1/planner/week/current` | Current ISO week plan |
| GET | `/api/v1/planner/week/{week_start}` | Specific week plan |
| DELETE | `/api/v1/planner/entries/{id}` | Remove entry + reservations |
| GET | `/api/v1/planner/shopping-list` | Shopping list with WhatsApp export URL |

### Error shape
```json
{
  "error": {
    "code": "INGREDIENT_UNRESOLVED",
    "message": "...",
    "details": {}
  }
}
```

---

## Getting Started

### Prerequisites
- Docker + Docker Compose
- AWS account with Bedrock access (Claude 3.5 Sonnet enabled in your region)

### Local Development

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD, JWT_SECRET, and AWS credentials

# 2. Create data directories (run once)
make init-dirs

# 3. Start all services with hot reload
make up

# 4. Run database migrations
make migrate

# 5. Verify
curl http://localhost:8000/health   # → {"status":"ok"}
open http://localhost:3000
```

### Common Commands

```bash
make up          # Start all services
make down        # Stop all services
make logs        # Tail all logs
make migrate     # Apply pending Alembic migrations
make shell-api   # Bash into the API container
```

### Running Tests

```bash
# All tests
docker-compose exec api poetry run pytest tests/ -v

# Single file
docker-compose exec api poetry run pytest tests/unit/test_normaliser.py -v
```

### Creating a Migration

```bash
docker-compose exec api poetry run alembic revision --autogenerate -m "description"
make migrate
```

---

## Deployment (Synology NAS)

```bash
# On dev machine — cross-compile to linux/amd64 and push to Docker Hub
make push-prod

# On NAS (SSH in)
docker-compose -f docker-compose.synology.yml pull
docker-compose -f docker-compose.synology.yml up -d
```

| Setting | Value |
|---------|-------|
| NAS IP | `192.168.4.2` |
| Data path | `/volume1/docker/whatsfortea/` |
| API image | `ready2k/whatsfortea-api:latest` |
| Frontend image | `ready2k/whatsfortea-frontend:latest` |

> **Note:** Always use `make push-prod` (buildx) for NAS deploys — plain `docker build` will produce arm64 images that won't run on the NAS.

---

## Configuration Reference

| File | Purpose |
|------|---------|
| `.env` | Secrets: DB password, JWT secret, AWS credentials |
| `backend/agent_config/agent_settings.yaml` | LLM model ID, temperature, rate limits, fuzzy thresholds |
| `backend/agent_config/ingestion_prompt.md` | Vision prompt for recipe card parsing (Jinja2) |
| `backend/agent_config/normaliser_prompt.md` | Ingredient resolution prompt (Jinja2) |
| `backend/config/pack_sizes.yaml` | Shopping list rounding rules — edit without restart |

---

## Build Status

| Phase | Status |
|-------|--------|
| 0 — Scaffolding | ✅ Complete |
| 1 — Data Layer (13 tables) | ✅ Complete |
| 2 — Ingredient Normaliser | ✅ Complete — 55/55 golden set (100%) |
| 3 — LLM Ingestion Pipeline | ✅ Complete |
| 4 — Pantry Intelligence | ✅ Complete |
| 5 — Hangry Matcher | ✅ Complete |
| 6 — Planner & Shopping List | ✅ Complete |
| 7 — Frontend UI | ✅ Complete |
| 8 — Security | ⏳ Pending |
| 9 — Observability | ✅ Complete |
| 10 — Testing | ✅ Complete — 95 tests passing |

---

## Out of Scope (v1)

Barcode scanning, supermarket integrations, nutrition tracking, multi-user profiles, expiry-date recognition, step image cropping, native mobile app.
