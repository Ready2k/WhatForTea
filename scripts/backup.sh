#!/bin/bash
set -euo pipefail

# Backup script for WhatsForTea.
#
# Archives: PostgreSQL dump, recipe images, pack_sizes config, agent prompts.
# Retention: last 7 daily + 4 weekly backups.
#
# Usage (manual):   ./scripts/backup.sh
# Usage (NAS cron): called by APScheduler nightly at 03:00 or Synology task scheduler

BACKUP_DIR="${BACKUP_DIR:-./data/backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
ARCHIVE="${BACKUP_DIR}/whatsfortea_${TIMESTAMP}.tar.gz"
TMPDIR="$(mktemp -d)"

trap 'rm -rf "${TMPDIR}"' EXIT

mkdir -p "${BACKUP_DIR}"

echo "🗄️  WhatsForTea backup — ${TIMESTAMP}"
echo ""

# ── PostgreSQL dump ───────────────────────────────────────────────────────────
echo "  Dumping PostgreSQL..."
# Runs inside the db container; reads credentials from environment
docker-compose exec -T db pg_dump \
    -U "${POSTGRES_USER:-whatsfortea}" \
    "${POSTGRES_DB:-whatsfortea}" \
    > "${TMPDIR}/postgres.sql"
echo "  ✅ PostgreSQL dump complete"

# ── Recipe images ─────────────────────────────────────────────────────────────
echo "  Copying recipe images..."
cp -r ./data/recipes "${TMPDIR}/recipes" 2>/dev/null || echo "  ⚠️  No recipe images found — skipping"

# ── Config files (user-editable, not in source control on NAS) ───────────────
echo "  Copying config..."
mkdir -p "${TMPDIR}/config"
cp backend/config/pack_sizes.yaml "${TMPDIR}/config/" 2>/dev/null || true
cp -r backend/agent_config "${TMPDIR}/agent_config" 2>/dev/null || true

# ── Archive ───────────────────────────────────────────────────────────────────
echo "  Creating archive..."
tar -czf "${ARCHIVE}" -C "${TMPDIR}" .
echo "  ✅ Archive: ${ARCHIVE}"
echo ""

# ── Retention ─────────────────────────────────────────────────────────────────
# Tag Sundays as weekly backups; keep last 4 weeklies + last 7 dailies.
DAY_OF_WEEK="$(date +%u)"  # 1=Mon … 7=Sun
if [ "${DAY_OF_WEEK}" = "7" ]; then
    WEEKLY_ARCHIVE="${BACKUP_DIR}/whatsfortea_weekly_${TIMESTAMP}.tar.gz"
    cp "${ARCHIVE}" "${WEEKLY_ARCHIVE}"
    # Retain last 4 weekly backups
    ls -t "${BACKUP_DIR}"/whatsfortea_weekly_*.tar.gz 2>/dev/null | tail -n +5 | xargs rm -f || true
fi

# Retain last 7 daily backups
ls -t "${BACKUP_DIR}"/whatsfortea_[0-9]*.tar.gz 2>/dev/null | tail -n +8 | xargs rm -f || true

echo "Backup complete: $(du -sh "${ARCHIVE}" | cut -f1)"
