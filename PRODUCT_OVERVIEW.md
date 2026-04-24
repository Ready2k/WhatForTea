# WhatsForTea — Product Overview

> This document is written for structured evaluation: competitive analysis, AI-assisted product review, or onboarding. It intentionally covers both strengths and genuine limitations.

---

## What It Is

WhatsForTea is a self-hosted recipe manager and AI kitchen assistant designed for households that cook from a physical recipe card library (HelloFresh, meal kit services) and want intelligent pantry-to-plate matching rather than just a recipe database.

The core question it answers: **"What can I actually cook tonight, given what's in my kitchen right now?"**

It runs as four Docker containers (API, frontend, PostgreSQL, Redis) and is optimised for Synology NAS deployment. There is no cloud service, no subscription, and no data leaves the household except LLM calls to AWS Bedrock.

**License:** GNU GPL v3. The source code is not yet publicly hosted but the licence is already in place.

---

## Target User

- Has a collection of physical recipe cards (HelloFresh, Gousto, similar) that they want to digitise
- Cooks at home regularly and struggles with "I know I have most of the ingredients, but what exactly can I make?"
- Is comfortable with a one-time Docker setup on a home server or NAS
- Has an AWS account (Bedrock is the only paid dependency — all LLM calls are per-token, no subscription)

**Not designed for:**
- Users who want a simple bookmarking tool for online recipes (better options exist)
- Mobile-first users who want a polished native app
- Users who want supermarket integration or online ordering

---

## Genuine Differentiators

### 1. AI Vision Ingestion of Physical Recipe Cards
Upload a photo of a recipe card front and back. Claude (via AWS Bedrock) extracts the recipe title, ingredients with quantities and units, step-by-step instructions, cook time, serving size, mood tags, and per-step image crop bounding boxes. A human review step surfaces any unresolved ingredients before saving.

The LLM prompt is general-purpose — it works with any printed recipe card format (HelloFresh, Gousto, Dinnerly, EveryPlate, hand-written cards, magazine cut-outs) and with recipe URLs. The golden test set was built using HelloFresh UK cards but real-world usage has confirmed compatibility with other formats.

This is the feature no open-source competitor has. Mealie, Tandoor, and Grocy all require the recipe to already exist in digital form.

### 2. Confidence-Decay Pantry Intelligence
Pantry items carry a 0–1 confidence score, not just a quantity. Confidence decays daily (fridge items: −0.1/day; pantry staples: −0.02/day) to reflect the reality that "I think I have chicken" is worth less than "I just bought chicken." If an expiry date is set, confidence is instead derived from days remaining versus the ingredient category's shelf life.

No competitor models pantry uncertainty this way. Grocy tracks expiry dates but treats quantities as binary. Mealie and Tandoor have no pantry model.

`effective_quantity = quantity × confidence`

All downstream scoring, planning, and shopping list generation uses this weighted value.

### 3. Hangry Matcher — Real-Time Cookability Scoring
Every recipe is scored against the live pantry in real time:

```
per-ingredient: min(available_effective / required, 1.0)
recipe score: mean of all ingredient scores × 100
```

Buckets: **Cook Now** (≥90%), **Almost There** (50–89%), **Planner** (<50%).

"Use It Up" mode re-ranks by weighting ingredients closest to expiry or lowest confidence, surfacing recipes that reduce waste.

### 4. TeaBot — Contextual Kitchen AI with Human-in-the-Loop
A LangGraph-powered chat assistant with a Postgres checkpointer for cross-session thread persistence. TeaBot has full read access to the recipe library, pantry state (confidence-weighted), active cooking sessions, week plan, and cooking history.

It can:
- Recommend what to cook (filtered by mood, time, pantry)
- Walk through a recipe interactively
- Add pantry items via a confirmation widget (human-in-the-loop interrupt — it asks before writing)
- Update the week plan inline
- Add items to the shopping list
- Navigate the app on the user's behalf

Responses stream via SSE. The agent renders declarative UI widgets (`recipe_card`, `pantry_confirm`) directly in the chat panel using the A2UI protocol — no page navigation required for common actions.

**What it is not:** It is not a general-purpose cooking AI. It is scoped strictly to the household's own data — it will not invent recipes from scratch or retrieve information from the web.

### 5. 4-Layer Ingredient Normaliser
All ingredients — whether ingested from a card, typed manually, scanned via barcode, or added by TeaBot — are resolved to a canonical ingredient identity before storage. The pipeline:

