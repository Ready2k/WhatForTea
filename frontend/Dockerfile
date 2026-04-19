# syntax=docker/dockerfile:1
#
# Multi-stage Dockerfile for the WhatsForTea Next.js frontend.
#
# Targets:
#   development  — hot-reload via `next dev`; source mounted as volume
#   production   — `next build` with output:standalone; built as linux/amd64 for NAS

FROM node:22-alpine AS base
WORKDIR /app

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps

COPY package.json package-lock.json ./
RUN npm ci

# ── Development ───────────────────────────────────────────────────────────────
FROM deps AS development

# node_modules are in the image; source is bind-mounted at runtime
COPY . .

EXPOSE 3000
ENV NEXT_TELEMETRY_DISABLED=1
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

# ── Builder ───────────────────────────────────────────────────────────────────
FROM deps AS builder

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_RELEASE_ID=unknown
ENV NEXT_PUBLIC_RELEASE_ID=${NEXT_PUBLIC_RELEASE_ID}
RUN npm run build

# ── Production ────────────────────────────────────────────────────────────────
FROM base AS production

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000 \
    HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
