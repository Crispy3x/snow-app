#!/usr/bin/env bash
# Runs the row level security tests against a scratch database on a local PostgreSQL (15 or newer).
# Uses the usual libpq settings (PGHOST, PGPORT, PGUSER); the user must be a superuser.
#   PGHOST=/path/to/socket PGPORT=5432 PGUSER=postgres ./supabase/tests/run.sh
# Creates the database ridgeline_rls_test, loads a stub of Supabase's auth/storage schemas, runs the migration,
# runs the checks, prints PASS/FAIL per check and drops the database again. Exit code 0 = all passed.
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
here="$(cd "$(dirname "$0")" && pwd)"
db="${RLS_TEST_DB:-ridgeline_rls_test}"

psql -X -q -d postgres -c "drop database if exists $db" >/dev/null
psql -X -q -d postgres -c "create database $db" >/dev/null
trap 'psql -X -q -d postgres -c "drop database if exists $db" >/dev/null 2>&1 || true' EXIT

psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/supabase_stub.sql" >/dev/null
echo "Loading migration..."
psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/../migrations/0001_team_sync.sql" >/dev/null
echo "Running the migration a second time (it must be re-runnable)..."
psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/../migrations/0001_team_sync.sql" >/dev/null

out="$(psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/rls_test.sql" 2>&1)" || { echo "$out"; echo "TEST SCRIPT ERROR"; exit 2; }
echo "$out" | grep -E '^(PASS|FAIL|---|SUMMARY)' || true
if echo "$out" | grep -q '^FAIL'; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
