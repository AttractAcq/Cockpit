#!/usr/bin/env bash
# Ideation Stage 3 — proposal lease concurrency and edit-revision safety.
set -euo pipefail

container="${IDEATION_TEST_DB_CONTAINER:-aa-ideation-stage3-db}"
database="${IDEATION_TEST_DB_NAME:-ideation_test}"
database_user="${IDEATION_TEST_DB_USER:-postgres}"
psql_cmd=(docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" -Atq)

client="aa111111-1111-4111-8111-111111111111"
cycle="aa333333-3333-4333-8333-333333333333"
scoring="aa444444-4444-4444-8444-444444444444"
actor="aa222222-2222-4222-8222-222222222222"

manifest="(select jsonb_agg(jsonb_build_object(
  'proposal_slot_key', d.day || ':' || t.asset || ':1',
  'proposed_date', d.day, 'date_slot_ordinal', 1,
  'required_asset_type', t.asset,
  'calendar_row_type', case t.asset when 'reel' then 'reel' else 'stories' end,
  'placement_basis', 'execution_cadence',
  'conflict_status', 'clear', 'conflict_details', '{}'::jsonb) order by d.day, t.asset)
  from (values ('2026-07-01'::text),('2026-07-02'),('2026-07-04'),('2026-07-06')) as d(day)
  cross join (values ('reel'::text),('story')) as t(asset))"
snapshot="(select candidate_snapshot from public.client_ideation_scoring_runs where id = '${scoring}')"

begin_proposal() {
  local owner="$1" key="$2"
  "${psql_cmd[@]}" <<SQL
select public.begin_ideation_calendar_proposal(
  '${client}', '${cycle}', '${scoring}', '${key}', repeat('6', 64),
  '{}'::jsonb, '{}'::jsonb, ${snapshot}, '{}'::jsonb, ${manifest}, '{}'::jsonb,
  repeat('7', 64), 'aa.ideation.slot-planner.v1', repeat('8', 64),
  'anthropic', 'zz-model', 'aa.ideation.proposal-output.v1', 'ideation-proposal.v1',
  '2026-07-01'::date, '2026-07-07'::date, 8, 3, null, '${owner}', 180, '${actor}'
)->>'created';
SQL
}

first=$(begin_proposal "zz3-conc-owner-1" "zz3-concurrency")
[[ "$first" == "true" ]] || { echo "FAIL: first worker did not create the proposal" >&2; exit 1; }

second=$(begin_proposal "zz3-conc-owner-2" "zz3-concurrency")
[[ "$second" == "false" ]] || { echo "FAIL: a second worker took a live lease" >&2; exit 1; }

proposal_id=$("${psql_cmd[@]}" -c "select id from public.client_ideation_calendar_proposals where idempotency_key = 'zz3-concurrency';")

"${psql_cmd[@]}" >/dev/null <<SQL
update public.client_ideation_calendar_proposals
set lease_expires_at = now() - interval '1 second' where id = '${proposal_id}';
SQL
reclaimed=$(begin_proposal "zz3-conc-owner-3" "zz3-concurrency")
[[ "$reclaimed" == "true" ]] || { echo "FAIL: an expired proposal was not reclaimable" >&2; exit 1; }

# The displaced owner can no longer act on the proposal.
for statement in \
  "select public.renew_ideation_proposal_lease('${proposal_id}', 'zz3-conc-owner-1', 180)" \
  "select public.persist_ideation_proposal_batch('${proposal_id}', 'zz3-conc-owner-1', '[]'::jsonb)" \
  "select public.complete_ideation_calendar_proposal('${proposal_id}', 'zz3-conc-owner-1', '[]'::jsonb, '${actor}')" \
  "select public.fail_ideation_calendar_proposal('${proposal_id}', 'zz3-conc-owner-1', 'X', 'x', false, '[]'::jsonb, '${actor}')"
do
  if "${psql_cmd[@]}" -c "$statement" >/dev/null 2>&1; then
    echo "FAIL: a stale worker executed: $statement" >&2
    exit 1
  fi
done

owner=$("${psql_cmd[@]}" -c "select lease_owner from public.client_ideation_calendar_proposals where id = '${proposal_id}';")
[[ "$owner" == "zz3-conc-owner-3" ]] || { echo "FAIL: unexpected lease owner $owner" >&2; exit 1; }

# Concurrent edits: only the caller holding the current revision wins.
draft_id=$("${psql_cmd[@]}" -c "select id from public.client_ideation_calendar_proposals where status = 'draft' limit 1;")
if [[ -n "$draft_id" ]]; then
  revision=$("${psql_cmd[@]}" -c "select edit_revision from public.client_ideation_calendar_proposals where id = '${draft_id}';")
  slot=$("${psql_cmd[@]}" -c "select proposal_slot_key from public.client_ideation_calendar_proposal_slots where proposal_id = '${draft_id}' and candidate_id is not null order by proposal_slot_key limit 1;")
  "${psql_cmd[@]}" >/dev/null -c "select public.edit_ideation_proposal_assignment('${draft_id}', '${client}', 'unassign', '${slot}', null, null, ${revision}, '${actor}');"
  if "${psql_cmd[@]}" -c "select public.edit_ideation_proposal_assignment('${draft_id}', '${client}', 'unassign', '${slot}', null, null, ${revision}, '${actor}');" >/dev/null 2>&1; then
    echo "FAIL: a stale edit revision was accepted" >&2
    exit 1
  fi
fi

echo "Stage 3 proposal concurrency passed."
