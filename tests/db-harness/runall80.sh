#!/usr/bin/env bash
# Build 80 verification, run as the postgres OS user from the project root:
#   su postgres -c "bash tests/db-harness/runall80.sh"
# full replay (schema.sql + every migration, 20261212 included) + seed, then the Build 78, 79 and 80 proofs
set -euo pipefail
cd "$(dirname "$0")/../.."
H=tests/db-harness
bash $H/replay.sh ibx80 2>/dev/null | tail -1
psql -X -q -v ON_ERROR_STOP=1 -d ibx80 -f $H/seed78.sql -f $H/lib.sql >/dev/null
bash $H/run.sh ibx80 $H/proof78.sql | tail -1
bash $H/run.sh ibx80 $H/proof79.sql | tail -1
bash $H/run.sh ibx80 $H/proof80.sql | tail -1
