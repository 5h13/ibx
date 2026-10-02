#!/usr/bin/env bash
# Runs a proof file; prints only section headers, PASS lines and errors.
# usage: tests/db-harness/run.sh <db> <file.sql>
psql -X -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" 2>&1 >/dev/null | sed -E 's/^psql:[^ ]+ (NOTICE|ERROR): +/\1 /' | grep -E "PASS|FAIL|ERROR|==|passed|WARNING" 
