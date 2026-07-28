#!/usr/bin/env bash
# Ideation Stage 2 — scoring lease concurrency.
# Only one worker may own a scoring run; a reclaimed run invalidates the
# previous owner, and a stale worker can neither persist nor complete.
set -euo pipefail

container="${IDEATION_TEST_DB_CONTAINER:-aa-ideation-remediation-db}"
database="${IDEATION_TEST_DB_NAME:-ideation_test}"
database_user="${IDEATION_TEST_DB_USER:-postgres}"
psql_cmd=(docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" -Atq)

client="11111111-1111-4111-8111-111111111111"
cycle="33333333-3333-4333-8333-333333333333"
actor="22222222-2222-4222-8222-222222222222"

snapshot_sql="select jsonb_agg(jsonb_build_object(
  'candidate_id', c.id, 'technique_slug', r.technique_slug,
  'candidate_index', c.candidate_index, 'asset_type', c.asset_type,
  'content_hash', repeat('1', 64), 'evidence_hash', repeat('2', 64)
) order by c.id)
from public.client_ideation_candidates c
join public.client_ideation_technique_runs r on r.id = c.technique_run_id
where c.ideation_cycle_id = '${cycle}'"

begin_run() {
  local owner="$1" key="$2"
  "${psql_cmd[@]}" <<SQL
select public.begin_ideation_scoring_run(
  '${client}', '${cycle}', '${key}', repeat('6', 64),
  '{}'::jsonb, '{}'::jsonb, (${snapshot_sql}),
  'aa.ideation.scoring', 'aa.ideation.scoring.v1', repeat('8', 64),
  'anthropic', 'zz-test-model', 'aa.ideation.scoring-output.v1', 'ideation-scoring.v1',
  7, 3, null, '${owner}', 180, '${actor}'
)->>'created';
SQL
}

# Worker 1 takes the run.
first=$(begin_run "zz-concurrency-owner-1" "zz-concurrency")
[[ "$first" == "true" ]] || { echo "FAIL: first worker did not create the run" >&2; exit 1; }

# Worker 2 is refused while the lease is live.
second=$(begin_run "zz-concurrency-owner-2" "zz-concurrency")
[[ "$second" == "false" ]] || { echo "FAIL: a second worker took a live lease" >&2; exit 1; }

run_id=$("${psql_cmd[@]}" <<SQL
select id from public.client_ideation_scoring_runs where idempotency_key = 'zz-concurrency';
SQL
)

# Expire the lease so the run becomes reclaimable, then reclaim it.
"${psql_cmd[@]}" >/dev/null <<SQL
update public.client_ideation_scoring_runs
set lease_expires_at = now() - interval '1 second'
where id = '${run_id}';
SQL
reclaimed=$(begin_run "zz-concurrency-owner-3" "zz-concurrency")
[[ "$reclaimed" == "true" ]] || { echo "FAIL: an expired run was not reclaimable" >&2; exit 1; }

# The displaced owner can no longer renew, persist, complete, or fail.
for statement in \
  "select public.renew_ideation_scoring_lease('${run_id}', 'zz-concurrency-owner-1', 180)" \
  "select public.persist_ideation_score_batch('${run_id}', 'zz-concurrency-owner-1', '[]'::jsonb)" \
  "select public.complete_ideation_scoring_run('${run_id}', 'zz-concurrency-owner-1', '[]'::jsonb, '[]'::jsonb, '${actor}')" \
  "select public.fail_ideation_scoring_run('${run_id}', 'zz-concurrency-owner-1', 'X', 'x', false, '[]'::jsonb, '${actor}')"
do
  if "${psql_cmd[@]}" -c "$statement" >/dev/null 2>&1; then
    echo "FAIL: a stale worker executed: $statement" >&2
    exit 1
  fi
done

# The current owner still holds the run.
owner=$("${psql_cmd[@]}" -c "select lease_owner from public.client_ideation_scoring_runs where id = '${run_id}';")
[[ "$owner" == "zz-concurrency-owner-3" ]] || { echo "FAIL: unexpected lease owner $owner" >&2; exit 1; }

echo "Stage 2 scoring concurrency passed."
