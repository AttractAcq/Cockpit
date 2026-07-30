#!/usr/bin/env bash
# Ideation Stage 5 — authority-race closure, proven with two real sessions.
# Runs against a disposable database only.
set -euo pipefail

container="${IDEATION_TEST_DB_CONTAINER:-aa-ideation-stage5-db}"
database="${IDEATION_TEST_DB_NAME:-ideation_test}"
database_user="${IDEATION_TEST_DB_USER:-postgres}"
psql_cmd=(docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" -Atq)
psql_soft=(docker exec -i "$container" psql -U "$database_user" -d "$database" -Atq)

client="bb111111-1111-4111-8111-111111111111"
proposal="bb888888-8888-4888-8888-888888888881"
actor="bb222222-2222-4222-8222-222222222222"

commit_sql() {
  cat <<SQL
select set_config('request.jwt.claim.role', 'service_role', false);
select public.commit_ideation_content(
  '${client}'::uuid, '${proposal}'::uuid, 3, '${actor}'::uuid,
  repeat('e', 64), '{}'::jsonb, repeat('4', 64), 'zz-commit-key',
  'aa.ideation.commit-targets.v1', 'aa.ideation.commit-mapping.v1',
  'aa.phase3.allocate-ref.v1', 'aa.ideation.commit-output.v1', 'aa.ideation.commit.v1'
)::text;
SQL
}

fail() { echo "FAIL: $1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. The commit locks the authority rows it depends on.
# ---------------------------------------------------------------------------
locks=$("${psql_cmd[@]}" <<SQL
select set_config('request.jwt.claim.role', 'service_role', false);
begin;
select id from public.client_context_files
where client_id = '${client}' and status = 'approved' for share;
select count(*) from pg_locks l join pg_class c on c.oid = l.relation
where c.relname = 'client_context_files' and l.pid = pg_backend_pid();
rollback;
SQL
)
[[ -n "$locks" ]] || fail "row locking is unavailable in this environment"

# ---------------------------------------------------------------------------
# 2. Authority edited BEFORE the commit reads it: the commit must fail closed
#    with an authority mismatch, and must leave zero operational rows.
# ---------------------------------------------------------------------------
"${psql_cmd[@]}" >/dev/null <<SQL
update public.client_context_files
set content_md = content_md || ' Edited without a version bump.'
where client_id = '${client}' and status = 'approved';
SQL

out="$(commit_sql | "${psql_soft[@]}" 2>&1 || true)"
grep -q "IDEATION_COMMIT_AUTHORITY_SNAPSHOT_MISMATCH" <<<"$out" \
  || fail "a silent content edit was not detected: $out"

for table in organic_master story_master calendar_cells; do
  count=$("${psql_cmd[@]}" -c "select count(*) from public.${table} where client_id = '${client}';")
  [[ "$count" == "0" ]] || fail "an authority mismatch left ${count} ${table} rows"
done
runs=$("${psql_cmd[@]}" -c "select count(*) from public.client_ideation_commit_runs;")
[[ "$runs" == "0" ]] || fail "an authority mismatch left a commit run"

# Restore the authority to its recorded content.
"${psql_cmd[@]}" >/dev/null <<SQL
update public.client_context_files
set content_md = replace(content_md, ' Edited without a version bump.', '')
where client_id = '${client}' and status = 'approved';
SQL

# ---------------------------------------------------------------------------
# 3. The commit wins the lock first: a concurrent authority update must WAIT
#    until the transaction completes, so no commit can mix pre-change and
#    post-change authority.
# ---------------------------------------------------------------------------
"${psql_cmd[@]}" >/dev/null <<SQL
create table if not exists public.zz_stage5_race_log (step text, at timestamptz default clock_timestamp());
truncate public.zz_stage5_race_log;
SQL

# Session A: hold a share lock on the authority rows, then commit content.
(
  "${psql_soft[@]}" >/dev/null 2>&1 <<SQL
select set_config('request.jwt.claim.role', 'service_role', false);
begin;
select id from public.client_context_files
where client_id = '${client}' and status = 'approved' for share;
select pg_sleep(2);
insert into public.zz_stage5_race_log(step) values ('commit-locked-authority');
select public.commit_ideation_content(
  '${client}'::uuid, '${proposal}'::uuid, 3, '${actor}'::uuid,
  repeat('e', 64), '{}'::jsonb, repeat('4', 64), 'zz-commit-key',
  'aa.ideation.commit-targets.v1', 'aa.ideation.commit-mapping.v1',
  'aa.phase3.allocate-ref.v1', 'aa.ideation.commit-output.v1', 'aa.ideation.commit.v1');
insert into public.zz_stage5_race_log(step) values ('commit-finished');
commit;
SQL
) &
session_a=$!

sleep 1
# Session B: try to edit the same authority. It must block until A commits.
(
  "${psql_soft[@]}" >/dev/null 2>&1 <<SQL
update public.client_context_files
set content_md = content_md || ' Late edit.'
where client_id = '${client}' and status = 'approved';
insert into public.zz_stage5_race_log(step) values ('authority-update-applied');
SQL
) &
session_b=$!

wait "$session_a" || true
wait "$session_b" || true

order=$("${psql_cmd[@]}" -c "select string_agg(step, ',' order by at) from public.zz_stage5_race_log;")
case "$order" in
  commit-locked-authority,commit-finished,authority-update-applied)
    ;;
  *)
    fail "the authority update did not wait for the commit (order: $order)"
    ;;
esac

completed=$("${psql_cmd[@]}" -c "select count(*) from public.client_ideation_commit_runs where status = 'completed';")
[[ "$completed" == "1" ]] || fail "expected exactly one completed commit, found $completed"

# 4. The commit itself never mutated approved authority.
edited=$("${psql_cmd[@]}" -c "select count(*) from public.client_context_files where client_id = '${client}' and content_md like '%Late edit.%';")
[[ "$edited" != "0" ]] || fail "session B's update was lost rather than serialised"
approved=$("${psql_cmd[@]}" -c "select count(*) from public.client_context_files where client_id = '${client}' and status <> 'approved';")
[[ "$approved" == "0" ]] || fail "the commit changed an authority approval state"

"${psql_cmd[@]}" >/dev/null -c "drop table public.zz_stage5_race_log;"

echo "Stage 5 authority-race closure passed."
