#!/usr/bin/env bash
# Applies all migrations to a throw-away local PostgreSQL (with Supabase stubs) and runs SQL tests.
set -euo pipefail
cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PG_BIN:$PATH"
DATA="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
if [ "$(id -u)" = 0 ]; then
  chown -R postgres "$DATA"
  RUN=(runuser -u postgres --)
else
  RUN=()
fi
cleanup() { "${RUN[@]}" pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT
"${RUN[@]}" initdb -D "$DATA" -U postgres -A trust >/dev/null
"${RUN[@]}" pg_ctl -D "$DATA" -o "-p $PORT -k /tmp" -l "$DATA/log" start >/dev/null
PSQL=(psql -h /tmp -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f tests/supabase_stubs.sql
for f in migrations/*.sql; do echo "apply $f"; "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f tests/rls_and_triggers.test.sql
