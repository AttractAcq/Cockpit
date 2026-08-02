#!/usr/bin/env bash
set -euo pipefail

readonly PRODUCTION_REF="xivewedajschthjlblfb"
readonly REQUIRED_CONFIRMATION="reset-local-cockpit-disposable"
readonly EXPECTED_CONTAINER="supabase_db_cockpit"
readonly CUTOFF_VERSION="20260801000000"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

fail() {
  printf 'Stage A bootstrap refused: %s\n' "$1" >&2
  exit 1
}

record_component() {
  local name="$1"
  local status="$2"
  local command="$3"
  shift 3
  printf 'STAGE_A_COMPONENT_EXIT|%s|%s|%s\n' "$name" "$status" "$command"
  local input_path
  local input_sha
  for input_path in "$@"; do
    [[ -f "$input_path" ]] || fail "component $name references missing bound input $input_path"
    input_sha="$(shasum -a 256 "$input_path" | awk '{print $1}')"
    printf 'STAGE_A_COMPONENT_INPUT|%s|%s|%s\n' "$name" "$input_path" "$input_sha"
  done
}

run_sql_component() {
  local name="$1"
  local sql_file="$2"
  local status
  set +e
  docker exec -i "$EXPECTED_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$sql_file"
  status=$?
  set -e
  record_component "$name" "$status" "docker exec -i $EXPECTED_CONTAINER psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < $sql_file" "$sql_file"
  [[ "$status" -eq 0 ]] || exit "$status"
}

