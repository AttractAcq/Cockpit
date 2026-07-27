-- Run only after tests/ideation-pr1-baseline.sql and the Ideation migration in
-- a disposable local PostgreSQL database.

do $$
declare
  v_client uuid := '10000000-0000-0000-0000-000000000001';
  v_actor uuid := '20000000-0000-0000-0000-000000000001';
  v_techniques jsonb := '[
    {"slug":"persona","name":"Persona","version":2,"order":1,"prompt_template":"persona","output_schema_version":"reference.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}},
    {"slug":"review-mined-pain-language","name":"Review-Mined Pain Language","version":2,"order":2,"prompt_template":"pain","output_schema_version":"candidates.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}},
    {"slug":"competitor-objections","name":"Competitor Objections","version":2,"order":3,"prompt_template":"competitor","output_schema_version":"candidates.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}},
    {"slug":"end-customer-complaints","name":"End-Customer Complaints","version":2,"order":4,"prompt_template":"complaints","output_schema_version":"candidates.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}},
    {"slug":"live-objection-log","name":"Live Objection Log","version":1,"order":5,"prompt_template":"no source","output_schema_version":"no-source.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}},
    {"slug":"trigger-event","name":"Trigger Event","version":1,"order":6,"prompt_template":"inactive","output_schema_version":"inactive.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}},
    {"slug":"format-swipe","name":"Format Swipe","version":1,"order":7,"prompt_template":"format","output_schema_version":"reference.v1","module_version":"modules.v1","source_policy":{},"model_policy":{}}
  ]'::jsonb;
  v_slots jsonb := '{
    "persona":[],
    "review-mined-pain-language":["reel"],
    "competitor-objections":[],
    "end-customer-complaints":[],
    "live-objection-log":[],
    "trigger-event":[],
    "format-swipe":[]
  }'::jsonb;
  v_results jsonb;
  v_configuration jsonb;
  v_begin jsonb;
  v_cycle uuid;
  v_run uuid;
  v_research jsonb;
  v_candidate jsonb;
  v_count integer;
begin
  v_configuration := jsonb_build_object(
    'authority', '{}'::jsonb,
    'technique_manifest', v_techniques,
    'retry_policy', jsonb_build_object('max_attempts', 3)
  );
  insert into auth.users(id, email, raw_user_meta_data)
  values (v_actor, 'ideation-validator@example.invalid', '{}'::jsonb);
  insert into public.users(id, email, role)
  values (v_actor, 'ideation-validator@example.invalid', 'account_manager')
  on conflict (id) do update set role = excluded.role;
  insert into public.clients(id, name, slug, stage1_status, stage2_status)
  values (
    v_client,
    'Disposable Ideation Client',
    'disposable-ideation-client',
    'complete',
    'complete'
  );
  insert into public.team_members(user_id, client_id) values (v_actor, v_client);
  insert into public.client_context_files (
    client_id, file_number, file_name, content_md, status, version
  )
  select
    v_client, file_number, lpad(file_number::text, 2, '0') || '_Approved.md',
    'Approved Phase 1 authority ' || file_number, 'approved', 1
  from generate_series(0, 20) as source(file_number);
  insert into public.client_execution_files (
    client_id, month, file_number, file_name, content_md, review_state, version
  ) values (
    v_client, '2026-07', 1, '01_Client_Strategy_Master.md',
    'Approved Phase 2 operating authority', 'approved', 1
  );
  v_begin := public.begin_ideation_run(
    v_client, 'one_day', '2026-07-20', '2026-07-20', array['2026-07'],
    'integration-key', repeat('a',64),
    '{"total":1}'::jsonb, v_configuration,
    v_techniques, v_slots, 'lease-owner-1', 180, v_actor
  );
  if not (v_begin->>'created')::boolean then raise exception 'first begin did not create'; end if;
  v_cycle := (v_begin->'cycle'->>'id')::uuid;
  select count(*) into v_count from public.client_ideation_technique_runs where ideation_cycle_id = v_cycle;
  if v_count <> 7 then raise exception 'expected seven runs, got %', v_count; end if;

  v_begin := public.begin_ideation_run(
    v_client, 'one_day', '2026-07-20', '2026-07-20', array['2026-07'],
    'integration-key', repeat('a',64),
    '{"total":1}'::jsonb, v_configuration,
    v_techniques, v_slots, 'lease-owner-2', 180, v_actor
  );
  if (v_begin->>'created')::boolean or v_begin->'cycle'->>'lease_owner' <> 'lease-owner-1' then
    raise exception 'active lease was incorrectly reclaimed';
  end if;

  update public.client_ideation_cycles
  set lease_expires_at = now() - interval '1 second'
  where id = v_cycle;
  v_begin := public.begin_ideation_run(
    v_client, 'one_day', '2026-07-20', '2026-07-20', array['2026-07'],
    'integration-key', repeat('a',64),
    '{"total":1}'::jsonb, v_configuration,
    v_techniques, v_slots, 'lease-owner-2', 180, v_actor
  );
  if not (v_begin->>'created')::boolean or not (v_begin->>'reclaimed')::boolean then
    raise exception 'expired lease was not reclaimed';
  end if;
  if (v_begin->'cycle'->>'attempt_count')::integer <> 2 then
    raise exception 'cycle attempt count did not increment';
  end if;

  begin
    perform public.renew_ideation_run_lease(v_cycle, 'lease-owner-1', 180);
    raise exception 'wrong lease owner renewed run';
  exception when others then
    if sqlerrm not like '%LEASE_OWNERSHIP_LOST%' then raise; end if;
  end;
  begin
    perform public.fail_ideation_run(v_cycle, 'lease-owner-1', 'WRONG_OWNER', 'must fail', v_actor);
    raise exception 'wrong lease owner failed run';
  exception when others then
    if sqlerrm not like '%LEASE_OWNERSHIP_LOST%' then raise; end if;
  end;
  begin
    perform public.complete_ideation_run(
      v_cycle, 'lease-owner-1', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      'anthropic', 'test-model', 'test-prompt', 'test-schema', v_actor
    );
    raise exception 'wrong lease owner completed run';
  exception when others then
    if sqlerrm not like '%LEASE_OWNERSHIP_LOST%' then raise; end if;
  end;
  begin
    perform public.complete_ideation_run(
      v_cycle, 'lease-owner-2', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      'anthropic', 'test-model', 'test-prompt', 'test-schema', v_actor
    );
    raise exception 'missing result set completed run';
  exception when others then
    if sqlerrm not like '%RUN_RESULT_SET_INVALID%' then raise; end if;
  end;

  select jsonb_agg(jsonb_build_object(
    'technique_slug', technique_slug,
    'success', technique_slug <> 'review-mined-pain-language',
    'status', case when technique_slug = 'review-mined-pain-language' then 'shortfall' else 'complete' end,
    'retryable', technique_slug = 'review-mined-pain-language',
    'error_code', case when technique_slug = 'review-mined-pain-language' then 'ANTHROPIC_TIMEOUT' else null end,
    'error_message', case when technique_slug = 'review-mined-pain-language' then 'timeout' else null end
  ) order by technique_order)
  into v_results
  from public.client_ideation_technique_runs where ideation_cycle_id = v_cycle;

  perform public.complete_ideation_run(
    v_cycle, 'lease-owner-2', '[]'::jsonb, '[]'::jsonb, v_results,
    'anthropic', 'test-model', 'test-prompt', 'test-schema', v_actor
  );
  if (select status <> 'retryable' or shortfall_count <> 1
      from public.client_ideation_cycles where id = v_cycle) then
    raise exception 'partial run did not enter retryable state';
  end if;

  v_begin := public.begin_ideation_run(
    v_client, 'one_day', '2026-07-20', '2026-07-20', array['2026-07'],
    'integration-key', repeat('a',64),
    '{"total":1}'::jsonb, v_configuration,
    v_techniques, v_slots, 'lease-owner-3', 180, v_actor
  );
  if not (v_begin->>'created')::boolean then raise exception 'retryable run was not reclaimed'; end if;

  select id into v_run from public.client_ideation_technique_runs
  where ideation_cycle_id = v_cycle and technique_slug = 'review-mined-pain-language';
  v_research := jsonb_build_array(jsonb_build_object(
    'research_key','technique-2',
    'technique_slug','review-mined-pain-language',
    'source_identifier','source-1',
    'source_type','approved_context',
    'source_url','aa-authority://source/1',
    'source_title','Source',
    'source_excerpt','Bounded evidence',
    'source_provider','approved_client_authority',
    'retrieved_at',now(),
    'content_hash',repeat('b',64),
    'status','processed',
    'source_findings','{}'::jsonb,
    'analysis_provider','anthropic',
    'analysis_model','test-model',
    'analysis_prompt_version','test-prompt',
    'analysis_output_schema_version','test-schema',
    'analyzed_at',now(),
    'analysis_findings','{"pain_language":["hidden"]}'::jsonb,
    'analysis_source_references','[]'::jsonb
  ));
  v_candidate := jsonb_build_array(jsonb_build_object(
    'technique_slug','review-mined-pain-language',
    'research_key','technique-2',
    'candidate_index',0,
    'asset_type','reel',
    'working_title','Title',
    'hook','Hook',
    'core_message','Message',
    'psychological_angle','Angle',
    'cta','CTA',
    'evidence_references','[{"evidence_type":"paraphrase","source_ids":["source-1"],"source_ref":"Source","source_url":"aa-authority://source/1","claim":"Message","support_span":"Bounded evidence","support_note":"Supported."}]'::jsonb,
    'draft_payload','{}'::jsonb
  ));
  select jsonb_agg(jsonb_build_object(
    'technique_slug', technique_slug, 'success', true, 'status', 'complete',
    'retryable', false, 'summary', '{}'::jsonb
  ) order by technique_order)
  into v_results
  from public.client_ideation_technique_runs where ideation_cycle_id = v_cycle;
  perform public.complete_ideation_run(
    v_cycle, 'lease-owner-3', v_research, v_candidate, v_results,
    'anthropic', 'test-model', 'test-prompt', 'test-schema', v_actor
  );
  if (select status <> 'completed' or candidate_count <> 1 or shortfall_count <> 0
      from public.client_ideation_cycles where id = v_cycle) then
    raise exception 'recovered run did not complete';
  end if;
  select count(*) into v_count from public.client_ideation_candidates where ideation_cycle_id = v_cycle;
  if v_count <> 1 then raise exception 'candidate was duplicated'; end if;

  v_begin := public.begin_ideation_run(
    v_client, 'one_day', '2026-07-20', '2026-07-20', array['2026-07'],
    'integration-key', repeat('a',64),
    '{"total":1}'::jsonb, v_configuration,
    v_techniques, v_slots, 'lease-owner-4', 180, v_actor
  );
  if (v_begin->>'created')::boolean then raise exception 'terminal run was reclaimed'; end if;
end
$$;

-- Direct Ideation technique-run writes remain service-only.
set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000001';
set request.jwt.claim.role = 'authenticated';
set role authenticated;
do $$
begin
  begin
    insert into public.client_ideation_technique_runs (
      client_id, technique_slug, technique_version, technique_order,
      ideation_cycle_id, status, idempotency_key, input_hash,
      authority_snapshot, technique_snapshot, requested_slots,
      generated_slots, failed_slots, attempt_count
    ) values (
      '10000000-0000-0000-0000-000000000001',
      'persona', 2, 1,
      (select id from public.client_ideation_cycles limit 1),
      'running', 'direct-write-denied', repeat('c',64),
      '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 0, 1
    );
    raise exception 'authenticated Ideation insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

do $$
begin
  if (select count(*) from public.client_context_files) <> 21 then
    raise exception 'Ideation mutated approved Context Files';
  end if;
  if (select count(*) from public.client_execution_files) <> 1 then
    raise exception 'Ideation mutated approved Execution Files';
  end if;
  if exists (
    select 1 from public.clients
    where id = '10000000-0000-0000-0000-000000000001'
      and (stage1_status <> 'complete' or stage2_status <> 'complete')
  ) then
    raise exception 'Ideation mutated Phase 1 or Phase 2 client state';
  end if;
  if (select count(*) from public.client_ideation_candidates) <> 1 then
    raise exception 'Generated candidates did not remain in pre-commit Ideation storage';
  end if;
  begin
    insert into public.client_ideation_technique_runs (
      client_id, ideation_cycle_id, technique_slug, technique_version,
      technique_order, status, idempotency_key, input_hash,
      authority_snapshot, technique_snapshot, requested_slots,
      generated_slots, failed_slots, attempt_count
    ) values (
      '10000000-0000-0000-0000-000000000001',
      (select id from public.client_ideation_cycles limit 1),
      'unexpected-eighth-technique', 1, 7, 'running',
      'unexpected-technique', repeat('e',64), '{}'::jsonb, '{}'::jsonb,
      '[]'::jsonb, 0, 0, 1
    );
    raise exception 'unexpected eighth technique was accepted';
  exception when check_violation then null;
  end;
end
$$;
