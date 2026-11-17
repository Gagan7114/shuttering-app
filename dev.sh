#!/usr/bin/env bash
# For changing the app's code: Django on port 8001 + React with live reload on http://localhost:5173
# (frontend/vite.config.js forwards /api to 8001; port 8000 is used by another project).
# Ctrl+C stops both.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${BACKEND_PORT:-8001}"

if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  echo "Port $PORT is already in use (is the shop app already running?). Stop it first, or run:"
  echo "  BACKEND_PORT=8002 ./dev.sh"
  exit 1
fi

cd "$ROOT/backend"
.venv/bin/python manage.py migrate --noinput -v 0
DEBUG=True .venv/bin/python manage.py runserver "127.0.0.1:$PORT" &
BACKEND=$!
trap 'kill "$BACKEND" 2>/dev/null || true' EXIT

cd "$ROOT/frontend"
BACKEND_URL="http://127.0.0.1:$PORT" npm run dev
