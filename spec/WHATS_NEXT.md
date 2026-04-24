# What's Next — Road to 10/10

*Based on the [Competitive Appraisal](./COMPETITIVE_APPRAISAL.md) scored April 2026.*

---

## Current Scores (from appraisal)

| Dimension | Current | Target | Gap |
|-----------|:-------:|:------:|:---:|
| Feature completeness | 9/10 | 10 | 1 |
| Engineering quality | 8/10 | 9 | 1 |
| UX / design | 6/10 | 8 | 2 |
| Documentation | 9/10 | 10 | 1 |
| Scalability | 7/10 | 8 | 1 |
| Security | 8/10 | 9 | 1 |
| Maintainability | 7/10 | 9 | 2 |
| Market readiness | 4/10 | 7 | 3 |
| **Overall** | **7.3** | **8.8** | **1.5** |

> **Tip:** The biggest ROI is in **Market readiness** (+3), **UX** (+2), and **Maintainability** (+2). Quick wins should target these first.

---

## 🟢 Tier 1 — Quick Wins (1–2 sessions each)

These can each be knocked out in an evening. High impact, low effort.

### 1.1 — PWA Install Prompt & App Icon
**Improves:** UX (+0.5), Market readiness (+0.5)

- [ ] Add a `manifest.json` with proper app name, icons (192px + 512px), theme colour, display: `standalone`
- [ ] Add the TeaBot chef logo as the PWA icon
- [ ] Add `<meta name="apple-mobile-web-app-capable">` + splash screens for iOS
- [ ] Test "Add to Home Screen" on iPhone and Android

> Right now it's a website. After this, it feels like an app when launched from the home screen.

---

### 1.2 — GitHub Actions CI Pipeline
**Improves:** Engineering quality (+0.5), Maintainability (+1)

- [ ] `.github/workflows/ci.yml` — triggered on push to `main` and PRs
- [ ] **Backend**: `ruff check`, `bandit -ll`, `pytest` (against a Postgres service container)
- [ ] **Frontend**: `eslint`, `tsc --noEmit` (type check), `next build`
- [ ] Badge in README (`![CI](https://github.com/Ready2k/WhatForTea/actions/workflows/ci.yml/badge.svg)`)

> This is table-stakes for any serious project. ~30 min to set up. Huge credibility boost.

---

### 1.3 — HTTPS via Caddy (document + verify)
**Improves:** Security (+0.5)

- [ ] Document the Caddy reverse proxy setup already in the repo (`Caddyfile`)
- [ ] Add to README: how HTTPS is terminated on NAS with auto-cert or self-signed
- [ ] Verify `Secure` flag on JWT cookies when behind HTTPS
- [ ] Add `HSTS` header in Caddy config

> The `Caddyfile` exists but isn't documented. This is free credibility.

---

### 1.4 — Offline Recipe Viewing (Service Worker Cache)
**Improves:** Feature completeness (+0.5), UX (+0.5)

- [ ] Register a service worker in the Next.js app
- [ ] Cache strategy: **network-first** for API calls, **cache-first** for recipe detail pages already visited
- [ ] When offline, show cached recipe steps/ingredients — disable pantry features gracefully
- [ ] Show a subtle "offline mode" banner

> Cooking happens at the counter, not near the router. Caching visited recipes means "I opened the recipe, walked to the kitchen, and my phone still shows it."

---

### 1.5 — Loading & Empty States Polish
**Improves:** UX (+0.5)

- [ ] Skeleton loaders for recipe cards, pantry list, planner grid (replace spinners)
- [ ] Empty state illustrations for: no recipes yet, empty pantry, no plan this week, empty shopping list
- [ ] Use the TeaBot character in empty states ("I'm hungry! Add some recipes to get started 🧑‍🍳")

> This is the difference between "functional" and "polished". Takes 1–2 hours per page.

---

### 1.6 — `robots.txt` + OpenGraph Meta Tags
**Improves:** Documentation (+0.25), Market readiness (+0.25)

