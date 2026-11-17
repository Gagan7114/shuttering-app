#!/usr/bin/env bash
# One-time setup (safe to run again): Python packages, PostgreSQL database,
# React build and the first login user.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }
command -v npm >/dev/null || { echo "Node.js / npm is required"; exit 1; }
command -v psql >/dev/null || { echo "psql (PostgreSQL client) is required"; exit 1; }

say "Python packages"
[ -d backend/.venv ] || python3 -m venv backend/.venv
backend/.venv/bin/pip install -q -r backend/requirements.txt

if [ ! -f backend/.env ]; then
  say "PostgreSQL database"
  read -rp "PostgreSQL host [127.0.0.1]: " PGH; PGH=${PGH:-127.0.0.1}
  read -rp "PostgreSQL port [5432]: " PGP; PGP=${PGP:-5432}
  read -rp "PostgreSQL admin user [postgres]: " PGA; PGA=${PGA:-postgres}
  read -rp "Name for the shop database [shuttering]: " DBN; DBN=${DBN:-shuttering}
  APP_PW=$(python3 -c "import secrets; print(secrets.token_hex(16))")
  SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(50))")
  echo "psql will now ask for the password of '$PGA'."
  psql -h "$PGH" -p "$PGP" -U "$PGA" -d postgres -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DBN') THEN
    CREATE ROLE "$DBN" LOGIN PASSWORD '$APP_PW';
  ELSE
    ALTER ROLE "$DBN" WITH LOGIN PASSWORD '$APP_PW';
  END IF;
END \$\$;
SELECT 'CREATE DATABASE "$DBN" OWNER "$DBN"'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DBN')\gexec
SQL
  cat > backend/.env <<ENV
SECRET_KEY=$SECRET
DEBUG=False
DB_NAME=$DBN
DB_USER=$DBN
DB_PASSWORD=$APP_PW
DB_HOST=$PGH
DB_PORT=$PGP
TIME_ZONE=Asia/Kolkata
ALLOWED_HOSTS=*
ENV
  chmod 600 backend/.env
  echo "Saved database login in backend/.env"
fi

say "Database tables"
cd backend
.venv/bin/python manage.py migrate --noinput
.venv/bin/python manage.py collectstatic --noinput -v 0
cd "$ROOT"

say "React app"
cd frontend
npm install --no-fund --no-audit
npm run build
cd "$ROOT"

cd backend
if ! .venv/bin/python manage.py shell -c "import sys; from django.contrib.auth import get_user_model; sys.exit(0 if get_user_model().objects.exists() else 1)" 2>/dev/null; then
  say "Create your login (owner account)"
  .venv/bin/python manage.py createsuperuser
fi

say "Done! Start the app with:  ./run.sh"
