#!/usr/bin/env bash
# Start the shop app on port 8000. Add --local to block access from other devices,
# --port 8001 to use another port. Database updates (if any) are applied first.
cd "$(dirname "$0")/backend" || exit 1
.venv/bin/python manage.py migrate --noinput -v 0 || exit 1
exec .venv/bin/python serve.py "$@"
