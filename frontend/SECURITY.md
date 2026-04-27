# Security Notes — Frontend

## Accepted Risks

### GHSA-qx2v-qp2m-jg93 — postcss < 8.5.10 (Medium, CVSS 6.1)

**Status**: Accepted — not exploitable in this deployment context.

**Finding**: `npm audit` reports `postcss 8.4.31` inside `node_modules/next/node_modules/postcss`.

**Why it cannot be fixed**:
Every published version of Next.js (15.x and 16.x through at least 16.2.4) pins `postcss: 8.4.31` exactly as a non-range dependency. npm's `overrides` field cannot re-resolve a transitive dependency when the resolved version is already pinned to an exact version string. No upstream fix is available.

**Why it is not exploitable here**:
1. **Build-time only** — postcss runs during `next build` to process Tailwind CSS. It is not included in the standalone production output (`/app/.next/standalone`) and does not execute at runtime.
2. **Trusted input only** — the vulnerability (XSS via unescaped `</style>` in CSS stringify, CVE-2026-41305) requires untrusted CSS input to be passed through postcss. WhatsForTea's build pipeline processes only its own Tailwind CSS source files — no user-supplied CSS is processed.
3. **No network exposure** — the build step runs inside a Docker builder stage which is discarded; the vulnerability has zero attack surface in production.

**Reviewed**: 2026-04-26
