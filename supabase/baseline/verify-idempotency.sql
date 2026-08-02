-- Behavioral evidence for the repository's actual begin_ideation_run RPC.
-- Proves create, exact replay, stable result identity, and conflicting reuse.

begin;

insert into auth.users
  (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('00000000-0000-0000-0000-000000000000','a5000000-0000-0000-0000-000000000001','authenticated','authenticated','stage-a-idempotency@example.invalid','',now(),'{}','{}',now(),now());

insert into public.users (id,email,role)
values ('a5000000-0000-0000-0000-000000000001','stage-a-idempotency@example.invalid','account_manager');

insert into public.clients (id,name,slug,stage1_status,stage2_status)
values ('c5000000-0000-0000-0000-000000000001','Idempotency Client','stage-a-idempotency-client','complete','complete');

insert into public.team_members (user_id,client_id)
values ('a5000000-0000-0000-0000-000000000001','c5000000-0000-0000-0000-000000000001');

do $$
declare
  techniques jsonb := '[
    {"slug":"persona","name":"Persona","version":2,"order":1,"prompt_template":"persona","output_schema_version":"reference.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}},
    {"slug":"review-mined-pain-language","name":"Review-Mined Pain Language","version":2,"order":2,"prompt_template":"pain","output_schema_version":"candidates.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}},
    {"slug":"competitor-objections","name":"Competitor Objections","version":2,"order":3,"prompt_template":"competitor","output_schema_version":"candidates.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}},
    {"slug":"end-customer-complaints","name":"End-Customer Complaints","version":2,"order":4,"prompt_template":"complaints","output_schema_version":"candidates.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}},
    {"slug":"live-objection-log","name":"Live Objection Log","version":1,"order":5,"prompt_template":"no source","output_schema_version":"no-source.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}},
    {"slug":"trigger-event","name":"Trigger Event","version":1,"order":6,"prompt_template":"inactive","output_schema_version":"inactive.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}},
    {"slug":"format-swipe","name":"Format Swipe","version":1,"order":7,"prompt_template":"format","output_schema_version":"reference.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}}
  ]'::jsonb;
  slots jsonb := '{"persona":[],"review-mined-pain-language":["reel"],"competitor-objections":[],"end-customer-complaints":[],"live-objection-log":[],"trigger-event":[],"format-swipe":[]}'::jsonb;
  configuration jsonb;
  first_result jsonb;
  replay_result jsonb;
  first_cycle_id uuid;
  cycle_count integer;
  technique_count integer;
  activity_count integer;
begin
  configuration := jsonb_build_object(
    'authority', '{}'::jsonb,
    'technique_manifest', techniques,
    'retry_policy', jsonb_build_object('max_attempts', 3)
  );

  first_result := public.begin_ideation_run(
    'c5000000-0000-0000-0000-000000000001', 'one_day', '2026-08-02', '2026-08-02', array['2026-08'],
    'stage-a-database-idempotency', repeat('a',64), '{"total":1}'::jsonb, configuration,
    techniques, slots, 'stage-a-owner-one', 180, 'a5000000-0000-0000-0000-000000000001'
  );
  if (first_result->>'created')::boolean is not true then
    raise exception 'first begin_ideation_run request did not create a cycle';
  end if;
  first_cycle_id := (first_result->'cycle'->>'id')::uuid;
  select count(*) into cycle_count from public.client_ideation_cycles where client_id = 'c5000000-0000-0000-0000-000000000001';
  select count(*) into technique_count from public.client_ideation_technique_runs where ideation_cycle_id = first_cycle_id;
  select count(*) into activity_count from public.activity_log where object_id = first_cycle_id::text and event_type = 'ideation_run_started';
  if cycle_count <> 1 or technique_count <> 7 or activity_count <> 1 then
    raise exception 'first request created cycles %, technique runs %, activity rows %; expected 1, 7, 1', cycle_count, technique_count, activity_count;
  end if;

  replay_result := public.begin_ideation_run(
    'c5000000-0000-0000-0000-000000000001', 'one_day', '2026-08-02', '2026-08-02', array['2026-08'],
    'stage-a-database-idempotency', repeat('a',64), '{"total":1}'::jsonb, configuration,
    techniques, slots, 'stage-a-owner-two', 180, 'a5000000-0000-0000-0000-000000000001'
  );
  if (replay_result->>'created')::boolean is not false then
    raise exception 'exact replay reported that it created a duplicate';
  end if;
  if (replay_result->'cycle'->>'id')::uuid <> first_cycle_id then
    raise exception 'exact replay resolved to a different cycle';
  end if;
  if replay_result->'cycle'->>'lease_owner' <> 'stage-a-owner-one' then
    raise exception 'exact active replay did not return the original committed lease result';
  end if;
  select count(*) into cycle_count from public.client_ideation_cycles where client_id = 'c5000000-0000-0000-0000-000000000001';
  select count(*) into technique_count from public.client_ideation_technique_runs where ideation_cycle_id = first_cycle_id;
  select count(*) into activity_count from public.activity_log where object_id = first_cycle_id::text and event_type = 'ideation_run_started';
  if cycle_count <> 1 or technique_count <> 7 or activity_count <> 1 then
    raise exception 'exact replay changed persisted counts to %, %, %', cycle_count, technique_count, activity_count;
  end if;

  begin
    perform public.begin_ideation_run(
      'c5000000-0000-0000-0000-000000000001', 'one_day', '2026-08-02', '2026-08-02', array['2026-08'],
      'stage-a-database-idempotency', repeat('b',64), '{"total":1}'::jsonb, configuration,
      techniques, slots, 'stage-a-owner-three', 180, 'a5000000-0000-0000-0000-000000000001'
    );
    raise exception 'conflicting idempotency identity reuse was accepted';
  exception when unique_violation then
    if sqlerrm <> 'IDEMPOTENCY_CONFLICT' then raise; end if;
  end;

  if (select count(*) from public.client_ideation_cycles where client_id = 'c5000000-0000-0000-0000-000000000001') <> 1
     or (select count(*) from public.client_ideation_technique_runs where ideation_cycle_id = first_cycle_id) <> 7 then
    raise exception 'conflicting reuse changed committed idempotency records';
  end if;
end
$$;

rollback;

\echo STAGE_A_CASE idempotency.begin_ideation_run_first_request_creates_one_cycle_seven_runs_one_event PASS
\echo STAGE_A_CASE idempotency.begin_ideation_run_exact_replay_creates_no_duplicates PASS
\echo STAGE_A_CASE idempotency.begin_ideation_run_exact_replay_returns_same_cycle_and_lease PASS
\echo STAGE_A_CASE idempotency.begin_ideation_run_conflicting_hash_reuse_fails_closed PASS
