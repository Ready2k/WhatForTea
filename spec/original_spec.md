# 🍽️ Project Specification: "Whats for Tea?"

## Objective

A locally hosted (Synology/Docker) recipe management and kitchen assistant that:

- Digitizes physical HelloFresh cards
- Manages a "smart" pantry with confidence-based inventory
- Provides a swipe-based, low-friction cooking experience
- Minimises food waste through intelligent planning and matching

---

## 0. Core Design Principles

- **Offline-first cooking experience** (kitchen ≠ reliable internet)
- **Human-correctable AI** (LLM is assistive, not authoritative)
- **Single source of truth** for ingredients via canonical model
- **Low-friction interactions** (hands dirty, attention low)

---

## 1. Technical Stack (The "NAS-First" Blueprint)

- **Containerization**: Docker Compose (multi-container setup)
- **Backend**: Python (FastAPI, async-first)
- **Frontend**: Next.js (preferred) or Streamlit (fallback)
- **Database**: PostgreSQL
- **Cache / Queue (optional but recommended)**: Redis
- **AI Integration**: Vision-capable LLM API (Gemini 1.5 Pro / GPT-4o)
- **Storage**: Synology volume mapping for images
- **Observability (recommended)**:
  - Structured logs (JSON)
  - LLM trace logging

---

## 2. Data Models & Schema

### A. Canonical Ingredient Model

```ts
Ingredient {
  id: UUID
  canonical_name: string
  aliases: string[]
  category: enum
  typical_unit: string
}
```

- Supports fuzzy matching + alias resolution
- Example: "Echalion Shallot" → "Shallot"

---

### B. Recipe Object

**Metadata**

- Title
- Hero Image Path
- HelloFresh Style (1, 2, 3)
- Cooking Time
- Mood Tags (auto-generated)

**Ingredients**

```ts
RecipeIngredient {
  ingredient_id: UUID
  raw_name: string
  quantity: number
  unit: string
}
```

**Steps**

```ts
Step {
  id: number
  text: string
  timer_seconds?: number
  image_crop_path?: string
}
```

---

### C. Smart Pantry (Enhanced)

```ts
PantryItem {
  ingredient_id: UUID
  quantity: number
  unit: string
  confidence: float   // 0–1
  last_confirmed_at: timestamp
  last_used_at: timestamp
  decay_rate: float   // per day
}
```

---

## 3. Core Logic & Workflows

### Phase 1: Ingestion Engine (Image → Structured Data)

**Pipeline**

1. Upload images
2. Send to Vision LLM
3. Parse response
4. Validate + normalise
5. Persist

**Validation Layer**

- Reject:
  - zero or negative quantities
  - missing ingredients
  - unrealistic steps
- Retry or prompt user correction

**Output Versioning**

- Store:
  - raw LLM output
  - parsed result
  - user-corrected version

---

### Phase 2: Ingredient Normalisation Engine

**Responsibilities**

- Map raw ingredient → canonical ingredient
- Handle:
  - synonyms
  - spelling variations
  - unit mismatches

**Strategies**

- Lookup table (primary)
- Fuzzy match (fallback)
- User override (persisted)

---

### Phase 3: Inventory Intelligence

**Confidence Model**

```text
effective_quantity = quantity × confidence
```

**Decay Logic**

- Fridge items decay faster than pantry
- Confidence decreases over time

**Consumption Logic**

- Cooking a recipe:
  - auto-decrement pantry
  - reduce confidence if uncertain

---

### Phase 4: "Hangry" Matcher

**Match Score**

- Based on *effective quantity*, not raw quantity

```
S = (usable_ingredients / total_ingredients) × 100
```

**Categories**

- `> 90%` → Cook Now
- `50–90%` → Almost There
- `< 50%` → Planner

---

### Phase 5: Planner & Zero-Waste Engine

**Aggregation**

- Combine ingredients across recipes

**Smart Rounding**

- 0.5 onion → 1 onion
- 180g mince → 250g pack

**Zero-Waste Suggestions**

- Detect unused ingredient fractions
- Recommend complementary recipes

**Future Enhancement**

- Cost estimation
- Store-aware grouping

---

## 4. UI/UX Specifications

### A. Dashboard

- Context-aware prompts:
  > "You still have 500g mince and onions from Monday. Use them tonight?"
- Mode toggle:
  - Planning
  - Hangry

---

### B. Cooking Mode (Swipe Interface)

**Requirements**

- Offline-capable
- Preload next steps

**Interactions**

- Swipe Right → Done
- Swipe Left → Back

**Enhancements**

- Voice control:
  - "Next step"
  - "Repeat"
- Step timers (auto-triggered)

---

### C. Shopping List

**Features**

- Deduplicated ingredients
- Grouped by zone
- Rounded quantities

**Export**

```text
Whats for Tea? Shopping List:

FRIDGE:
* 500g Mince
* Sour Cream
```

**Action**

```text
whatsapp://send?text=[EncodedList]
```

---

## 5. State Management

**Cooking Session State**

```ts
CookingSession {
  recipe_id
  current_step
  completed_steps[]
  timers[]
}
```

**Events**

- step_completed
- ingredient_used
- timer_started

---

## 6. Deployment (Docker Compose)

**Volumes**

- `./app` → application code
- `../data/db` → PostgreSQL
- `../data/recipes` → images

**Services**

- api
- frontend
- db
- (optional) redis

---

## 7. Security (Basic but Necessary)

- Local authentication
- API key protection
- Rate limiting (LLM calls)
- Backup strategy (DB snapshots)

---

## 8. Observability

- Structured logs
- LLM input/output tracing
- Metrics:
  - ingestion success rate
  - match score distribution

---

## 9. Testing Strategy

- Golden recipe test set
- Expected parse outputs
- Pantry simulation tests
- Regression tests for ingredient matching

---

## ⚠️ Critical Component: Ingredient Normalizer

This is the foundation of the entire system.

If this fails:

- Matching fails
- Pantry lies
- UX collapses

**Requirements**

- Canonical model
- Alias mapping
- Fuzzy fallback
- User correction loop

---

## Summary

This system combines:

- OCR + AI structuring
- Canonical ingredient intelligence
- Confidence-based inventory
- Behaviour-aware UX
- Zero-waste optimisation

**End goal**: A kitchen assistant that behaves like a mildly competent human instead of a spreadsheet with opinions.
