#!/usr/bin/env bash
# Full PostgreSQL backup into ./backups (restore with pg_restore -d <db> <file>).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
set -a; . "$ROOT/backend/.env"; set +a
mkdir -p "$ROOT/backups"
FILE="$ROOT/backups/shuttering-$(date +%Y%m%d-%H%M).dump"
PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -Fc -f "$FILE" "$DB_NAME"
echo "Backup saved: $FILE"
