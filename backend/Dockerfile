# syntax=docker/dockerfile:1
#
# Multi-stage Dockerfile for the WhatsForTea FastAPI backend.
#
# Targets:
#   development  — hot-reload via uvicorn --reload; source mounted as volume
#   production   — no dev deps, 2 uvicorn workers; built as linux/amd64 for NAS

FROM python:3.12-slim AS base

WORKDIR /app

ARG RELEASE_ID=unknown
ENV RELEASE_ID=${RELEASE_ID}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    POETRY_VERSION=1.8.3 \
    POETRY_NO_INTERACTION=1 \
    # Store the venv outside /app so bind-mounts in dev don't mask it
    POETRY_VIRTUALENVS_PATH=/opt/poetry-venvs \
    # Ensure `app` package is importable when running alembic or pytest from /app
    PYTHONPATH=/app

RUN pip install --no-cache-dir "poetry==${POETRY_VERSION}"

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps

COPY pyproject.toml poetry.lock* ./
RUN poetry install --no-root

# ── Development ───────────────────────────────────────────────────────────────
FROM deps AS development

# Source is bind-mounted at runtime; this COPY ensures entrypoint.sh is present
# on first build before the volume is populated.
COPY . .

EXPOSE 8000
# entrypoint.sh runs `poetry install` each startup so adding deps only requires
# editing pyproject.toml — no image rebuild needed in development.
CMD ["/app/entrypoint.sh"]

# ── Production ────────────────────────────────────────────────────────────────
FROM deps AS production

COPY . .
RUN poetry install --only main --no-root

EXPOSE 8000
CMD ["/bin/sh", "-c", "poetry run alembic upgrade head && poetry run uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2"]
