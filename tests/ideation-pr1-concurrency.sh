#!/usr/bin/env bash
set -euo pipefail

container="${IDEATION_TEST_DB_CONTAINER:-aa-ideation-remediation-db}"
database="${IDEATION_TEST_DB_NAME:-ideation_test}"
database_user="${IDEATION_TEST_DB_USER:-postgres}"
psql_cmd=(docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" -Atq)

begin_sql() {
  local owner="$1"
  "${psql_cmd[@]}" <<SQL
select public.begin_ideation_run(
  source.client_id, source.period_type, source.period_start, source.period_end,
  source.execution_months, 'concurrency-final-attempt', repeat('8',64),
  source.quantity_plan, source.configuration_snapshot,
  source.configuration_snapshot->'technique_manifest', source.slot_allocation,
  '$owner', 180, '20000000-0000-0000-0000-000000000001'
)
from public.client_ideation_cycles source
where source.idempotency_key = 'integration-key';
SQL
}

begin_sql "concurrency-owner-1" >/dev/null
for attempt in 2 3; do
  "${psql_cmd[@]}" <<'SQL' >/dev/null
update public.client_ideation_cycles
set lease_expires_at = now() - interval '1 second'
where idempotency_key = 'concurrency-final-attempt';
SQL
  begin_sql "concurrency-owner-$attempt" >/dev/null
done

"${psql_cmd[@]}" <<'SQL' >/dev/null
update public.client_ideation_cycles
set lease_expires_at = now() - interval '1 second'
where idempotency_key = 'concurrency-final-attempt';
SQL

begin_sql "concurrency-final-a" >/tmp/aa-ideation-concurrency-a.out &
pid_a=$!
begin_sql "concurrency-final-b" >/tmp/aa-ideation-concurrency-b.out &
pid_b=$!
wait "$pid_a"
wait "$pid_b"

"${psql_cmd[@]}" <<'SQL'
do $$
declare
  v_cycle public.client_ideation_cycles%rowtype;
  v_events integer;
begin
  select * into v_cycle
  from public.client_ideation_cycles
  where idempotency_key = 'concurrency-final-attempt';
  if v_cycle.status <> 'failed'
    or v_cycle.attempt_count <> 3
    or v_cycle.lease_owner is not null
    or v_cycle.error_code <> 'IDEATION_ATTEMPTS_EXHAUSTED' then
    raise exception 'concurrent final reclaim violated terminal attempt cap';
  end if;
  select count(*) into v_events
  from public.activity_log
  where object_id = v_cycle.id::text
    and event_type = 'ideation_run_attempts_exhausted';
  if v_events <> 1 then
    raise exception 'expected exactly one attempts-exhausted transition, got %', v_events;
  end if;
end
$$;
SQL
