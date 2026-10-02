#!/usr/bin/env bash
# Replays schema.sql + every migration, in order, on a fresh database.
# usage: tests/db-harness/replay.sh [dbname] [last-migration-prefix]
set -euo pipefail
DB=${1:-ibx}
UPTO=${2:-}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PSQL="psql -X -q -v ON_ERROR_STOP=1 -d $DB"
dropdb --if-exists "$DB" >/dev/null 2>&1 || true
createdb "$DB"
$PSQL -f "$ROOT/tests/db-harness/stubs.sql" >/dev/null
$PSQL -c 'create extension if not exists pgcrypto' >/dev/null
$PSQL -f "$ROOT/supabase/schema.sql" >/dev/null
n=0
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  b=$(basename "$f")
  if [[ -n "$UPTO" && "$b" > "$UPTO~" ]]; then break; fi
  # Supabase applies each migration as a single transaction
  if ! $PSQL -1 -f "$f" >/tmp/replay_err.txt 2>&1; then echo "FAILED: $b"; tail -20 /tmp/replay_err.txt; exit 1; fi
  n=$((n+1))
done
echo "replayed schema.sql + $n migrations into $DB"
