#!/bin/bash
set -e

# Ensure dependencies are installed (handles first start with an empty venv volume
# and picks up pyproject.toml changes without needing a full image rebuild)
echo "Checking Python dependencies..."
poetry install --no-root --quiet

echo "Starting WhatsForTea API..."
exec poetry run uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --reload