if [[ $# -ne 0 ]]; then
  fail "target arguments are not accepted; this command supports only the fixed local Supabase stack"
fi

if [[ "${STAGE_A_DISPOSABLE_CONFIRM:-}" != "$REQUIRED_CONFIRMATION" ]]; then
  fail "set STAGE_A_DISPOSABLE_CONFIRM=$REQUIRED_CONFIRMATION to confirm destructive local reset"
fi

for candidate in "${SUPABASE_PROJECT_REF:-}" "${PROJECT_REF:-}" "${STAGE_A_PROJECT_REF:-}"; do
  [[ "$candidate" != "$PRODUCTION_REF" ]] || fail "the production project ref is prohibited"
done

if [[ -f "$REPO_ROOT/supabase/.temp/project-ref" ]]; then
  linked_ref="$(tr -d '[:space:]' < "$REPO_ROOT/supabase/.temp/project-ref")"
  [[ "$linked_ref" != "$PRODUCTION_REF" ]] || fail "the worktree is linked to production"
fi

[[ -n "${STAGE_A_EXPECTED_DATABASE_BINDING_SHA256:-}" ]] \
  || fail "the pre-execution database source binding is required"
[[ -n "${STAGE_A_EXPECTED_POST_CUTOVER_MIGRATIONS+x}" ]] \
  || fail "the bound post-cutover migration list is required"

[[ "$(awk -F'"' '/^project_id = / {print $2; exit}' "$REPO_ROOT/supabase/config.toml")" == "cockpit" ]] \
  || fail "supabase/config.toml does not identify the cockpit local stack"

command -v docker >/dev/null 2>&1 || fail "Docker is required"
docker inspect "$EXPECTED_CONTAINER" >/dev/null 2>&1 || fail "local container $EXPECTED_CONTAINER is not available; run supabase start locally"
[[ "$(docker inspect --format '{{.State.Running}}' "$EXPECTED_CONTAINER")" == "true" ]] || fail "local database container is not running"
[[ "$(docker inspect --format '{{.Name}}' "$EXPECTED_CONTAINER")" == "/$EXPECTED_CONTAINER" ]] || fail "unexpected database container identity"

container_environment="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$EXPECTED_CONTAINER")"
[[ "$container_environment" != *"$PRODUCTION_REF"* ]] || fail "production project ref detected in local container configuration"
unset container_environment

db_identity="$(docker exec "$EXPECTED_CONTAINER" psql -X -U postgres -d postgres -Atqc "select current_database() || '|' || current_user")"
[[ "$db_identity" == "postgres|postgres" ]] || fail "target is not the expected disposable local postgres database"
unset db_identity

cd "$REPO_ROOT"

actual_binding_sha="$(node --input-type=module -e "import { readDatabaseSourceBinding } from './scripts/stage-a-database-source-binding.mjs'; console.log(readDatabaseSourceBinding(process.cwd()).sha256)")"
[[ "$actual_binding_sha" == "$STAGE_A_EXPECTED_DATABASE_BINDING_SHA256" ]] \
  || fail "database source binding changed before bootstrap execution"
unset actual_binding_sha

actual_post_cutover_migrations="$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' -print | sort | while IFS= read -r migration; do
  filename="$(basename "$migration")"
  version="${filename:0:14}"
  [[ "$version" =~ ^[0-9]{14}$ ]] || fail "invalid active migration filename: $filename"
  if [[ "$version" > "$CUTOFF_VERSION" ]]; then printf '%s\n' "$migration"; fi
done)"
[[ "$actual_post_cutover_migrations" == "$STAGE_A_EXPECTED_POST_CUTOVER_MIGRATIONS" ]] \
  || fail "applicable post-cutover migration set differs from the pre-execution binding"
unset actual_post_cutover_migrations

printf 'Resetting only the public application schema and the two application storage buckets in %s.\n' "$EXPECTED_CONTAINER"
docker exec -i "$EXPECTED_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null <<'SQL'
set client_min_messages = warning;
drop policy if exists client_assets_storage_staff_select on storage.objects;
drop policy if exists client_assets_storage_staff_insert on storage.objects;
drop policy if exists client_assets_storage_staff_update on storage.objects;
drop policy if exists client_assets_storage_staff_delete on storage.objects;
drop policy if exists video_assets_storage_staff_select on storage.objects;
drop policy if exists video_assets_storage_staff_insert on storage.objects;
drop policy if exists video_assets_storage_staff_update on storage.objects;
drop policy if exists video_assets_storage_staff_delete on storage.objects;
do $$
begin
  if exists (select 1 from storage.objects where bucket_id in ('client-assets','video-assets'))
     or exists (select 1 from storage.buckets where id in ('client-assets','video-assets')) then
    raise exception 'application storage state is not empty; recreate the disposable local stack instead of deleting Storage rows directly';
  end if;
end
$$;
drop schema if exists public cascade;
create schema public authorization pg_database_owner;
comment on schema public is 'standard public schema';
SQL

empty_count="$(docker exec "$EXPECTED_CONTAINER" psql -X -U postgres -d postgres -Atqc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m','S')")"
empty_status=0
[[ "$empty_count" == "0" ]] || empty_status=1
record_component "empty_application_schema" "$empty_status" "docker exec supabase_db_cockpit psql -X -U postgres -d postgres -Atqc select-count-of-public-relations-and-require-exactly-0" "scripts/bootstrap-disposable-supabase.sh"
[[ "$empty_status" -eq 0 ]] || fail "public schema was not empty before baseline application"

run_sql_component "executable_application_schema" "supabase/baseline/application-schema.sql"
run_sql_component "bootstrap_data" "supabase/baseline/bootstrap-data.sql"

post_cutover_count=0
post_cutover_command="no SQL command executed; exact bound applicable post-cutover migration set is empty"
while IFS= read -r migration; do
  [[ -n "$migration" ]] || continue
  filename="$(basename "$migration")"
  version="${filename:0:14}"
  [[ "$version" =~ ^[0-9]{14}$ ]] || fail "invalid active migration filename: $filename"
  [[ "$version" > "$CUTOFF_VERSION" ]] || fail "bound migration is not post-cutover: $filename"
  if [[ "$post_cutover_count" -eq 0 ]]; then post_cutover_command=""; fi
  post_cutover_command+="docker exec -i $EXPECTED_CONTAINER psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < $migration;"
  printf 'Applying post-cutover migration %s.\n' "$filename"
  docker exec -i "$EXPECTED_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$migration" >/dev/null
  post_cutover_count=$((post_cutover_count + 1))
done <<< "$STAGE_A_EXPECTED_POST_CUTOVER_MIGRATIONS"

post_cutover_status=0
post_cutover_inputs=("scripts/bootstrap-disposable-supabase.sh")
while IFS= read -r migration; do
  [[ -n "$migration" ]] && post_cutover_inputs+=("$migration")
done <<< "$STAGE_A_EXPECTED_POST_CUTOVER_MIGRATIONS"
expected_post_cutover_count=$((${#post_cutover_inputs[@]} - 1))
[[ "$post_cutover_count" == "$expected_post_cutover_count" ]] || post_cutover_status=1
record_component "post_cutover_migrations" "$post_cutover_status" "$post_cutover_command" "${post_cutover_inputs[@]}"
[[ "$post_cutover_status" -eq 0 ]] || fail "executed post-cutover migration count differs from the bound set"

record_component "baseline_reconstruction" "0" "reset public schema; apply supabase/baseline/application-schema.sql; apply supabase/baseline/bootstrap-data.sql; apply active migrations newer than 20260801000000" \
  "scripts/bootstrap-disposable-supabase.sh" \
  "supabase/baseline/application-schema.sql" \
  "supabase/baseline/bootstrap-data.sql" \
  "${post_cutover_inputs[@]:1}"

printf 'Verifying the recorded identifier catalogue/counts, RLS flags/policy count, representative grants, storage, seeds, and held-object absence.\n'
run_sql_component "baseline_catalogue" "supabase/baseline/verify-baseline.sql"
run_sql_component "rls" "supabase/baseline/verify-rls.sql"
run_sql_component "grants" "supabase/baseline/verify-grants.sql"
run_sql_component "storage" "supabase/baseline/verify-storage.sql"
run_sql_component "seeds" "supabase/baseline/verify-seeds.sql"
printf 'Verifying transactional symmetric two-client RLS isolation (all synthetic rows roll back).\n'
run_sql_component "symmetric_isolation" "supabase/baseline/verify-isolation.sql"
printf 'Verifying representative constraint behavior (all synthetic rows roll back).\n'
run_sql_component "constraints" "supabase/baseline/verify-constraints.sql"
printf 'Verifying representative foreign-key behavior (all synthetic rows roll back).\n'
run_sql_component "foreign_keys" "supabase/baseline/verify-foreign-keys.sql"
printf 'Verifying representative global and client-scoped uniqueness (all synthetic rows roll back).\n'
run_sql_component "uniqueness" "supabase/baseline/verify-uniqueness.sql"
printf 'Verifying the begin_ideation_run database idempotency contract (all synthetic rows roll back).\n'
run_sql_component "database_idempotency" "supabase/baseline/verify-idempotency.sql"

catalog_file="$(mktemp "${TMPDIR:-/tmp}/cockpit-stage-a-catalog.XXXXXX")"
trap 'rm -f "$catalog_file"' EXIT
docker exec -i "$EXPECTED_CONTAINER" psql -X -U postgres -d postgres -AtF '|' <<'SQL' > "$catalog_file"
select 'table'::text, c.relname::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
union all select 'column', c.relname || '.' || a.attname from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped
union all select 'constraint', c.relname || '.' || con.conname from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
union all select 'enum', t.typname from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e'
union all select 'enum_value', t.typname || '.' || row_number() over (partition by t.oid order by e.enumsortorder)::text || '.' || e.enumlabel from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid where n.nspname='public'
union all select 'function', p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
union all select 'view', c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v'
union all select 'trigger', c.relname || '.' || t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal
union all select 'policy', tablename || '.' || policyname from pg_policies where schemaname='public'
union all select 'index', indexname from pg_indexes where schemaname='public'
union all select 'rls', c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity
union all select 'storage_bucket', id from storage.buckets where id in ('client-assets','video-assets')
union all select 'storage_policy', policyname from pg_policies where schemaname='storage' and tablename='objects' and (policyname like 'client_assets_storage_staff_%' or policyname like 'video_assets_storage_staff_%')
union all select 'seed', block_type || '.' || version::text from public.brand_prompt_blocks where (block_type,version) in (('brand_dna',1),('brand_sting',1));
SQL

printf 'Comparing rebuilt catalogue with the deterministic Route B manifest.\n'
set +e
node scripts/compare-stage-a-schema.mjs --catalog "$catalog_file"
compare_status=$?
set -e
record_component "catalogue_comparison" "$compare_status" "node scripts/compare-stage-a-schema.mjs --catalog [sanitized-temporary-catalogue]" \
  "scripts/bootstrap-disposable-supabase.sh" \
  "scripts/compare-stage-a-schema.mjs" \
  "supabase/baseline/manifest.json"
[[ "$compare_status" -eq 0 ]] || exit "$compare_status"
printf 'Stage A disposable bootstrap passed: empty public schema, baseline, %s post-cutover migration(s), catalogue, grants, RLS, storage, seeds, symmetric isolation, constraints, foreign keys, uniqueness, and database idempotency verified.\n' "$post_cutover_count"