1. Case-insensitive alias lookup (exact match)
2. Fuzzy match via `rapidfuzz` (threshold: 0.85)
3. LLM assist via Claude Haiku (triggered only when fuzzy score < 0.60)
4. User override (persisted to the ingredient's alias list)

Tested against a 55-item golden set of real HelloFresh ingredients: **100% resolution rate.**

This means "chicken breast", "chicken breasts", "chicken breast fillet", and "diced chicken" all resolve to the same pantry item, so matching and planning work correctly.

### 6. Receipt Scanning → Pantry Population
Upload a photo or PDF of a supermarket receipt. The LLM reads the line items and bulk-adds them to the pantry, running each item through the normaliser. This is the fastest path from shopping trip to updated pantry.

### 7. Config-Driven LLM Layer
All LLM prompts are Jinja2 templates in `backend/agent_config/*.md`. Model IDs, temperature, and rate limits are in `agent_settings.yaml`. Changing a prompt or switching from Haiku to Sonnet requires editing a file, not touching Python code. Rate limit changes take effect within 30 seconds without a restart.

---

## Feature Matrix vs Key Competitors

| Feature | WhatsForTea | Mealie | Tandoor | Grocy | Paprika 3 |
|---------|------------|--------|---------|-------|-----------|
| Self-hosted / Docker | ✅ | ✅ | ✅ | ✅ | ❌ (cloud) |
| Multi-user household | ✅ | ✅ | ✅ | ✅ | ✅ |
| Recipe scraping from URL | ✅ | ✅ | ✅ | ❌ | ✅ |
| AI vision ingestion (physical cards) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Pantry management | ✅ | ✅ (basic) | ✅ (basic) | ✅ (advanced) | ❌ |
| Confidence-decay pantry model | ✅ | ❌ | ❌ | ❌ | ❌ |
| Expiry date tracking | ✅ | ❌ | ❌ | ✅ | ❌ |
| Pantry-based recipe scoring | ✅ (scored) | ✅ (binary) | ❌ | ❌ | ❌ |
| "Use it up" / waste-reduction mode | ✅ | ❌ | ❌ | partial | ❌ |
| AI chat assistant | ✅ | ❌ | ❌ | ❌ | ❌ |
| Human-in-the-loop confirmations | ✅ | ❌ | ❌ | ❌ | ❌ |
| Barcode scanning | ✅ | ✅ | ✅ | ✅ | ❌ |
| Receipt scanning | ✅ | ❌ | ❌ | ❌ | ❌ |
| Meal planning (weekly) | ✅ | ✅ | ✅ | partial | ✅ |
| Shopping list generation | ✅ | ✅ | ✅ | ✅ | ✅ |
| Pack-size rounding (shopping) | ✅ | ❌ | ❌ | ❌ | ❌ |
| WhatsApp shopping export | ✅ | ❌ | ❌ | ❌ | ❌ |
| Cooking mode (step-by-step) | ✅ | ❌ | ✅ | ❌ | ✅ |
| Timers in cooking mode | ✅ | ❌ | ✅ | ❌ | ✅ |
| Voice commands (cooking) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Nutritional estimates (AI) | ✅ | ✅ (manual) | ✅ (manual) | ❌ | ✅ (external) |
| Cook history / ratings | ✅ | ✅ | ✅ | ❌ | partial |
| Recipe collections / folders | ✅ | ✅ | ✅ | ❌ | ✅ |
| Serving size scaler | ✅ | ✅ | ✅ | ❌ | ✅ |
| Duplicate detection (AI) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Observability (Langfuse traces) | ✅ | ❌ | ❌ | ❌ | ❌ |
| REST API | ✅ | ✅ | ✅ | ✅ | ❌ |
| Open source | ✅ GPL v3 (not yet public) | ✅ (MIT) | ✅ (AGPL) | ✅ (GPL) | ❌ |
| Native mobile app | ❌ | ❌ | ❌ | ❌ | ✅ (iOS/Android) |
| Supermarket integration | ❌ | ❌ | ❌ | ❌ | ❌ |

*Sources: Mealie v1.12, Tandoor v1.5, Grocy v4.0, Paprika 3. Feature availability verified against public documentation April 2026.*

---

## Where Competitors Win

Being honest about where established alternatives have the advantage:

**Mealie is better when:**
- You want a large community, extensive recipe scrapers (supports 700+ sites), and a polished maintained product
- You don't have a physical card collection — URL scraping is its strength
- You want OpenID Connect / OAuth integration
- You don't need AI features and want a simpler dependency footprint

**Grocy is better when:**
- You need serious household inventory management (not just food — cleaning products, medicine, etc.)
- You want mature barcode scanning with community-maintained product database integration
- You need chore tracking, task management, or household budget features
- Expiry-driven stock rotation is the primary concern

**Paprika 3 is better when:**
- You want a native iOS/Android app with offline support
- You don't want to maintain any infrastructure
- You want sync across many devices seamlessly

**Tandoor is better when:**
- You want a fully FOSS stack with no proprietary dependencies
- You need extensive internationalization
- You want a large community-maintained recipe format import/export ecosystem

---

## Known Limitations

These are real constraints, not corner cases:

1. **AWS Bedrock dependency** — LLM features (card ingestion, TeaBot, receipt scanning, normaliser LLM assist, voice) all require AWS credentials with Bedrock access. If AWS is unavailable or access is revoked, these features fail. The pantry, matcher, planner, and shopping list work without LLM access; the ingestion pipeline does not.

2. **No native mobile app** — The frontend is a mobile-responsive Next.js PWA. It works well on iPhone and Android browsers but does not appear in app stores and cannot run fully offline.

3. **iOS voice limitations** — `speechSynthesis.pause()` is silently broken in iOS WKWebView (a known Apple limitation). The Pause button is hidden on iOS as a result. Google voices are unavailable on iOS Chrome; only on-device voices are accessible.

4. **Setup requires technical comfort** — Docker Compose, environment variables, and an AWS account are prerequisites. There is no one-click installer or managed hosting option.

5. **Golden test set is HelloFresh UK** — The 55-item golden set used to validate the ingredient normaliser was built from HelloFresh UK cards. The LLM ingestion prompt is general-purpose and has been verified to work with other card formats and recipe URLs in real-world use, but systematic accuracy benchmarks exist only for HelloFresh UK.

6. **No supermarket integration** — The shopping list is text-only. There is no ability to push directly to Tesco, Ocado, or any supermarket basket.

7. **Single household** — There is no concept of multiple households sharing a server instance. One Docker stack = one household.

8. **LLM costs** — AWS Bedrock charges per token. A typical card ingestion (front + back) costs roughly $0.002–$0.005 with Sonnet. TeaBot uses Haiku for chat (≈$0.0001/message). Receipt scanning costs depend on receipt length. For a household ingesting 2–3 cards per week, monthly Bedrock costs are negligible (<$1), but there is no hard cap enforced by the system beyond the configurable rate limits.

9. **Not yet publicly hosted** — The codebase is GPL v3 licensed but the repository is private. There is currently no public issue tracker, community plugins, or third-party integrations. Making the repository public would require no license change — the GPL v3 is already in place.

---

## Technical Architecture Summary

For agents evaluating technical implementation quality:

| Concern | Implementation |
|---------|---------------|
| **Auth** | JWT (HS256) in httpOnly cookies; 15-min access + 7-day refresh; Argon2id password hashing; brute-force protection (10 failures / 10 min → 429); Redis-backed |
| **Input validation** | Pydantic schemas on all endpoints; LLM input sanitised (angle-bracket replacement to prevent prompt injection); ALLOWED_NAV_PATHS whitelist for TeaBot navigation widgets |
| **Rate limiting** | Per-user per-minute for chat; per-hour for LLM calls; Redis-backed sliding window; degrades gracefully if Redis unavailable |
| **Data integrity** | All ingredient quantities normalised to canonical units before storage; pantry reservations prevent double-counting across planner + active cooking sessions |
| **Async** | Fully async FastAPI + SQLAlchemy + Redis; no blocking I/O on the request thread |
| **Observability** | JSON structured logs (all requests with duration_ms, route, user_id); Prometheus metrics at `/metrics`; Langfuse LLM trace integration |
| **Database** | PostgreSQL 16; 15 tables; Alembic migrations; async engine with `engine.dispose()` on shutdown |
| **Scheduler** | APScheduler embedded in FastAPI process; cron jobs wrapped in try/except with structured error logging; misfire grace 1 hour |
| **SSE streams** | AbortController on frontend (stream cancelled when panel closes/unmounts); streaming response with `Cache-Control: no-cache, X-Accel-Buffering: no` |
| **LLM** | Prompts in Jinja2 templates (not Python strings); model IDs via env vars; no prompt caching (Bedrock does not support the Anthropic API `anthropic_beta` flag) |
| **Config** | Rate limits and model settings re-read from YAML within 30s; no restart required for tuning |
| **Security scan** | `ruff check` clean; `bandit -ll` clean |

---

## What It Does Not Try to Be

- A recipe discovery platform (it doesn't know about recipes you haven't added)
- A general-purpose AI (TeaBot is scoped to the household's kitchen data only)
- An IoT kitchen device integration (no smart fridge, no scales)
- A nutrition tracking app (estimates are approximate, not medically validated)
- A meal kit subscription service

---

## Honest Summary

WhatsForTea wins on a specific combination that no open-source alternative currently offers: **physical card digitisation + confidence-aware pantry + AI-native chat assistant + cookability scoring**, all self-hosted. If your household has a HelloFresh card drawer and you've ever stood in the kitchen wondering whether you have enough of everything to make something specific, this solves that problem well.

It loses to Mealie on community size, recipe scraper breadth, and maturity. It loses to Grocy on general household inventory depth. It loses to commercial apps on mobile experience and zero-setup convenience.

The right question is not "is this better than Mealie?" but "does your household need what this specifically does?" If the answer is yes, there is no direct open-source equivalent. If the answer is no, Mealie is probably the right choice.

---

*Last updated: April 2026. Version v2.1.0.*
