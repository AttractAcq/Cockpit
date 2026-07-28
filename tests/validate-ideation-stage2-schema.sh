#!/usr/bin/env bash
# Exact-schema validation for the Ideation Stage 2 migration.
#
# Requires IDEATION_SCHEMA_BASELINE to point at an authorized, read-only,
# schema-only dump of the linked project. The dump is never committed and no
# data is exported. Mirrors tests/validate-ideation-pr1-schema.sh.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
baseline="${IDEATION_SCHEMA_BASELINE:-}"
image="${IDEATION_SCHEMA_POSTGRES_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.141}"
database="${IDEATION_TEST_DB_NAME:-ideation_test}"
database_user="${IDEATION_TEST_DB_USER:-supabase_admin}"
container="${IDEATION_TEST_DB_CONTAINER:-aa-ideation-stage2-schema-$RANDOM-$$}"
workspace="$(mktemp -d)"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$workspace"
}
trap cleanup EXIT

if [[ -z "$baseline" ]]; then
  echo "BLOCKED: set IDEATION_SCHEMA_BASELINE to an exact, authorized, read-only schema dump." >&2
  exit 2
fi
if [[ ! -f "$baseline" ]]; then
  echo "Schema baseline does not exist: $baseline" >&2
  exit 2
fi
baseline="$(cd "$(dirname "$baseline")" && pwd)/$(basename "$baseline")"
if [[ "$baseline" == "$repo_root/tests/ideation-pr1-baseline.sql" ]]; then
  echo "The synthetic unit fixture is not an authoritative schema baseline." >&2
  exit 2
fi

docker run -d --name "$container" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB="$database" "$image" >/dev/null

for _ in $(seq 1 90); do
  if docker exec "$container" psql -XAtq -U "$database_user" -d "$database" -c 'select 1' 2>/dev/null |
      grep -qx '1'; then break; fi
  sleep 1
done
sleep 2
docker exec "$container" psql -XAtq -U "$database_user" -d "$database" -c 'select 1' | grep -qx '1'

docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" <<'SQL'
drop schema if exists auth cascade;
drop schema if exists public cascade;
SQL

if pg_restore --list "$baseline" >/dev/null 2>&1; then
  docker cp "$baseline" "$container:/tmp/authoritative-schema.dump"
  docker exec "$container" pg_restore --exit-on-error --no-owner --no-privileges \
    -U "$database_user" -d "$database" /tmp/authoritative-schema.dump
else
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" < "$baseline"
fi

psql_cmd=(docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database")

# Frozen-object snapshot before and after: Stage 2 must not drift Phase 1,
# Phase 2, playbooks, playbook_runs, or any downstream domain.
"${psql_cmd[@]}" < "$repo_root/tests/ideation-pr1-schema-snapshot.sql" > "$workspace/before.json"
"${psql_cmd[@]}" < "$repo_root/supabase/migrations/20260728000036_ideation_stage2_scoring.sql"
"${psql_cmd[@]}" < "$repo_root/tests/ideation-stage2-schema-postflight.sql"
"${psql_cmd[@]}" < "$repo_root/tests/ideation-pr1-schema-snapshot.sql" > "$workspace/after.json"
diff -u "$workspace/before.json" "$workspace/after.json"

"${psql_cmd[@]}" < "$repo_root/tests/ideation-stage2-fixtures.sql"
"${psql_cmd[@]}" < "$repo_root/tests/ideation-stage2-integration.sql"
"${psql_cmd[@]}" < "$repo_root/tests/ideation-stage2-adversarial.sql"
IDEATION_TEST_DB_CONTAINER="$container" IDEATION_TEST_DB_NAME="$database" \
  IDEATION_TEST_DB_USER="$database_user" \
  bash "$repo_root/tests/ideation-stage2-concurrency.sh"

echo "Authoritative Stage 2 schema, migration, SQL, RLS, adversarial, and concurrency validation passed."
