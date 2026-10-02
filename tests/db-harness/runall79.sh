#!/usr/bin/env bash
# Build 79 verification, run as the postgres OS user from the project root:
#   su postgres -c "bash tests/db-harness/runall79.sh"
# 1) full replay (schema.sql + every migration) + seed + Build 78 proof
# 2) backfill proof: Build 77 database with stock on record, then 20261208-20261210 applied as single transactions
set -euo pipefail
cd "$(dirname "$0")/../.."
H=tests/db-harness
bash $H/replay.sh ibx78 2>/dev/null | tail -1
psql -X -q -v ON_ERROR_STOP=1 -d ibx78 -f $H/seed78.sql -f $H/lib.sql >/dev/null
bash $H/run.sh ibx78 $H/proof78.sql | tail -1
bash $H/run.sh ibx78 $H/proof79.sql | tail -1
bash $H/replay.sh ibx77 20261207_build77_integration.sql 2>/dev/null | tail -1
psql -X -q -v ON_ERROR_STOP=1 -d ibx77 -f $H/seed78.sql -f $H/lib.sql >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d ibx77 -f $H/proof78_backfill_before.sql >/dev/null 2>&1
for m in 20261208_inventory_lots 20261209_reservation_hardcopy_dr 20261210_price_review 20261211_build79; do
  psql -X -q -v ON_ERROR_STOP=1 -d ibx77 -1 -f supabase/migrations/$m.sql >/dev/null 2>&1 || { echo "FAILED applying $m"; exit 1; }
done
bash $H/run.sh ibx77 $H/proof78_backfill_after.sql | tail -1
