# WhatsForTea — New Feature Specification

> This document covers proposed features beyond the v1 MVP (Phases 0–10). Features are grouped into four tiers by effort and value. Each tier section contains high-level rationale followed by detailed spec for each feature.

---

## High-Level Roadmap

| Tier | Theme | Features |
|------|-------|----------|
| 1 — Quick Wins | Scaffolded, low effort | Zero-waste suggestions, Ingredient substitution in matcher, Cooking session persistence, Inline step editing |
| 2 — High Value | Medium effort, strong UX impact | Cook history & recipe log, Ratings & notes, "Use it up" mode, Duplicate recipe detection, Batch pantry refresh |
| 3 — Bigger Features | Significant but self-contained | Recipe import from URL, Live serving scale, Step image crops, Mood-of-the-week planner, Nutritional estimates, Voice-dictated notes & commands |
| 4 — Stretch | Long-term / architectural changes | Multi-user profiles, Barcode scanning, Recipe collections, Expiry date input |

---

## Tier 1 — Quick Wins

These features are either already scaffolded in the codebase (DB schema exists, endpoint stub exists) or require minimal new surface area. Each can be built and shipped in isolation.

---

### 1.1 Zero-Waste Suggestions

**What it does:**
After a shopping trip, the user has rounded-up quantities of ingredients (e.g. bought a full bag of pine nuts for a recipe that needed 20 g). Zero-waste suggestions surfaces recipes that make good use of those leftover quantities — reducing waste and helping with next-week planning.

**Current state:**
- `GET /api/v1/planner/zero-waste-suggestions` endpoint exists but returns `[]`
- `zero_waste_suggestions()` function in `backend/app/services/planner.py` is scaffolded

**Backend changes:**
- In `planner.py`, implement `zero_waste_suggestions(week_start, db)`:
  1. Load the shopping list for the given week
  2. For each item, compute `leftover = rounded_quantity − required_quantity`
  3. Build a leftover availability map keyed by `ingredient_id`
  4. Run the matcher against this map (same scoring logic as `score_all_recipes`)
  5. Return the top N recipes sorted by leftover-coverage score, excluding recipes already in the week plan
- Add a `min_leftover_coverage` config in `agent_settings.yaml` (default: 0.3) to filter noise

**Frontend changes:**
- Add a "Use your leftovers" section to the bottom of the Shopping List tab in `/planner`
- Show up to 5 recipe cards with a "leftover coverage" badge (e.g. "Uses 4 of your leftovers")
- Tapping a card navigates to recipe detail

**Schema changes:** None required.

---

### 1.2 Ingredient Substitution in Matcher

