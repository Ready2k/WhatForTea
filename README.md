# WhatsForTea

![CI](https://github.com/Ready2k/WhatsForTea/actions/workflows/ci.yml/badge.svg)

A locally-hosted recipe manager and kitchen assistant designed for Synology NAS deployment via Docker. Digitizes meal kit recipe cards using AI vision and provides intelligent meal planning with confidence-based pantry management.

> For a structured product evaluation — feature matrix vs competitors, honest limitations, and architecture summary — see **[PRODUCT_OVERVIEW.md](./PRODUCT_OVERVIEW.md)**.

---

## Features

- **AI Recipe Ingestion** — photograph meal kit card fronts and backs; Claude (via AWS Bedrock) extracts structured recipe data with a human review step before saving. Supports **HelloFresh, Gousto, Dinnerly, EveryPlate, Mindful Chef**, and any other card format (auto-detect mode handles unknown brands)
- **Recipe Import from URL** — paste any recipe URL; the LLM extracts and structures it using the same review/confirm flow
- **Receipt Scanning** — photograph or upload a receipt (PDF/image); AI reads items and bulk-adds them to your pantry
- **TeaBot AI Assistant** — conversational kitchen assistant powered by LangGraph with human-in-the-loop confirmations; knows your pantry, plan, and shopping list; streams responses in real time
- **Hangry Matcher** — scores every recipe against your pantry in real time; ranks by what you can actually cook tonight
- **Pantry Intelligence** — tracks ingredient inventory with confidence decay (fridge items decay faster than pantry staples); supports expiry dates with per-category shelf-life confidence; prevents double-counting via a reservation model
- **Weekly Planner** — drag-and-drop weekly calendar; schedule meals Mon–Sun with mood-of-the-week auto-fill; swap days by dragging; generates a deduplicated, pack-size-rounded shopping list with WhatsApp export
- **Dedicated Shopping List** — separate page with two sections: manually added items (with ingredient autocomplete) and meal-plan-derived needs; items can be ticked off and bulk-marked as bought
- **Cooking Mode** — step-by-step full-screen UI with swipe navigation, countdown timers, and voice commands ("TeaBot, add salt to list"); saves session history with ratings and notes
- **Barcode Scanning** — scan pantry items via camera (BarcodeDetector API) or manual entry; resolves product names against the ingredient database via Open Food Facts
- **Recipe Collections** — organise recipes into colour-coded folders; filter the library by collection
- **Multi-User Households** — multiple household members each with their own login; admin can share an invite code; cooking history tracks who cooked what
- **Nutritional Estimates** — background LLM task estimates calories, protein, fat, carbs per serving; shown on recipe detail
- **Smart Notifications** — Web Push notifications via service worker: expiring pantry items, empty weekly plan reminders; configurable VAPID keys
- **PWA / Offline Mode** — installs to home screen on iOS and Android; visited recipe pages cached for offline cooking; offline banner shown when connectivity is lost
- **Local LLM Support (Ollama)** — run text-based features (TeaBot, normaliser, nutrition, voice) without an AWS account by setting `LLM_PROVIDER=ollama`

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
│  │  Normaliser │  │  Ingestion   │  │  Matcher  │  │
│  │  (4-layer)  │  │  Pipeline    │  │  Scorer   │  │
│  └─────────────┘  └──────┬───────┘  └───────────┘  │
└─────────────────────┬────┼─────────────────────────┘
                      │    │ boto3 / bedrock-runtime
┌─────────────────────▼─┐  └──────────────────────────►  AWS Bedrock
│   PostgreSQL 16        │                               (Claude 3.5 Sonnet)
│   15 tables            │
└────────────────────────┘
┌────────────────────────┐
│   Redis 7              │
│   LLM cache · Barcode  │
└────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12 + FastAPI (async), Poetry, Alembic |
| Frontend | Next.js 15 (App Router) + TypeScript, Tailwind CSS, React Query |
| Database | PostgreSQL 16 |
| Cache | Redis 7 |
| LLM | AWS Bedrock (Claude Sonnet — vision; Claude Haiku — chat/text) via boto3 + LangGraph |
| Chat | LangGraph with Postgres checkpointer; SSE streaming; prompt caching |
| Scheduling | APScheduler (embedded in FastAPI) |
| Infrastructure | Docker Compose (4 services: `api`, `frontend`, `db`, `redis`) |

### Key Design Decisions

- **Canonical ingredient model** — all matching, planning, and consumption operates on normalised quantities (`NormalizedAmount`), never raw strings
- **4-layer normaliser** — lookup → fuzzy (rapidfuzz ≥ 0.85) → LLM assist → user override; every unresolved ingredient is surfaced for correction
- **Confidence decay** — pantry items carry a 0–1 confidence score that decays daily (fridge: −0.1/day, pantry: −0.02/day); if `expires_at` is set, confidence is derived from days remaining vs shelf life instead
- **Reservation model** — `pantry_reservations` prevents double-counting the same ingredient across the planner and active cooking sessions
- **Config-driven** — LLM prompts (Jinja2 `.md`), model parameters (`agent_settings.yaml`), and pack-size rounding rules (`pack_sizes.yaml`) are all edited without touching Python
- **Backwards-compatible auth** — login checks the `users` table first; falls back to env-based credentials so existing deployments keep working; a default admin user is seeded from env creds on first startup

---

## Repository Structure

```
WhatsForTea/
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI entry point, lifespan, route registration
│   │   ├── config.py           # pydantic-settings (reads .env)
│   │   ├── database.py         # async SQLAlchemy engine + get_db()
│   │   ├── errors.py           # AppError + ErrorCode
│   │   ├── middleware/         # JWT auth + request logging
│   │   ├── models/             # SQLAlchemy ORM (15 tables)
│   │   ├── schemas/            # Pydantic request/response schemas
│   │   ├── services/
│   │   │   ├── normaliser.py   # 4-layer ingredient normalisation pipeline
│   │   │   ├── bedrock.py      # AWS Bedrock client
│   │   │   ├── ingestion.py    # LLM ingest pipeline + job management
│   │   │   ├── pantry.py       # CRUD, decay, expiry, availability, consumption
│   │   │   ├── matcher.py      # Hangry score calculation
│   │   │   ├── planner.py      # Week plan + shopping list + auto-fill
│   │   │   ├── cooking.py      # Cooking session CRUD + history
│   │   │   ├── barcode.py      # Open Food Facts lookup + Redis cache
│   │   │   ├── voice.py        # Voice command intent parsing via LLM
│   │   │   └── scheduler.py    # APScheduler jobs (decay, expiry check, cleanup)
│   │   └── api/v1/             # Route handlers (all prefixed /api/v1/)
│   ├── agent_config/
│   │   ├── agent_settings.yaml # Model ID, temperature, rate limits, fuzzy thresholds
│   │   ├── ingestion_prompt.md # Vision LLM prompt (Jinja2)
│   │   ├── normaliser_prompt.md# Ingredient resolution prompt (Jinja2)
│   │   ├── nutrition_prompt.md # Nutrition estimation prompt (Jinja2)
│   │   └── voice_prompt.md     # Voice command intent prompt (Jinja2)
│   ├── config/
│   │   └── pack_sizes.yaml     # Shopping list pack-size rounding rules
│   └── alembic/                # DB migrations
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── shopping-list/  # Dedicated shopping list (manually added + meal plan)
│   │   │   ├── planner/        # Weekly planner + auto-fill
│   │   │   ├── pantry/         # Pantry CRUD + barcode scan
│   │   │   ├── recipes/        # Library + recipe detail + cooking mode
│   │   │   ├── ingest/         # Photo / URL / receipt import
│   │   │   ├── collections/    # Collection management
│   │   │   └── profile/        # User profile + household
│   │   ├── components/         # Nav, BarcodeScanner, TeaBot panel, Providers
│   │   └── lib/                # types.ts, api.ts, hooks.ts
│   ├── eslint.config.mjs       # ESLint flat config (Next.js + TypeScript rules)
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

All routes are prefixed `/api/v1/`. Auth routes use `/api/auth/`. The frontend proxy rewrites `/api/*` to the API container — the browser only ever talks to the Next.js container on port 3000.

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Set httpOnly JWT cookies |
| POST | `/api/auth/refresh` | Rotate access token |
| POST | `/api/auth/logout` | Clear cookies |
| GET | `/api/auth/me` | Current user profile |

### Users & Household
| Method | Path | Description |
|--------|------|-------------|
| PATCH | `/api/v1/users/me` | Update display name |
| POST | `/api/v1/users/me/password` | Change password |
| GET | `/api/v1/household` | Household info + invite code |
| POST | `/api/v1/household/invite` | Rotate invite code (admin only) |
| GET | `/api/v1/household/members` | List all household members |
| POST | `/api/v1/household/join` | Create account with invite code |

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
| POST | `/api/v1/recipes/import-url` | Import recipe from URL; returns `{job_id}` |
| GET | `/api/v1/recipes/ingest/{id}/status` | Poll job status |
| GET | `/api/v1/recipes/ingest/{id}/review` | Parsed draft + unresolved ingredients |
| POST | `/api/v1/recipes/ingest/confirm/{id}` | Confirm and persist recipe |
| GET | `/api/v1/recipes/match` | All recipes scored against pantry (`?category=`, `?sort=use_it_up`) |
| GET | `/api/v1/recipes/` | Recipe library |
| GET | `/api/v1/recipes/{id}` | Full recipe with ingredients + steps |
| PUT | `/api/v1/recipes/{id}` | Update recipe (title, steps, ingredients) |
| DELETE | `/api/v1/recipes/{id}` | Delete recipe |

### Pantry
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/pantry/available` | Confidence-weighted availability (use this — not raw quantity) |
| GET | `/api/v1/pantry/expiring` | Items expiring within N days (`?days=3`) |
| GET | `/api/v1/pantry/` | Raw pantry items |
| POST | `/api/v1/pantry/` | Add / upsert item (supports `expires_at`) |
| POST | `/api/v1/pantry/bulk-confirm` | Bulk reset confidence to 1.0 |
| PATCH | `/api/v1/pantry/{id}` | Partial update |
| POST | `/api/v1/pantry/{id}/confirm` | Reset confidence to 1.0 |
| DELETE | `/api/v1/pantry/{id}` | Remove item |

### Planner & Shopping
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/planner/week` | Create/replace week plan |
| POST | `/api/v1/planner/auto-fill` | Suggest 7-day plan by mood + constraints |
| GET | `/api/v1/planner/week/current` | Current ISO week plan |
| GET | `/api/v1/planner/week/{week_start}` | Specific week plan |
| DELETE | `/api/v1/planner/entries/{id}` | Remove entry + reservations |
| GET | `/api/v1/planner/shopping-list` | Shopping list with WhatsApp export URL |

### Cooking Sessions
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/cooking/sessions` | Start a new cooking session |
| GET | `/api/v1/cooking/sessions/active` | Current active session |
| PATCH | `/api/v1/cooking/sessions/{id}` | Update step/timers/notes/rating |
| POST | `/api/v1/cooking/sessions/{id}/end` | End session (optionally consume pantry) |
| GET | `/api/v1/cooking/history` | Cook history (`?mine=true`, `?recipe_id=`) |

### Collections
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/collections` | List all collections with recipe counts |
| POST | `/api/v1/collections` | Create collection |
| PATCH | `/api/v1/collections/{id}` | Rename / recolour |
| DELETE | `/api/v1/collections/{id}` | Delete collection |
| GET | `/api/v1/collections/{id}/recipe-ids` | Compact recipe ID list for client-side filtering |
| POST | `/api/v1/collections/{id}/recipes/{recipe_id}` | Add recipe to collection |
| DELETE | `/api/v1/collections/{id}/recipes/{recipe_id}` | Remove recipe from collection |

### Manual Shopping List
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/shopping-list` | All pending manual shopping list items |
| POST | `/api/v1/shopping-list` | Add an item (raw_name, quantity, unit) |
| DELETE | `/api/v1/shopping-list/{id}` | Remove an item |
| POST | `/api/v1/shopping-list/bulk-done` | Mark multiple items as bought |

### TeaBot Chat
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/chat` | Start or continue a chat thread (SSE stream) |
| POST | `/api/v1/chat/resume` | Resume a HITL-paused graph with user decision |

### Barcode & Voice
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/barcode/lookup` | Resolve barcode → ingredient via Open Food Facts + normaliser |
| POST | `/api/v1/voice/command` | Parse voice transcript → structured intent |
| POST | `/api/v1/pantry/receipt` | Upload receipt image/PDF; bulk-add items to pantry |

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

### Supported Meal Kit Card Formats

| Brand | Format notes |
|-------|-------------|
| **HelloFresh** | 2P / 3P / 4P serving columns; coloured headers; front + back card |
| **EveryPlate** | Same column format as HelloFresh (same parent company) |
| **Gousto** | "2 people" / "4 people" serving labels; numbered step panels |
| **Dinnerly** | Simpler layout; fewer step photos; 2–4 serving default |
| **Mindful Chef** | 1–2 serving focus; detailed nutrition panels |
| **Auto-detect** | Claude reads cues from the card design and logo — works for unlisted brands |

Select the brand in the "Meal kit brand" chips on the Ingest page before uploading. "Auto-detect" (default) works well for all supported brands and is the right choice when you're unsure.

### Prerequisites
- Docker + Docker Compose
- AWS account with Bedrock access (Claude Sonnet enabled in your region) — **or** a local [Ollama](https://ollama.ai) instance for text-only features

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

On first startup, a default household and admin user are created automatically from the `HOUSEHOLD_USERNAME` and `HOUSEHOLD_PASSWORD_HASH` env vars. Log in with those credentials, then add other members via the invite code on the `/profile` page.

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
# All tests (against AIMock fixtures)
make test-mock

# Single file
docker-compose exec api poetry run pytest tests/unit/test_normaliser.py -v
```

### Deterministic Testing with AIMock

WhatsForTea uses **AIMock** to provide zero-cost, deterministic testing of AI workflows. This allows you to run the full test suite without an AWS account or network access.

#### How it works
- **Interception**: The `aimock` container (port 5001) intercepts all AWS Bedrock calls and TeaBot chat SSE streams.
- **Fixtures**: Responses are served from `aimock.json`. The backend is configured to use the mock via `AWS_ENDPOINT_URL=http://aimock:5001`.
- **Chaos & Latency**: Test frontend resiliency by sending "chaos test" (malformed JSON) or "latency test" (5s delay) to TeaBot.

#### Usage
- **Run Tests**: `make test-mock` runs the backend pytest suite against the mock environment.
- **Refresh Fixtures**: `make record-fixtures` starts AIMock in record mode. Any NEW calls made to Bedrock will be captured and saved to `aimock.json`.
- **Add Manual Mocks**: Edit `aimock.json` to add new matching rules for specific prompts or chat messages.

#### Environment Configuration
The system uses `.env.test` for automated testing, which overrides the standard AWS credentials and points to the local mock endpoint.


### Creating a Migration

```bash
docker-compose exec api poetry run alembic revision --autogenerate -m "description"
make migrate
```

---

### HTTPS & Production Deployment

For production (e.g., on a Synology NAS), it is recommended to terminate HTTPS using a reverse proxy. A `Caddyfile` is provided for this purpose.

- **Caddy**: Automatically handles SSL certificates via Let's Encrypt.
- **HSTS**: Enabled by default in the `Caddyfile` for improved security.
- **JWT Security**: When running over HTTPS, ensure your `JWT_SECRET` is strong and that cookies are handled securely by the browser.

To use Caddy:
1. Update `Caddyfile` with your domain.
2. Ensure ports 80 and 443 are forwarded to your NAS/server.
3. Run Caddy alongside your Docker stack (or as a separate container).

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
| `.env` | Secrets: DB password, JWT secret, AWS credentials, household credentials, model IDs |
| `backend/agent_config/agent_settings.yaml` | LLM model ID, temperature, rate limits, fuzzy thresholds |
| `backend/agent_config/ingestion_prompt.md` | Vision prompt for recipe card parsing (Jinja2) |
| `backend/agent_config/normaliser_prompt.md` | Ingredient resolution prompt (Jinja2) |
| `backend/agent_config/nutrition_prompt.md` | Nutrition estimation prompt (Jinja2) |
| `backend/agent_config/voice_prompt.md` | Voice command intent parsing prompt (Jinja2) |
| `backend/config/pack_sizes.yaml` | Shopping list rounding rules — edit without restart |
| `frontend/eslint.config.mjs` | ESLint configuration (flat config for Next.js 15 + ESLint 9) |

### LLM Model Configuration

Two model IDs are configured via environment variables — no code change needed to swap models:

| Variable | Default | Used for |
|----------|---------|---------|
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-sonnet-4-6` | Vision tasks: recipe card scan, auto-crop |
| `BEDROCK_TEXT_MODEL_ID` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Text tasks: TeaBot chat, normaliser LLM assist, nutrition, voice |

### Local LLM Support (Ollama)

WhatsForTea can run text-based AI features using a local Ollama instance instead of AWS Bedrock. This is ideal for reducing costs or offline use.

- **Setup**: Set `LLM_PROVIDER=ollama` and `OLLAMA_BASE_URL=http://your-ollama-host:11434`.
- **Model**: Default is `llama3`. Change via `OLLAMA_MODEL`.
- **Note**: Vision tasks (recipe ingestion, receipt scanning) still require AWS Bedrock (Claude Sonnet) as current local vision models are not yet reliable enough for this specific workflow.

---

## Build Status

| Phase | Status |
|-------|--------|
| 0 — Scaffolding | ✅ Complete |
| 1 — Data Layer (15 tables) | ✅ Complete |
| 2 — Ingredient Normaliser | ✅ Complete — 55/55 golden set (100%) |
| 3 — LLM Ingestion Pipeline | ✅ Complete |
| 4 — Pantry Intelligence | ✅ Complete |
| 5 — Hangry Matcher | ✅ Complete |
| 6 — Planner & Shopping List | ✅ Complete |
| 7 — Frontend UI | ✅ Complete |
| 8 — Security | ✅ Complete |
| 9 — Observability | ✅ Complete |
| 10 — Testing | ✅ Complete — 95 tests passing |

### Post-v1 Features

| Feature | Status |
|---------|--------|
| 4.4 — Expiry Date Input | ✅ Complete |
| 4.3 — Recipe Collections / Folders | ✅ Complete |
| 4.2 — Barcode Scanning | ✅ Complete |
| 4.1 — Multi-User Profiles | ✅ Complete |
| 3.6 — Voice-Dictated Notes & Commands | ✅ Complete |
| 3.5 — Nutritional Estimates | ✅ Complete |
| 3.4 — Mood-of-the-Week Auto-Fill | ✅ Complete |
| 3.3 — Step Image Crops | ✅ Complete |
| 3.2 — Live Serving Scale | ✅ Complete |
| 3.1 — Recipe Import from URL | ✅ Complete |
| 2.5 — Batch Pantry Refresh | ✅ Complete |
| 2.4 — Duplicate Recipe Detection | ✅ Complete |
| 2.3 — "Use It Up" Mode | ✅ Complete |
| 2.2 — Ratings & Notes | ✅ Complete |
| 2.1 — Cook History & Recipe Log | ✅ Complete |
| 1.4 — Inline Step Editing | ✅ Complete |
| 1.3 — Cooking Session Persistence | ✅ Complete |
| 1.2 — Ingredient Substitution | ✅ Complete |
| 1.1 — Zero-Waste Suggestions | ✅ Complete |

### v2 Features

| Feature | Status |
|---------|--------|
| TeaBot AI Chat (LangGraph, SSE, HITL) | ✅ Complete |
| Prompt caching + context scaling | ✅ Complete |
| Dedicated Shopping List page | ✅ Complete |
| Ingredient autocomplete (shopping add) | ✅ Complete |
| Receipt ingestion (PDF + image) | ✅ Complete |
| Model routing (Sonnet/Haiku via env vars) | ✅ Complete |
| ESLint 9 flat config | ✅ Complete |
| Code quality (ruff clean, bandit clean) | ✅ Complete |

### v3 Features

| Feature | Status |
|---------|--------|
| CI pipeline (GitHub Actions — ruff, bandit, pytest, ESLint, tsc, build) | ✅ Complete |
| PWA install + home screen icon | ✅ Complete |
| Offline cooking mode (service worker + OfflineBanner) | ✅ Complete |
| Smart push notifications (expiry alerts, empty-plan reminders) | ✅ Complete |
| Drag-and-drop meal planner (@dnd-kit) | ✅ Complete |
| Local LLM fallback (Ollama) for all text features | ✅ Complete |
| Design system tokens + micro-animations | ✅ Complete |
| Multi-brand card ingestion (HelloFresh, Gousto, Dinnerly, EveryPlate, Mindful Chef) | ✅ Complete |
| HTTPS / HSTS via Caddy | ✅ Complete |

---

## Out of Scope

Supermarket integrations, native mobile app.
