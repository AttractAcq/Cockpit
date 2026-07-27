#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
baseline="${IDEATION_SCHEMA_BASELINE:-}"
image="${IDEATION_SCHEMA_POSTGRES_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.141}"
database="${IDEATION_TEST_DB_NAME:-ideation_test}"
database_user="${IDEATION_TEST_DB_USER:-supabase_admin}"
container="${IDEATION_TEST_DB_CONTAINER:-aa-ideation-schema-$RANDOM-$$}"
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
synthetic="$repo_root/tests/ideation-pr1-baseline.sql"
if [[ "$baseline" == "$synthetic" ]]; then
  echo "The synthetic unit fixture is not an authoritative schema baseline." >&2
  exit 2
fi

docker run -d --name "$container" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB="$database" \
  "$image" >/dev/null

for _ in $(seq 1 90); do
  if docker exec "$container" psql -XAtq \
    -U "$database_user" -d "$database" -c 'select 1' 2>/dev/null |
      grep -qx '1'; then
    break
  fi
  sleep 1
done

# The image may accept a query immediately before its one-time bootstrap
# restart. Require a second successful query after that restart window.
sleep 2
docker exec "$container" psql -XAtq \
  -U "$database_user" -d "$database" -c 'select 1' |
  grep -qx '1'

# The Supabase Postgres image bootstraps platform schemas. Recreate only the
# disposable auth/public schemas so CREATE TABLE IF NOT EXISTS statements in an
# exact Supabase CLI dump cannot merge with the image's bundled schema version.
# Roles and extension-owned objects remain supplied by the compatible image.
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" <<'SQL'
drop schema if exists auth cascade;
drop schema if exists public cascade;
SQL

if pg_restore --list "$baseline" >/dev/null 2>&1; then
  docker cp "$baseline" "$container:/tmp/authoritative-schema.dump"
  docker exec "$container" pg_restore \
    --exit-on-error --no-owner --no-privileges \
    -U "$database_user" -d "$database" /tmp/authoritative-schema.dump
else
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" < "$baseline"
fi

psql_cmd=(docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database")
"${psql_cmd[@]}" < "$repo_root/tests/ideation-pr1-schema-preflight.sql"
"${psql_cmd[@]}" < "$repo_root/tests/ideation-pr1-schema-snapshot.sql" > "$workspace/before.json"
"${psql_cmd[@]}" < "$repo_root/supabase/migrations/20260725000032_ideation_pr1_foundations.sql"
"${psql_cmd[@]}" < "$repo_root/tests/ideation-pr1-schema-postflight.sql"
"${psql_cmd[@]}" < "$repo_root/tests/ideation-pr1-schema-snapshot.sql" > "$workspace/after.json"
diff -u "$workspace/before.json" "$workspace/after.json"

if [[ -n "${IDEATION_SCHEMA_TEST_SEED:-}" ]]; then
  if [[ ! -f "$IDEATION_SCHEMA_TEST_SEED" ]]; then
    echo "IDEATION_SCHEMA_TEST_SEED does not exist: $IDEATION_SCHEMA_TEST_SEED" >&2
    exit 2
  fi
  "${psql_cmd[@]}" < "$IDEATION_SCHEMA_TEST_SEED"
fi

"${psql_cmd[@]}" < "$repo_root/tests/ideation-pr1-integration.sql"
"${psql_cmd[@]}" < "$repo_root/tests/ideation-pr1-adversarial.sql"
IDEATION_TEST_DB_CONTAINER="$container" IDEATION_TEST_DB_NAME="$database" \
  IDEATION_TEST_DB_USER="$database_user" \
  bash "$repo_root/tests/ideation-pr1-concurrency.sh"

echo "Authoritative Ideation schema, migration, SQL, RLS, adversarial, and concurrency validation passed."