**What it does:**
When the matcher finds a `hard_missing` ingredient, it checks if a known substitute is in the pantry. If so, the ingredient is reclassified as `partial` (with the substitute's `penalty_score` applied), and the overall recipe score improves. This makes "Almost There" recipes more actionable.

**Current state:**
- `ingredient_substitutes` table exists with `ingredient_id`, `substitute_ingredient_id`, `equivalence_note`, `penalty_score` columns
- No data is seeded; matcher does not consult this table
- No UI for managing substitutes

**Backend changes:**
- In `matcher.py`, extend `score_recipe()`:
  1. After classifying an ingredient as `hard_missing`, query `ingredient_substitutes` for that `ingredient_id`
  2. For each substitute, check if it appears in the pantry availability map
  3. If found: apply `penalty_score` (multiply ingredient score by `1 − penalty_score`); reclassify as `partial`
  4. Use the best-scoring substitute if multiple exist
- Add a seeded set of common substitutes to a new Alembic migration (e.g. butter ↔ margarine, cream ↔ crème fraîche, chicken stock ↔ vegetable stock)
- Expose substitute relationships on `GET /api/v1/ingredients/{id}` response

**Frontend changes:**
- In recipe detail ingredient list, show a note when a substitute is being used (e.g. "Using vegetable stock instead of chicken stock")
- In match result cards, show substitute count in the "Almost There" badge tooltip

**Schema changes:** None to schema; new seed migration only.

---

### 1.3 Cooking Session Persistence

**What it does:**
Tracks the user's progress through a recipe's cooking steps. If the user leaves cooking mode (phone call, browser close, etc.) they can resume exactly where they left off, with timers intact. Also provides the foundation for the cook history feature (Tier 2).

**Current state:**
- `cooking_sessions` table exists: `id`, `recipe_id`, `current_step`, `completed_steps` (array), `timers` (JSONB), `started_at`, `ended_at`
- No API endpoints exist
- Frontend cooking mode has no persistence — state is lost on navigation away

**Backend changes:**
- New routes under `/api/v1/cooking/`:
  - `POST /sessions` — create a new session for a `recipe_id`; returns session with `id`
  - `GET /sessions/active` — return the most recent non-ended session (for resume prompt on app load)
  - `PATCH /sessions/{id}` — update `current_step`, `completed_steps`, `timers` (JSONB patch)
  - `POST /sessions/{id}/end` — mark `ended_at = now()`; triggers pantry consumption if not already done
- `timers` JSONB structure: `{ "step_index": { "remaining_seconds": int, "running": bool } }`

**Frontend changes:**
- On entering cooking mode, call `POST /sessions` and store `session_id` in component state
- On step change or timer tick, call `PATCH /sessions/{id}` (debounced, max 1 req/5s)
- On app load (dashboard), if `GET /sessions/active` returns a result, show a "Resume cooking [Recipe Name]?" banner
- On leaving cooking mode (back button), call `POST /sessions/{id}/end`

---

### 1.4 Inline Step Editing

**What it does:**
Builds upon the recently added "Inline Ingredient Editing" feature. Allows the user to correct OCR errors or edit instructions directly on the recipe detail page without needing a complex separate form.

**Current state:**
- The backend `PUT /api/v1/recipes/{id}` endpoint supports replacing ingredients, but modifying steps relies on a backend API update.
- Pydantic schema `RecipeStepUpdate` exists but is not fully wired up to a bulk step replacement flow.

**Backend changes:**
- Extend the `PUT /api/v1/recipes/{id}` endpoint to accept a `steps` array in the `RecipeUpdate` payload.
- Clear existing steps and insert the new ordered steps.

**Frontend changes:**
- Add an "Edit" button next to the "Method" header on `/recipes/[id]`.
- Converts the step list into textareas where users can reword instructions, remove extra linebreaks, or add new steps.
- Provide a drag-and-drop sortable list (using `dnd-kit` or similar) to fix steps that were parsed in the wrong order.

---

## Tier 2 — High Value

These features require new database columns or tables, new service logic, and new frontend views, but are self-contained and add significant day-to-day value.

---

### 2.1 Cook History & Recipe Log

**What it does:**
Records every completed cooking session with the date, number of servings cooked, and which user confirmed it. Surfaces "last cooked" dates on recipe cards, prevents repeating the same meal too often, and feeds into smarter pantry decay (ingredients used in cooking are consumed sooner).

**Current state:**
- No history tracking exists
- `cooking_sessions.ended_at` captures when a cook ends but is not surfaced anywhere

**Schema changes:**
- Add `confirmed_cook` boolean to `cooking_sessions` (default false) — distinguishes abandoned sessions from completed cooks
- Add `servings_cooked` integer to `cooking_sessions` — how many portions were made
- Add `notes` text to `cooking_sessions` — optional freeform field (used by Tier 2.2 ratings)

**Backend changes:**
- `POST /sessions/{id}/end` accepts `{ confirmed: bool, servings_cooked: int }`:
  - If `confirmed=true`: call `consume_from_pantry(recipe_id)` and set `confirmed_cook=true`
  - Store `servings_cooked`
- New endpoints:
  - `GET /api/v1/cooking/history` — list completed sessions, newest first; supports `?recipe_id=` filter and `?limit=` pagination
  - `GET /api/v1/recipes/{id}/last-cooked` — returns most recent confirmed session date for a recipe
- Extend `GET /api/v1/recipes/` summary response to include `last_cooked_at` (nullable)

**Frontend changes:**
- Recipe cards on `/recipes` show "Last cooked X days ago" beneath the title if applicable
- Recipe detail shows full cook history at the bottom: date, servings, any notes
- Dashboard planning mode de-emphasises recipes cooked in the last 7 days (visual only — dimmed card)

---

### 2.2 Ratings & Notes

**What it does:**
After completing a cook, the user can give the recipe 1–5 stars and leave a short note (e.g. "Add more chilli next time", "Kids loved it"). Ratings surface in recipe sorting and can influence the matcher's ranking of equal-score recipes.

**Dependencies:** Requires 2.1 (cook history) since ratings are attached to sessions.

**Schema changes:**
- Add `rating` smallint (1–5, nullable) to `cooking_sessions`
- `notes` text is already proposed in 2.1

**Backend changes:**
- `PATCH /sessions/{id}` extended to accept `{ rating: int, notes: str }`
- Validate rating is 1–5 or null
- Extend `GET /api/v1/recipes/{id}` to include:
  - `average_rating` (float, nullable — null if never rated)
  - `total_cooks` (int)
  - `recent_notes` (last 3 session notes, newest first)
- Extend `GET /api/v1/recipes/match` to break ties in score by `average_rating` descending

**Frontend changes:**
- At the end of cooking mode ("You're done!" screen), show a 5-star tap widget and a text input for notes
- Submitting navigates back to recipe detail
- Recipe detail header shows average star rating (e.g. ★★★★☆ 4.2 from 6 cooks)
- Recipe cards on `/recipes` optionally show star rating beneath match badge
- Add "Sort by rating" option to the `/recipes` filter bar

---

### 2.3 "Use It Up" Mode

**What it does:**
A filter/sort mode on the recipes page that prioritises recipes which make heavy use of pantry items with the lowest confidence (i.e. things that are going off or haven't been confirmed recently). Directly reduces food waste by helping the user act on degrading stock.

**Current state:**
- Matcher scores by availability (quantity × confidence). "Use it up" inverts this: prioritise recipes that consume low-confidence items.

**Backend changes:**
- New query parameter on `GET /api/v1/recipes/match`: `?sort=use_it_up`
- When `sort=use_it_up`:
  1. Identify all pantry items with `confidence < 0.5` ("at risk" items)
  2. For each recipe, compute an "urgency score": sum of required quantities of at-risk ingredients (normalised to 0–1)
  3. Sort by urgency score descending (replaces default score-descending sort)
  4. Include `urgency_score` and `at_risk_ingredients` list in each `RecipeMatchResult`
- Configurable threshold: add `use_it_up_confidence_threshold: 0.5` to `agent_settings.yaml`

**Frontend changes:**
- Add a "Use it up" toggle button in the `/recipes` filter bar (distinct from category filter)
- When active, show a small "urgency" badge on recipe cards (e.g. "Uses 3 expiring items")
- Dashboard planning mode shows a contextual prompt if any pantry items are below threshold: "3 ingredients are running low — [find recipes]"

---

### 2.4 Duplicate Recipe Detection

**What it does:**
Prevents the user accidentally scanning and saving the same HelloFresh card twice. Checks both exact-match (same image fingerprint) and near-match (same title + similar ingredient list).

**Current state:**
- Frontend deduplication exists for the two sides of a single card (pixel fingerprint)
- No server-side check for existing recipes

**Schema changes:**
- Add `image_fingerprint` varchar (nullable) to `recipes` — stored at confirm time

**Backend changes:**
- In `confirm_recipe()` (ingestion service):
  1. Compute a perceptual hash (pHash) of the primary image
  2. Query `recipes.image_fingerprint` for any hash within Hamming distance ≤ 8
  3. If match found: return `409 Conflict` with `{ duplicate_recipe_id, duplicate_recipe_title }`
  4. Fallback title check: if no image match, compare title (fuzzy ≥ 0.90) and flag as a warning (not a hard block)
- Store `pHash` string in `recipes.image_fingerprint` on successful confirm

**Frontend changes:**
- If `POST /ingest/confirm/{id}` returns 409: show a modal "This looks like a duplicate of [Recipe Name]. View existing recipe or save anyway?"
- If title-only warning returned: show inline warning "A recipe with a similar name already exists" with link — user can proceed

---

### 2.5 Batch Pantry Refresh ("I've been shopping")

**What it does:**
After a shopping trip, the user wants to quickly mark multiple items as bought and reset their confidence to 1.0 rather than confirming them one at a time. The shopping list already knows what was needed — this feature closes the loop.

**Current state:**
- `POST /pantry/{id}/confirm` resets a single item
- No bulk operation exists
- Shopping list "Bought" button adds items individually

**Backend changes:**
- New endpoint: `POST /api/v1/pantry/bulk-confirm`
  - Body: `{ items: [{ ingredient_id, quantity, unit }] }`
  - For each item: upsert pantry entry (add if missing), set `confidence=1.0`, `last_confirmed_at=now()`
  - Returns count of items updated/created
- New endpoint: `POST /api/v1/pantry/confirm-from-shopping-list?week_start=YYYY-MM-DD`
  - Loads the shopping list for the given week
  - Calls bulk-confirm for all items on the list using their `rounded_quantity`
  - Convenient single-tap "I bought everything on the list" action

**Frontend changes:**
- Shopping list tab: replace individual "Bought" buttons with checkboxes per item
- Add a floating "Mark all as bought" button that appears once any item is checked
- Tapping "Mark all as bought" calls `confirm-from-shopping-list` and shows a toast: "15 pantry items updated"
- Checked items are visually struck through before confirmation

---

## Tier 3 — Bigger Features

These features require more substantial design work, new external integrations, or significant frontend investment. Each is self-contained and could be tackled as a mini-phase.

---

### 3.1 Recipe Import from URL

**What it does:**
Lets the user paste a URL from a recipe website (BBC Good Food, AllRecipes, Ottolenghi, etc.) and automatically parse the recipe into WhatsForTea format — without needing to scan a physical card. Massively expands the recipe library beyond HelloFresh cards.

**Backend changes:**
- New endpoint: `POST /api/v1/recipes/import-url`
  - Body: `{ url: str }`
  - Fetches HTML from URL (with a 10s timeout, no JavaScript rendering)
  - Passes HTML to a new LLM prompt (`url_ingestion_prompt.md`) that extracts: title, ingredients (raw), steps, cooking time, servings
  - Runs the normaliser on each ingredient
  - Creates an `IngestJob` in `review` status (bypasses the image-processing queue)
  - Returns `{ job_id }` — review/confirm flow is identical to image ingestion
- New Jinja2 prompt `backend/agent_config/url_ingestion_prompt.md`
- Add `url_import` as a new `IngestSourceType` enum value
- Store the source URL in `recipes.source_url` (new nullable varchar column + migration)

**Frontend changes:**
- Add a "Import from URL" tab to `/ingest` (alongside Camera / File Upload)
- Simple URL text input with a "Fetch Recipe" button
- On success, drops into the existing review/confirm flow — no new UI needed
- Recipe detail shows "Imported from [domain]" with a link if `source_url` is set

**Risks / constraints:**
- Some recipe sites block scraping — handle gracefully with a user-facing error ("This site can't be fetched automatically — try scanning the page instead")
- Do not use a headless browser (out of scope, too heavyweight for NAS deployment)
- Respect `robots.txt` — log a warning but do not block import (user's responsibility)

---

### 3.2 Live Serving Scale

**What it does:**
In recipe detail view, the user can adjust the serving count (e.g. from 2 to 4) and all ingredient quantities update live. This is independent of the planner's per-day serving override — it's for reference while shopping or cooking.

**Current state:**
- `recipe_ingredients.servings_quantities` JSONB field exists but its usage is unconfirmed
- No frontend scaling controls exist

**Backend changes:**
- Confirm and document the `servings_quantities` JSONB structure during implementation: `{ "1": qty, "2": qty, "4": qty, ... }` keyed by serving count, or use a scalar multiplier approach
- Extend `GET /api/v1/recipes/{id}` to include `base_servings` in the response (currently present in model, may not be in schema)
- No new endpoints needed — scaling is purely frontend maths

**Frontend changes:**
- Add a serving count stepper (−/+) to the recipe detail ingredient section
- State: `currentServings` initialised to `recipe.base_servings`
- Each ingredient quantity displayed as `(original_qty / base_servings) × currentServings`, rounded to 1 decimal
- Unit stays the same — only quantity scales
- Stepper range: 1–12, step 1
- Scaling state is not persisted (resets on page reload)

---

### 3.3 Step Image Crops

**What it does:**
When scanning a HelloFresh card, the LLM identifies which region of the card image corresponds to each cooking step (using bounding boxes). The cropped region is stored and displayed alongside the step text in cooking mode — mimicking the original card layout.

**Current state:**
- `steps.image_crop_path` is nullable; noted as "future enhancement" in codebase
- `steps.image_description` column exists for alt text

**Backend changes:**
- Extend `ingestion_prompt.md` to request bounding boxes per step: `{ step_index: int, bbox: [x1, y1, x2, y2] }` (0–1 normalised coordinates)
- In the ingestion service, after LLM response:
  - For each step with a bbox, crop the image using Pillow: `image.crop((x1*w, y1*h, x2*w, y2*h))`
  - Save to `/data/recipes/{recipe_id}/step_{N}_crop.jpg`
  - Store path in `steps.image_crop_path`
- New endpoint: `GET /api/v1/recipes/{id}/steps/{step_index}/image` — serve the crop file
- Graceful fallback: if LLM does not return a bbox for a step, `image_crop_path` stays null

**Frontend changes:**
- In cooking mode, if `step.image_crop_path` is not null, display the crop image above the step text
- Use `<img>` with `object-fit: contain` — constrain to max 40% of viewport height
- In recipe detail step list, show a small thumbnail per step if crop exists

**Risks:**
- LLM bounding box accuracy varies — may need user review/dismiss per crop at confirm time
- HelloFresh cards vary in layout; a fixed-region heuristic may outperform LLM bounding boxes for this specific card style

---

### 3.4 Mood-of-the-Week Planner

**What it does:**
Instead of manually picking a recipe per day, the user selects a set of mood tags (e.g. "Comfort", "Quick", "Light") and a serving preference, and the system auto-populates the week plan with the best-matching recipes given current pantry stock and recent cook history (avoids repeats).

**Backend changes:**
- New endpoint: `POST /api/v1/planner/auto-fill`
  - Body: `{ moods: [str], max_cook_time_mins: int (optional), servings: int, avoid_recent_days: int (default 14) }`
  - Algorithm:
    1. Filter recipes by `mood_tags` (any overlap with requested moods)
    2. Filter out recipes cooked within `avoid_recent_days` days (requires Tier 2.1)
    3. Filter by `cooking_time_mins <= max_cook_time_mins` if provided
    4. Score remaining recipes via matcher
    5. Greedily assign highest-scoring recipe to each unfilled day (no repeats within the week)
    6. Return a proposed `WeekPlan` object — does NOT save automatically
  - Client confirms the proposal with `POST /api/v1/planner/week`
- Add `mood_tags` array to `GET /api/v1/recipes/match` response (already on recipe model, needs surfacing in schema)

**Frontend changes:**
- New "Auto-fill week" button in the `/planner` weekly view header
- Opens a bottom sheet: mood tag multi-select (chip UI), max cook time slider (optional), serving size picker
- On submit, call `auto-fill` and populate the 7-day grid with the proposed plan (client state, not yet saved)
- User can swap individual days before saving
- "Save Plan" button calls the existing week plan save endpoint

---

### 3.5 Nutritional Estimates

**What it does:**
LLM-estimated per-recipe macros (calories, protein, fat, carbohydrates) displayed optionally in recipe detail and used to filter recipes. Estimates are labelled as approximate — not a medical tool.

**Schema changes:**
- Add `nutrition_estimate` JSONB (nullable) to `recipes`: `{ calories_kcal, protein_g, fat_g, carbs_g, fibre_g, per_servings }`
- Add `nutrition_estimated_at` timestamp to track staleness

**Backend changes:**
- New background task: `estimate_nutrition(recipe_id, db)`
  - Builds a structured ingredient list with quantities
  - Calls Bedrock with a new `nutrition_prompt.md` prompt
  - Parses response into `nutrition_estimate` JSONB
  - Stores result and timestamp on the recipe
- Trigger on `confirm_recipe` (queued as arq background task, non-blocking)
- New endpoint: `POST /api/v1/recipes/{id}/estimate-nutrition` — manual re-trigger
- Extend `GET /api/v1/recipes/{id}` to include `nutrition_estimate` (null if not yet estimated)
- Add `?max_calories=` and `?min_protein=` filter params to `GET /api/v1/recipes/match`

**Frontend changes:**
- Recipe detail: collapsible "Nutrition (estimated)" section showing macros per serving as a simple table
- Small disclaimer: "Estimates generated by AI — not suitable for medical or dietary planning"
- Optional pill filter on `/recipes` page: "Under 500 kcal", "High protein" (thresholds configurable)
- Recipe cards do not show nutrition by default — kept clean

---

### 3.6 Voice-Dictated Notes & Commands

**What it does:**
Leverages the recently implemented speech-to-text in cook mode to allow users to dictate cooking notes, add items to the shopping list hands-free, or log feedback when their hands are messy.

**Current state:**
- Basic voice navigation ("next", "back") is enabled via browser `SpeechRecognition` API.

**Backend changes:**
- Expand the semantic parsing (LLM) to take raw voice transcripts and interpret intent (e.g., "Add milk to the shopping list" → writes to the shopping list).
- Implement endpoint `POST /api/v1/voice/command` which accepts audio/transcripts.

**Frontend changes:**
- A pervasive microphone button in cooking mode that listens for specific trigger phrases ("TeaBot...", "Add to list...").
- At the end of a cooking session, a prompt: "How did it go? Just say it." translates speech into session notes.

---

## Tier 4 — Stretch

These features involve architectural changes or significant scope increases. They are documented here for future planning but are not prioritised for near-term implementation.

---

### 4.1 Multi-User Profiles

**What it does:**
Allows multiple household members to have separate accounts with shared recipe library but individual preferences, ratings, and cook history. A "household" model sits above individual users.

**Why deferred:**
Requires a significant auth overhaul — current single-user JWT model would need to support user rows, household foreign keys on recipes/pantry, and row-level access control. Out of scope until core features are stable.

**High-level design:**
- New `users` and `households` tables; all existing data associated with a default household
- Ratings and cook history become per-user
- Pantry and meal plans remain per-household (shared)
- Household invite flow (no email dependency — QR code or invite code)

---

### 4.2 Barcode Scanning

**What it does:**
Scan the barcode on a grocery item to add it directly to the pantry. Resolves ingredient via barcode → product name → normaliser pipeline.

**Why deferred:**
Listed as explicitly out of scope in `CLAUDE.md` for v1. Requires integration with an external product database (Open Food Facts or similar) and mobile camera access for barcode reading. High value but significant integration complexity.

**High-level design:**
- Frontend: use `BarcodeDetector` Web API (Chrome/Edge) or a JS barcode library fallback
- Backend: query Open Food Facts API by barcode → extract product name → run normaliser
- Cache barcode → ingredient_id mappings locally to avoid repeated API calls

---

### 4.3 Recipe Collections / Folders

**What it does:**
User-created named collections to organise recipes (e.g. "Quick Weeknight", "Summer BBQ", "Kids Favourites"). Collections can be used as a filter on `/recipes` and as a source for the mood-of-the-week planner.

**High-level design:**
- New `collections` table: `id`, `name`, `colour`
- Many-to-many `recipe_collections` join table
- Simple CRUD endpoints + frontend management UI
- Collections shown as filter chips on `/recipes` page

---

### 4.4 Expiry Date Input

**What it does:**
Instead of relying solely on confidence decay, the user can enter a specific best-before date for pantry items. The system uses the date to drive a more accurate decay curve and surfaces items about to expire in "Use it up" mode.

**High-level design:**
- Add `expires_at` date (nullable) to `pantry_items`
- Update `calculate_confidence()` to use `expires_at` when present: `confidence = max(0, (expires_at - today) / total_shelf_life)` where `total_shelf_life` is estimated from ingredient category
- Pantry UI: optional date picker when adding/editing an item
- APScheduler sends a daily check: flag items expiring within 3 days for "Use it up" mode

---

## Implementation Notes

- All new API endpoints must follow existing conventions: `/api/v1/` prefix, error envelope `{ "error": { "code", "message", "details" } }`, success as raw object/array
- All new DB columns require an Alembic migration
- New LLM prompts go in `backend/agent_config/*.md` as Jinja2 templates
- All new background tasks use the existing arq queue and `WorkerSettings` in `worker.py`
- New config thresholds (e.g. urgency confidence threshold) go in `agent_settings.yaml` — not hardcoded
- Each tier 1 and tier 2 feature should include unit tests following the existing pattern in `tests/unit/`
