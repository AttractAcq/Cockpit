-- Adversarial allocation, retry-cap, ownership, and RLS checks.
-- Run after baseline + migration + ideation-pr1-integration.sql in one disposable DB.

create or replace function pg_temp.ideation_techniques() returns jsonb
language sql immutable
as $$
  select '[
    {"slug":"persona","name":"Persona","version":2,"order":1,"prompt_template":"persona","output_schema_version":"reference.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}},
    {"slug":"review-mined-pain-language","name":"Review-Mined Pain Language","version":2,"order":2,"prompt_template":"pain","output_schema_version":"candidates.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}},
    {"slug":"competitor-objections","name":"Competitor Objections","version":2,"order":3,"prompt_template":"competitor","output_schema_version":"candidates.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}},
    {"slug":"end-customer-complaints","name":"End-Customer Complaints","version":2,"order":4,"prompt_template":"complaints","output_schema_version":"candidates.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}},
    {"slug":"live-objection-log","name":"Live Objection Log","version":1,"order":5,"prompt_template":"no source","output_schema_version":"no-source.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}},
    {"slug":"trigger-event","name":"Trigger Event","version":1,"order":6,"prompt_template":"inactive","output_schema_version":"inactive.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}},
    {"slug":"format-swipe","name":"Format Swipe","version":1,"order":7,"prompt_template":"format","output_schema_version":"reference.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}}
  ]'::jsonb
$$;

create or replace function pg_temp.start_cycle(
  p_key text,
  p_slots jsonb,
  p_owner text,
  p_total integer
) returns uuid
language plpgsql
as $$
declare
  v_techniques jsonb := pg_temp.ideation_techniques();
  v_begin jsonb;
begin
  v_begin := public.begin_ideation_run(
    '10000000-0000-0000-0000-000000000001',
    'one_day', '2026-07-21', '2026-07-21', array['2026-07'],
    p_key, encode(digest(p_key, 'sha256'), 'hex'),
    jsonb_build_object('total', p_total),
    jsonb_build_object(
      'authority', '{}'::jsonb,
      'technique_manifest', v_techniques,
      'retry_policy', jsonb_build_object('max_attempts', 3)
    ),
    v_techniques, p_slots, p_owner, 180,
    '20000000-0000-0000-0000-000000000001'
  );
  return (v_begin->'cycle'->>'id')::uuid;
end
$$;

create or replace function pg_temp.run_results(
  p_cycle uuid,
  p_retryable_slugs text[] default array[]::text[],
  p_non_retryable_slugs text[] default array[]::text[]
) returns jsonb
language sql stable
as $$
  select jsonb_agg(jsonb_build_object(
    'technique_slug', technique_slug,
    'success', not (technique_slug = any(p_retryable_slugs || p_non_retryable_slugs)),
    'status', case
      when technique_slug = any(p_retryable_slugs || p_non_retryable_slugs) then 'shortfall'
      else 'complete'
    end,
    'retryable', technique_slug = any(p_retryable_slugs),
    'error_code', case
      when technique_slug = any(p_retryable_slugs) then 'ANTHROPIC_TIMEOUT'
      when technique_slug = any(p_non_retryable_slugs) then 'ANTHROPIC_REFUSAL'
      else null
    end,
    'error_message', case
      when technique_slug = any(p_retryable_slugs) then 'retryable'
      when technique_slug = any(p_non_retryable_slugs) then 'non-retryable'
      else null
    end
  ) order by technique_order)
  from public.client_ideation_technique_runs
  where ideation_cycle_id = p_cycle
$$;

do $$
declare
  v_empty_slots jsonb := '{
    "persona":[],"review-mined-pain-language":[],"competitor-objections":[],
    "end-customer-complaints":[],"live-objection-log":[],"trigger-event":[],"format-swipe":[]
  }'::jsonb;
  v_slots jsonb := '{
    "persona":[],"review-mined-pain-language":["reel"],"competitor-objections":["story"],
    "end-customer-complaints":[],"live-objection-log":[],"trigger-event":[],"format-swipe":[]
  }'::jsonb;
  v_cycle uuid;
  v_other_cycle uuid;
  v_other_research uuid;
  v_technique_two_run uuid;
  v_results jsonb;
  v_research jsonb;
  v_candidate jsonb;
  v_begin jsonb;
begin
  -- Persist a research row in a different cycle for wrong-cycle ownership tests.
  v_other_cycle := pg_temp.start_cycle('adversarial-other', v_empty_slots, 'lease-other', 0);
  v_research := jsonb_build_array(jsonb_build_object(
    'research_key','other-research','technique_slug','review-mined-pain-language',
    'source_identifier','other','source_type','approved_context',
    'source_url','aa-authority://source/other','source_title','Other',
    'source_excerpt','Other bounded support','source_provider','approved_client_authority',
    'retrieved_at',now(),'content_hash',repeat('1',64),'status','processed',
    'source_findings','{}'::jsonb,'analysis_findings','{}'::jsonb,
    'analysis_source_references','[]'::jsonb
  ));
  perform public.complete_ideation_run(
    v_other_cycle, 'lease-other', v_research, '[]'::jsonb,
    pg_temp.run_results(v_other_cycle), 'anthropic', 'model', 'prompt', 'schema',
    '20000000-0000-0000-0000-000000000001'
  );
  select id into v_other_research
  from public.client_ideation_research_results
  where ideation_cycle_id = v_other_cycle and research_key = 'other-research';

  v_cycle := pg_temp.start_cycle('adversarial-allocation', v_slots, 'lease-allocation', 2);
  select id into v_technique_two_run
  from public.client_ideation_technique_runs
  where ideation_cycle_id = v_cycle
    and technique_slug = 'review-mined-pain-language';
  v_research := jsonb_build_array(jsonb_build_object(
    'research_key','technique-2','technique_slug','review-mined-pain-language',
    'source_identifier','source-2','source_type','approved_context',
    'source_url','aa-authority://source/2','source_title','Source 2',
    'source_excerpt','Bounded support 30%','source_provider','approved_client_authority',
    'retrieved_at',now(),'content_hash',repeat('2',64),'status','processed',
    'source_findings','{}'::jsonb,'analysis_findings','{}'::jsonb,
    'analysis_source_references','[]'::jsonb
  ));
  v_results := pg_temp.run_results(v_cycle);

  -- Wrong asset type for an allocated slot.
  v_candidate := jsonb_build_array(jsonb_build_object(
    'technique_slug','review-mined-pain-language','research_key','technique-2',
    'candidate_index',0,'asset_type','story','working_title','Title','hook','Hook',
    'core_message','Message','psychological_angle','Angle','cta','CTA',
    'evidence_references','[{"claim":"Message"}]'::jsonb,'draft_payload','{}'::jsonb
  ));
  begin
    perform public.complete_ideation_run(v_cycle, 'lease-allocation', v_research, v_candidate, v_results,
      'anthropic','model','prompt','schema','20000000-0000-0000-0000-000000000001');
    raise exception 'wrong asset allocation succeeded';
  exception when others then
    if sqlerrm not like '%CANDIDATE_ASSET_ALLOCATION_INVALID%' then raise; end if;
  end;

  -- A supplied run ID cannot be paired with another technique slug.
  v_candidate := jsonb_set(v_candidate, '{0,technique_slug}', '"competitor-objections"'::jsonb);
  v_candidate := jsonb_set(v_candidate, '{0,technique_run_id}', to_jsonb(v_technique_two_run::text));
  begin
    perform public.complete_ideation_run(v_cycle, 'lease-allocation', v_research, v_candidate, v_results,
      'anthropic','model','prompt','schema','20000000-0000-0000-0000-000000000001');
    raise exception 'wrong technique allocation succeeded';
  exception when others then
    if sqlerrm not like '%CANDIDATE_RUN_INVALID%' then raise; end if;
  end;
  v_candidate := jsonb_set(v_candidate, '{0,technique_slug}', '"review-mined-pain-language"'::jsonb);
  v_candidate := v_candidate #- '{0,technique_run_id}';

  -- Out-of-range and unallocated indexes.
  v_candidate := jsonb_set(v_candidate, '{0,asset_type}', '"reel"'::jsonb);
  v_candidate := jsonb_set(v_candidate, '{0,candidate_index}', '1'::jsonb);
  begin
    perform public.complete_ideation_run(v_cycle, 'lease-allocation', v_research, v_candidate, v_results,
      'anthropic','model','prompt','schema','20000000-0000-0000-0000-000000000001');
    raise exception 'out-of-range slot succeeded';
  exception when others then
    if sqlerrm not like '%CANDIDATE_SLOT_INVALID%' then raise; end if;
  end;

  -- Cross-technique research provenance.
  v_research := jsonb_set(v_research, '{0,technique_slug}', '"competitor-objections"'::jsonb);
  v_candidate := jsonb_set(v_candidate, '{0,candidate_index}', '0'::jsonb);
  begin
    perform public.complete_ideation_run(v_cycle, 'lease-allocation', v_research, v_candidate, v_results,
      'anthropic','model','prompt','schema','20000000-0000-0000-0000-000000000001');
    raise exception 'cross-technique research succeeded';
  exception when others then
    if sqlerrm not like '%CANDIDATE_PROVENANCE_INVALID%' then raise; end if;
  end;

  -- Wrong-cycle research_result_id cannot be smuggled into an otherwise valid payload.
  v_research := jsonb_set(v_research, '{0,technique_slug}', '"review-mined-pain-language"'::jsonb);
  v_candidate := jsonb_set(v_candidate, '{0,research_result_id}', to_jsonb(v_other_research::text));
  begin
    perform public.complete_ideation_run(v_cycle, 'lease-allocation', v_research, v_candidate, v_results,
      'anthropic','model','prompt','schema','20000000-0000-0000-0000-000000000001');
    raise exception 'wrong-cycle research succeeded';
  exception when others then
    if sqlerrm not like '%CANDIDATE_PROVENANCE_INVALID%' then raise; end if;
  end;

  -- Duplicate technique/slot payloads are rejected before persistence.
  v_candidate := v_candidate - 0 || jsonb_build_array(v_candidate->0, v_candidate->0);
  begin
    perform public.complete_ideation_run(v_cycle, 'lease-allocation', v_research, v_candidate, v_results,
      'anthropic','model','prompt','schema','20000000-0000-0000-0000-000000000001');
    raise exception 'duplicate candidate slots succeeded';
  exception when others then
    if sqlerrm not like '%CANDIDATE_SLOT_DUPLICATE%' then raise; end if;
  end;

  -- Aggregate totals cannot compensate for a missing technique allocation.
  v_candidate := jsonb_build_array(
    jsonb_build_object(
      'technique_slug','review-mined-pain-language','research_key','technique-2',
      'candidate_index',0,'asset_type','reel','working_title','One','hook','Hook',
      'core_message','Message','psychological_angle','Angle','cta','CTA',
      'evidence_references','[{"claim":"Message"}]'::jsonb,'draft_payload','{}'::jsonb
    ),
    jsonb_build_object(
      'technique_slug','review-mined-pain-language','research_key','technique-2',
      'candidate_index',1,'asset_type','reel','working_title','Two','hook','Hook',
      'core_message','Message','psychological_angle','Angle','cta','CTA',
      'evidence_references','[{"claim":"Message"}]'::jsonb,'draft_payload','{}'::jsonb
    )
  );
  begin
    perform public.complete_ideation_run(v_cycle, 'lease-allocation', v_research, v_candidate, v_results,
      'anthropic','model','prompt','schema','20000000-0000-0000-0000-000000000001');
    raise exception 'aggregate-only completion succeeded';
  exception when others then
    if sqlerrm not like '%CANDIDATE_SLOT_INVALID%' then raise; end if;
  end;

  -- Mixed retryability becomes terminal; only retryable technique state is retained.
  perform public.complete_ideation_run(
    v_cycle, 'lease-allocation', '[]'::jsonb, '[]'::jsonb,
    pg_temp.run_results(
      v_cycle,
      array['review-mined-pain-language'],
      array['competitor-objections']
    ),
    'anthropic','model','prompt','schema','20000000-0000-0000-0000-000000000001'
  );
  if (select status <> 'failed' or retryable from public.client_ideation_cycles where id = v_cycle) then
    raise exception 'mixed retryability did not become terminal';
  end if;
  if (select status <> 'shortfall' or not retryable
      from public.client_ideation_technique_runs
      where ideation_cycle_id = v_cycle and technique_slug = 'review-mined-pain-language') then
    raise exception 'retryable technique state was not preserved';
  end if;
  if (select status <> 'failed' or retryable
      from public.client_ideation_technique_runs
      where ideation_cycle_id = v_cycle and technique_slug = 'competitor-objections') then
    raise exception 'non-retryable technique state was not preserved';
  end if;

  -- Expired attempt one and two reclaim; expired attempt three terminally fails.
  v_cycle := pg_temp.start_cycle(
    'adversarial-attempt-cap',
    jsonb_set(v_empty_slots, '{review-mined-pain-language}', '["reel"]'::jsonb),
    'lease-attempt-1',
    1
  );
  update public.client_ideation_cycles set lease_expires_at = now() - interval '1 second' where id = v_cycle;
  v_begin := public.begin_ideation_run(
    '10000000-0000-0000-0000-000000000001','one_day','2026-07-21','2026-07-21',array['2026-07'],
    'adversarial-attempt-cap',encode(digest('adversarial-attempt-cap','sha256'),'hex'),
    '{"total":1}'::jsonb,
    jsonb_build_object('authority','{}'::jsonb,'technique_manifest',pg_temp.ideation_techniques(),'retry_policy',jsonb_build_object('max_attempts',3)),
    pg_temp.ideation_techniques(),
    jsonb_set(v_empty_slots, '{review-mined-pain-language}', '["reel"]'::jsonb),
    'lease-attempt-2',180,'20000000-0000-0000-0000-000000000001'
  );
  if (v_begin->'cycle'->>'attempt_count')::integer <> 2 then raise exception 'attempt 1 reclaim failed'; end if;
  update public.client_ideation_cycles set lease_expires_at = now() - interval '1 second' where id = v_cycle;
  v_begin := public.begin_ideation_run(
    '10000000-0000-0000-0000-000000000001','one_day','2026-07-21','2026-07-21',array['2026-07'],
    'adversarial-attempt-cap',encode(digest('adversarial-attempt-cap','sha256'),'hex'),
    '{"total":1}'::jsonb,
    jsonb_build_object('authority','{}'::jsonb,'technique_manifest',pg_temp.ideation_techniques(),'retry_policy',jsonb_build_object('max_attempts',3)),
    pg_temp.ideation_techniques(),
    jsonb_set(v_empty_slots, '{review-mined-pain-language}', '["reel"]'::jsonb),
    'lease-attempt-3',180,'20000000-0000-0000-0000-000000000001'
  );
  if (v_begin->'cycle'->>'attempt_count')::integer <> 3 then raise exception 'attempt 2 reclaim failed'; end if;
  update public.client_ideation_cycles set lease_expires_at = now() - interval '1 second' where id = v_cycle;
  v_begin := public.begin_ideation_run(
    '10000000-0000-0000-0000-000000000001','one_day','2026-07-21','2026-07-21',array['2026-07'],
    'adversarial-attempt-cap',encode(digest('adversarial-attempt-cap','sha256'),'hex'),
    '{"total":1}'::jsonb,
    jsonb_build_object('authority','{}'::jsonb,'technique_manifest',pg_temp.ideation_techniques(),'retry_policy',jsonb_build_object('max_attempts',3)),
    pg_temp.ideation_techniques(),
    jsonb_set(v_empty_slots, '{review-mined-pain-language}', '["reel"]'::jsonb),
    'lease-attempt-4',180,'20000000-0000-0000-0000-000000000001'
  );
  if (v_begin->>'created')::boolean
    or not coalesce((v_begin->>'attempts_exhausted')::boolean, false)
    or v_begin->'cycle'->>'status' <> 'failed'
    or (v_begin->'cycle'->>'attempt_count')::integer <> 3 then
    raise exception 'expired final attempt was incorrectly reclaimed';
  end if;
  if exists (
    select 1 from public.client_ideation_technique_runs
    where ideation_cycle_id = v_cycle and status = 'running'
  ) then
    raise exception 'attempt exhaustion left a non-terminal technique run';
  end if;
  v_begin := public.begin_ideation_run(
    '10000000-0000-0000-0000-000000000001','one_day','2026-07-21','2026-07-21',array['2026-07'],
    'adversarial-attempt-cap',encode(digest('adversarial-attempt-cap','sha256'),'hex'),
    '{"total":1}'::jsonb,
    jsonb_build_object('authority','{}'::jsonb,'technique_manifest',pg_temp.ideation_techniques(),'retry_policy',jsonb_build_object('max_attempts',3)),
    pg_temp.ideation_techniques(),
    jsonb_set(v_empty_slots, '{review-mined-pain-language}', '["reel"]'::jsonb),
    'lease-attempt-5',180,'20000000-0000-0000-0000-000000000001'
  );
  if (v_begin->>'created')::boolean or v_begin->'cycle'->>'status' <> 'failed' then
    raise exception 'terminal attempt exhaustion was reclaimed';
  end if;

  -- The exact immutable per-technique allocation completes successfully.
  v_cycle := pg_temp.start_cycle('adversarial-exact-completion', v_slots, 'lease-exact', 2);
  v_research := jsonb_build_array(
    jsonb_build_object(
      'research_key','exact-technique-2','technique_slug','review-mined-pain-language',
      'source_identifier','exact-2','source_type','approved_context',
      'source_url','aa-authority://source/exact-2','source_title','Exact 2',
      'source_excerpt','Exact bounded support two','source_provider','approved_client_authority',
      'retrieved_at',now(),'content_hash',repeat('6',64),'status','processed',
      'source_findings','{}'::jsonb,'analysis_findings','{}'::jsonb,
      'analysis_source_references','[]'::jsonb
    ),
    jsonb_build_object(
      'research_key','exact-technique-3','technique_slug','competitor-objections',
      'source_identifier','exact-3','source_type','approved_context',
      'source_url','aa-authority://source/exact-3','source_title','Exact 3',
      'source_excerpt','Exact bounded support three','source_provider','approved_client_authority',
      'retrieved_at',now(),'content_hash',repeat('7',64),'status','processed',
      'source_findings','{}'::jsonb,'analysis_findings','{}'::jsonb,
      'analysis_source_references','[]'::jsonb
    )
  );
  v_candidate := jsonb_build_array(
    jsonb_build_object(
      'technique_slug','review-mined-pain-language','research_key','exact-technique-2',
      'candidate_index',0,'asset_type','reel','working_title','Exact reel','hook','Hook',
      'core_message','Message','psychological_angle','Angle','cta','CTA',
      'evidence_references','[{"claim":"Message"}]'::jsonb,'draft_payload','{}'::jsonb
    ),
    jsonb_build_object(
      'technique_slug','competitor-objections','research_key','exact-technique-3',
      'candidate_index',0,'asset_type','story','working_title','Exact story','hook','Hook',
      'core_message','Message','psychological_angle','Angle','cta','CTA',
      'evidence_references','[{"claim":"Message"}]'::jsonb,'draft_payload','{}'::jsonb
    )
  );
  perform public.complete_ideation_run(
    v_cycle, 'lease-exact', v_research, v_candidate, pg_temp.run_results(v_cycle),
    'anthropic','model','prompt','schema','20000000-0000-0000-0000-000000000001'
  );
  if (select status <> 'completed' or candidate_count <> 2 or shortfall_count <> 0
      from public.client_ideation_cycles where id = v_cycle) then
    raise exception 'exact per-technique allocation did not complete';
  end if;
end
$$;

-- RLS: an account manager sees only assigned clients; anon sees nothing; RPC mutation is service-only.
insert into public.clients(id, name, slug)
values ('10000000-0000-0000-0000-000000000002', 'Other client', 'other-ideation-client');
insert into public.client_ideation_cycles (
  client_id, period_type, period_start, period_end, execution_months, status,
  idempotency_key, input_hash, quantity_plan, configuration_snapshot,
  slot_allocation, expected_candidate_count, candidate_count, shortfall_count,
  retryable, attempt_count, lease_owner, lease_expires_at, last_heartbeat_at
) values (
  '10000000-0000-0000-0000-000000000002','one_day','2026-07-21','2026-07-21',
  array['2026-07'],'running','other-client-cycle',repeat('9',64),'{"total":0}'::jsonb,
  '{"retry_policy":{"max_attempts":3}}'::jsonb,'{}'::jsonb,0,0,0,false,1,
  'other-client-owner',now() + interval '3 minutes',now()
);
set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000001';
set role authenticated;
do $$
begin
  if exists (
    select 1 from public.client_ideation_cycles
    where client_id = '10000000-0000-0000-0000-000000000002'
  ) then raise exception 'cross-client cycle was visible'; end if;
  begin
    perform public.begin_ideation_run(
      '10000000-0000-0000-0000-000000000001','one_day','2026-07-21','2026-07-21',array['2026-07'],
      'authenticated-rpc-denied',repeat('f',64),'{"total":0}'::jsonb,'{}'::jsonb,
      '[]'::jsonb,'{}'::jsonb,'denied-owner',180,
      '20000000-0000-0000-0000-000000000001'
    );
    raise exception 'authenticated user executed service-only RPC';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

set role anon;
do $$
begin
  begin
    perform 1 from public.client_ideation_cycles;
    raise exception 'anon selected Ideation cycles';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

do $$
begin
  begin
    update public.client_ideation_candidates set evidence_references = '[]'::jsonb;
    raise exception 'empty candidate evidence was accepted';
  exception when check_violation then null;
  end;
end
$$;
