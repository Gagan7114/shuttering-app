#!/usr/bin/env bash
# Forgot your password and have no recovery key? Run this on the shop computer.
#   ./reset-password.sh          shows the logins and asks which one
#   ./reset-password.sh gagan    sets a new password for "gagan"
set -euo pipefail
cd "$(dirname "$0")/backend"

NAME="${1:-}"
if [ -z "$NAME" ]; then
  echo "Logins in the shop app:"
  .venv/bin/python manage.py shell -v 0 -c "
from django.contrib.auth import get_user_model
for u in get_user_model().objects.order_by('username'):
    print('  -', u.username + ('' if u.is_active else '  (switched off)'))
"
  read -rp "Which login? " NAME
fi

echo "Type the new password for '$NAME' (letters do not show while you type)."
.venv/bin/python manage.py changepassword "$NAME"
echo "Done. Log in with the new password, then make a recovery key in Settings."