- [ ] Add `robots.txt` (disallow all — it's a private app, but shows attention to detail)
- [ ] OpenGraph tags on recipe detail pages (so sharing a recipe link to WhatsApp shows a preview card)
- [ ] `<meta name="description">` on every page

> Tiny effort. Looks professional. WhatsApp recipe sharing becomes visually appealing.

---

## 🟡 Tier 2 — Medium Efforts (3–5 days each)

Worth planning into a sprint. Each one visibly moves a maturity score.

### 2.1 — Local LLM Fallback (Ollama)
**Improves:** Feature completeness (+0.5), Market readiness (+1), Scalability (+0.5)

- [ ] Add `LLM_PROVIDER` env var: `bedrock` (default) | `ollama`
- [ ] Ollama client in `bedrock.py` (or new `llm.py` abstraction) for text tasks only
- [ ] Test with `llama3` or `mistral` for: normaliser LLM assist, nutrition estimates, voice commands
- [ ] Keep Bedrock required for vision tasks (card ingestion, receipt scanning) — Ollama vision models aren't reliable enough yet
- [ ] Document in README: "Run without AWS by setting `LLM_PROVIDER=ollama`"

> This removes the single biggest adoption blocker. Anyone with a decent machine can run the text features without an AWS account.

---

### 2.2 — Design System & UI Consistency Pass
**Improves:** UX (+1)

- [ ] Define a design token set: colour palette, spacing scale, typography, border radii, shadows
- [ ] Document in `frontend/src/styles/tokens.css` or Tailwind theme extension
- [ ] Audit all pages for consistency: button styles, card layouts, form inputs, modals
- [ ] Ensure dark mode is consistent everywhere (check edge cases: modals, dropdowns, TeaBot panel)
- [ ] Add subtle micro-animations: card hover lifts, page transitions, toast notifications

> This is where "it works" becomes "it feels premium". Mealie's UI advantage comes from exactly this kind of consistency pass.

---

### 2.3 — Widen Card Format Support
**Improves:** Feature completeness (+0.5), Market readiness (+0.5)

- [ ] Obtain sample cards from Gousto, Dinnerly, EveryPlate, Mindful Chef
- [ ] Test current ingestion prompt against each format — log success/failure
- [ ] Add format hints to the ingestion prompt (or a format selector in the UI)
- [ ] Extend the golden test set with 2–3 cards per format
- [ ] Document supported formats in README

> The vision model is probably already flexible enough for most formats. This is mostly testing + minor prompt tuning.

---

### 2.4 — E2E Test Suite (Playwright)
**Improves:** Engineering quality (+0.5), Maintainability (+0.5)

- [ ] Add Playwright to the frontend
- [ ] Core flows: login → ingest recipe (mock LLM) → view in library → add to plan → generate shopping list → start cooking session
- [ ] Run in CI (headless Chromium in GitHub Actions)
- [ ] Screenshot comparison for key pages (visual regression)

> 95 unit/integration tests is great. E2E tests prove the system works end-to-end and catch integration regressions.

---

### 2.5 — Drag-and-Drop Meal Planner
**Improves:** UX (+0.5), Feature completeness (+0.25)

- [ ] Replace the current planner UI with a drag-and-drop weekly calendar
- [ ] Drag recipes from a side panel (library) onto day slots
- [ ] Drag between days to reschedule
- [ ] Use `@dnd-kit/core` or similar (lightweight, accessible)

> Mealie and Paprika both have this. It's the expected interaction for meal planning in 2026.

---

## 🔴 Tier 3 — Strategic Plays (1–2 weeks+)

These are bigger bets. Each one changes the product's trajectory.

### 3.1 — Open Source It
**Improves:** Market readiness (+2), Maintainability (+1), Community trust

- [ ] Choose licence: **AGPL-3.0** (same as Tandoor) — protects against hosted clones while allowing self-hosting
- [ ] Audit for hardcoded secrets or personal data in git history
- [ ] Add `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`
- [ ] Create GitHub Issues for "good first issue" items
- [ ] Write a launch post for r/selfhosted and r/homelab
- [ ] Set up GitHub Discussions for feature requests

> This is the single biggest lever for adoption. The self-hosted community is hungry for AI-native tools, and r/selfhosted regularly sends projects from 0 to 1k stars in a week.

---

### 3.2 — Video-to-Recipe Import
**Improves:** Feature completeness (+0.5)

- [ ] Accept YouTube / TikTok / Instagram URLs in the import flow
- [ ] Use `yt-dlp` to extract audio → transcribe with Whisper (local or Bedrock)
- [ ] Feed transcript to the ingestion LLM with a "video recipe" prompt variant
- [ ] Extract thumbnail as recipe image

> Mealie has this. Your LLM architecture already supports it. The main work is the transcription pipeline.

---

### 3.3 — Smart Notifications
**Improves:** Feature completeness (+0.5), UX (+0.5)

- [ ] Web Push notifications via service worker
- [ ] "Your chicken expires tomorrow — here are 3 recipes that use it"
- [ ] "Your weekly plan is empty — want me to auto-fill?"
- [ ] "You have 5 items expiring this week" (configurable threshold)
- [ ] Notification preferences in user profile

> This turns a passive tool into a proactive assistant. The data (expiry dates, confidence decay, matcher scores) already exists — it just needs a notification layer.

---

### 3.4 — Recipe Sharing & Public Links
**Improves:** Feature completeness (+0.25), Market readiness (+0.5)

- [ ] Generate a public, read-only URL for any recipe (signed token, no auth required)
- [ ] Clean, printable recipe page at `/shared/{token}`
- [ ] WhatsApp / iMessage share button on recipe detail
- [ ] QR code generation for sharing at the dinner table

> "What was in that dish?" → scan QR code → see the recipe. Social and practical.

---

## Priority Matrix

```
                        HIGH IMPACT
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
         │  3.1 Open Source │ 2.1 Ollama LLM   │
         │                  │ 1.2 CI Pipeline  │
         │                  │ 1.4 Offline Cache │
         │                  │                  │
LOW ─────┼──────────────────┼──────────────────┼───── HIGH
EFFORT   │                  │                  │    EFFORT
         │  1.1 PWA Install │ 2.2 Design System│
         │  1.3 HTTPS Docs  │ 2.4 E2E Tests    │
         │  1.5 Empty States│ 2.5 Drag-n-Drop  │
         │  1.6 Meta Tags   │ 3.2 Video Import │
         │                  │                  │
         └──────────────────┼──────────────────┘
                            │
                        LOW IMPACT
```

> **Recommended order for maximum score gain per session:**
> 1. `1.2` CI Pipeline — instant credibility, protects everything that follows
> 2. `1.1` PWA Install — makes it feel like a real app
> 3. `1.4` Offline Cache — solves a real cooking-at-the-counter problem
> 4. `1.5` Empty States — cheapest way to upgrade perceived quality
> 5. `2.1` Ollama Fallback — removes the biggest adoption blocker
> 6. `2.2` Design System — closes the UX gap with Mealie

---

## Projected Score After Tier 1 + Tier 2

| Dimension | Current | After T1 | After T1+T2 |
|-----------|:-------:|:--------:|:-----------:|
| Feature completeness | 9 | 9.5 | 10 |
| Engineering quality | 8 | 9 | 9.5 |
| UX / design | 6 | 7.5 | 8.5 |
| Documentation | 9 | 9.5 | 9.5 |
| Scalability | 7 | 7 | 8 |
| Security | 8 | 8.5 | 8.5 |
| Maintainability | 7 | 8 | 9 |
| Market readiness | 4 | 5 | 6.5 |
| **Overall** | **7.3** | **8.0** | **8.7** |

> Tier 1 alone moves you from **7.3 → 8.0**. That's 6 quick wins, each doable in an evening. Tier 3 (especially open-sourcing) is what gets you past 9.0 — but the foundation needs to be solid first.

---

*Last updated: April 2026*
