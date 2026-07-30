#!/usr/bin/env bash
# Exact-schema validation for the Ideation Stage 4 migration.
# Requires IDEATION_SCHEMA_BASELINE to point at an authorized, read-only,
# schema-only dump of the linked project. No data is exported or committed.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
baseline="${IDEATION_SCHEMA_BASELINE:-}"
image="${IDEATION_SCHEMA_POSTGRES_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.141}"
database="${IDEATION_TEST_DB_NAME:-ideation_test}"
database_user="${IDEATION_TEST_DB_USER:-supabase_admin}"
container="${IDEATION_TEST_DB_CONTAINER:-aa-ideation-stage4-schema-$RANDOM-$$}"
workspace="$(mktemp -d)"

cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$workspace"; }
trap cleanup EXIT

if [[ -z "$baseline" ]]; then
  echo "BLOCKED: set IDEATION_SCHEMA_BASELINE to an exact, authorized, read-only schema dump." >&2
  exit 2
fi
if [[ ! -f "$baseline" ]]; then echo "Schema baseline does not exist: $baseline" >&2; exit 2; fi
baseline="$(cd "$(dirname "$baseline")" && pwd)/$(basename "$baseline")"
if [[ "$baseline" == "$repo_root/tests/ideation-pr1-baseline.sql" ]]; then
  echo "The synthetic unit fixture is not an authoritative schema baseline." >&2; exit 2
fi

docker run -d --name "$container" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB="$database" "$image" >/dev/null
for _ in $(seq 1 90); do
  if docker exec "$container" psql -XAtq -U "$database_user" -d "$database" -c 'select 1' 2>/dev/null | grep -qx '1'; then break; fi
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

# Frozen-object snapshot before and after: Stage 4 must not drift the Calendar,
# the masters, Phase 1/2, Stage 1, Stage 2, Stage 3, playbooks, or the
# downstream production domains.
"${psql_cmd[@]}" < "$repo_root/tests/ideation-pr1-schema-snapshot.sql" > "$workspace/before.json"
"${psql_cmd[@]}" < "$repo_root/tests/ideation-stage4-frozen-snapshot.sql" > "$workspace/frozen-before.json"
"${psql_cmd[@]}" < "$repo_root/supabase/migrations/20260730000040_ideation_stage4_commit_content.sql"
"${psql_cmd[@]}" < "$repo_root/tests/ideation-stage4-schema-postflight.sql"
"${psql_cmd[@]}" < "$repo_root/tests/ideation-pr1-schema-snapshot.sql" > "$workspace/after.json"
"${psql_cmd[@]}" < "$repo_root/tests/ideation-stage4-frozen-snapshot.sql" > "$workspace/frozen-after.json"
diff -u "$workspace/before.json" "$workspace/after.json"
diff -u "$workspace/frozen-before.json" "$workspace/frozen-after.json"

# Stage 1, Stage 2, and Stage 3 SQL suites still pass on the same database.
"${psql_cmd[@]}" < "$repo_root/tests/ideation-stage3-fixtures.sql"
"${psql_cmd[@]}" < "$repo_root/tests/ideation-stage3-integration.sql"
"${psql_cmd[@]}" < "$repo_root/tests/ideation-stage3-adversarial.sql"

# Stage 4 integration + RLS on a clean fixture lineage.
"${psql_cmd[@]}" < "$repo_root/tests/ideation-stage4-fixtures.sql"
"${psql_cmd[@]}" < "$repo_root/tests/ideation-stage4-integration.sql"

# Adversarial and concurrency each need an uncommitted lineage, so both run on a
# freshly recreated database rather than after a successful commit.
reset_database() {
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" <<'SQL'
drop schema if exists auth cascade;
drop schema if exists public cascade;
SQL
  if pg_restore --list "$baseline" >/dev/null 2>&1; then
    docker exec "$container" pg_restore --exit-on-error --no-owner --no-privileges \
      -U "$database_user" -d "$database" /tmp/authoritative-schema.dump
  else
    docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" < "$baseline"
  fi
  "${psql_cmd[@]}" < "$repo_root/supabase/migrations/20260730000040_ideation_stage4_commit_content.sql" >/dev/null
  "${psql_cmd[@]}" < "$repo_root/tests/ideation-stage4-fixtures.sql" >/dev/null
}

reset_database
"${psql_cmd[@]}" < "$repo_root/tests/ideation-stage4-adversarial.sql"

reset_database
IDEATION_TEST_DB_CONTAINER="$container" IDEATION_TEST_DB_NAME="$database" \
  IDEATION_TEST_DB_USER="$database_user" \
  bash "$repo_root/tests/ideation-stage4-concurrency.sh"

echo "Authoritative Stage 4 schema, migration, SQL, RLS, adversarial, and concurrency validation passed."
