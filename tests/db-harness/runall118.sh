#!/usr/bin/env bash
# Builds 78-118 verification, run as the postgres OS user from the project root:
#   su postgres -c "bash tests/db-harness/runall112.sh"
set -euo pipefail
cd "$(dirname "$0")/../.."
H=tests/db-harness
bash $H/replay.sh ibx86r 2>/dev/null | tail -1
psql -X -q -v ON_ERROR_STOP=1 -d ibx86r -f $H/seed78.sql -f $H/lib.sql >/dev/null
for f in proof78 proof79 proof80 proof81 proof82 proof84 proof85 proof86 proof88 proof89 proof90 proof90a proof91 proof92 proof93 proof94 proof95 proof96 proof97 proof98 proof99 proof100 proof101 proof103 proof104 proof106 proof107 proof112 proof113 proof114 proof115 proof116 proof118; do
  out=$(bash $H/run.sh ibx86r $H/$f.sql)
  echo "$f: $(grep -c PASS <<<"$out") passed, $(grep -cE 'FAIL|ERROR' <<<"$out") failed"
  grep -E 'FAIL|ERROR' <<<"$out" | head -3 || true
done
