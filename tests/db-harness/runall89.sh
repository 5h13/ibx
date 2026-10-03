#!/usr/bin/env bash
# Builds 78-89 verification, run as the postgres OS user from the project root:
#   su postgres -c "bash tests/db-harness/runall86.sh"
# full replay (schema.sql + every migration up to 20261220) + seed, then the Build 78-86 proofs (each once)
set -euo pipefail
cd "$(dirname "$0")/../.."
H=tests/db-harness
bash $H/replay.sh ibx86r 2>/dev/null | tail -1
psql -X -q -v ON_ERROR_STOP=1 -d ibx86r -f $H/seed78.sql -f $H/lib.sql >/dev/null
for f in proof78 proof79 proof80 proof81 proof82 proof84 proof85 proof86 proof88 proof89; do
  out=$(bash $H/run.sh ibx86r $H/$f.sql)
  echo "$f: $(grep -c PASS <<<"$out") passed, $(grep -cE 'FAIL|ERROR' <<<"$out") failed"
  grep -E 'FAIL|ERROR' <<<"$out" | head -3 || true
done
