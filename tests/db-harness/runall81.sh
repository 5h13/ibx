#!/usr/bin/env bash
# Build 81 verification, run as the postgres OS user from the project root:
#   su postgres -c "bash tests/db-harness/runall80.sh"
# full replay (schema.sql + every migration, 20261212 and 20261213 included) + seed, then the Build 78-81 proofs
set -euo pipefail
cd "$(dirname "$0")/../.."
H=tests/db-harness
bash $H/replay.sh ibx81 2>/dev/null | tail -1
psql -X -q -v ON_ERROR_STOP=1 -d ibx81 -f $H/seed78.sql -f $H/lib.sql >/dev/null
bash $H/run.sh ibx81 $H/proof78.sql | tail -1
bash $H/run.sh ibx81 $H/proof79.sql | tail -1
bash $H/run.sh ibx81 $H/proof80.sql | tail -1
bash $H/run.sh ibx81 $H/proof81.sql | tail -1
