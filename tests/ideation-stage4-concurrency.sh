#!/usr/bin/env bash
# Ideation Stage 4 — real two-worker commit concurrency and reference-allocation
# collision safety. Runs against a disposable database only.
set -euo pipefail

container="${IDEATION_TEST_DB_CONTAINER:-aa-ideation-stage4-db}"
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

# ---------------------------------------------------------------------------
# Two simultaneous commits of the same proposal.
# ---------------------------------------------------------------------------
out_a="$(mktemp)"; out_b="$(mktemp)"
trap 'rm -f "$out_a" "$out_b"' EXIT

commit_sql | "${psql_soft[@]}" > "$out_a" 2>&1 &
pid_a=$!
commit_sql | "${psql_soft[@]}" > "$out_b" 2>&1 &
pid_b=$!
wait "$pid_a" || true
wait "$pid_b" || true

completed=$("${psql_cmd[@]}" -c "select count(*) from public.client_ideation_commit_runs where proposal_id = '${proposal}' and status = 'completed';")
[[ "$completed" == "1" ]] || { echo "FAIL: expected exactly 1 completed commit, found $completed" >&2; cat "$out_a" "$out_b" >&2; exit 1; }

items=$("${psql_cmd[@]}" -c "select count(*) from public.client_ideation_commit_items;")
[[ "$items" == "4" ]] || { echo "FAIL: expected 4 commit items, found $items" >&2; exit 1; }

organic=$("${psql_cmd[@]}" -c "select count(*) from public.organic_master where client_id = '${client}';")
story=$("${psql_cmd[@]}" -c "select count(*) from public.story_master where client_id = '${client}';")
cells=$("${psql_cmd[@]}" -c "select count(*) from public.calendar_cells where client_id = '${client}';")
[[ "$organic" == "3" ]] || { echo "FAIL: duplicate organic rows under concurrency ($organic)" >&2; exit 1; }
[[ "$story" == "1" ]] || { echo "FAIL: duplicate story rows under concurrency ($story)" >&2; exit 1; }
[[ "$cells" == "4" ]] || { echo "FAIL: duplicate Calendar rows under concurrency ($cells)" >&2; exit 1; }

# The losing worker either replayed the completed run or was refused; either way
# it must not have produced a second run or any extra content.
runs=$("${psql_cmd[@]}" -c "select count(*) from public.client_ideation_commit_runs where proposal_id = '${proposal}';")
[[ "$runs" == "1" ]] || { echo "FAIL: expected 1 commit run total, found $runs" >&2; exit 1; }

# A third, fully sequential request replays rather than duplicating.
replay=$(commit_sql | "${psql_cmd[@]}" | tail -1)
grep -q '"replayed" : true' <<<"$replay" || grep -q '"replayed": true' <<<"$replay" \
  || { echo "FAIL: the sequential replay was not flagged: $replay" >&2; exit 1; }
items_after=$("${psql_cmd[@]}" -c "select count(*) from public.client_ideation_commit_items;")
[[ "$items_after" == "4" ]] || { echo "FAIL: the replay created items ($items_after)" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Reference-allocation collision safety.
#
# The allocator dedupes against real master rows, so the probe must take the
# real path: allocate AND insert into organic_master inside one transaction,
# exactly as Stage 4's commit and a concurrent Phase 3 run both do. The advisory
# transaction lock must serialise them so no two workers claim the same ref.
# ---------------------------------------------------------------------------
probe_date="2026-08-11"
for _ in 1 2 3 4 5 6; do
  "${psql_cmd[@]}" >/dev/null 2>&1 <<SQL &
begin;
insert into public.organic_master (client_id, month, ref, review_state, status, content_type, working_title)
values ('${client}'::uuid, '2026-08',
        public.allocate_phase3_ref('${client}'::uuid, '${probe_date}'::date, 'RL'),
        'needs_review', 'idea', 'RL', 'ZZ concurrency probe');
-- Held briefly so the allocations genuinely overlap.
select pg_sleep(0.2);
commit;
SQL
done
wait

allocated=$("${psql_cmd[@]}" -c "select count(*) from public.organic_master where working_title = 'ZZ concurrency probe';")
distinct=$("${psql_cmd[@]}" -c "select count(distinct ref) from public.organic_master where working_title = 'ZZ concurrency probe';")
[[ "$allocated" == "$distinct" ]] || { echo "FAIL: concurrent allocation produced duplicate refs ($allocated vs $distinct)" >&2; exit 1; }
[[ "$allocated" == "6" ]] || { echo "FAIL: expected 6 concurrent allocations, got $allocated" >&2; exit 1; }

badformat=$("${psql_cmd[@]}" -c "select count(*) from public.organic_master where working_title = 'ZZ concurrency probe' and ref !~ '^[A-Z]{3}[0-9]{2}-RL-[0-9]{3}\$';")
[[ "$badformat" == "0" ]] || { echo "FAIL: a concurrently allocated ref was not canonical" >&2; exit 1; }

# The sequence advanced monotonically rather than repeating.
sequences=$("${psql_cmd[@]}" -c "select count(distinct split_part(ref, '-', 3)) from public.organic_master where working_title = 'ZZ concurrency probe';")
[[ "$sequences" == "6" ]] || { echo "FAIL: concurrent allocation reused a sequence number ($sequences distinct)" >&2; exit 1; }

"${psql_cmd[@]}" >/dev/null -c "delete from public.organic_master where working_title = 'ZZ concurrency probe';"

echo "Stage 4 commit concurrency and reference-allocation safety passed."
