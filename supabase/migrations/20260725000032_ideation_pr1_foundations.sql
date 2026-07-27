-- Ideation PR 1: upstream-only period runs, bounded research, and draft candidates.
-- This migration intentionally creates no link, trigger, or write path to any
-- content master, Calendar, production brief, asset, or render lifecycle.
-- Frozen Phase 1/Phase 2 boundary:
-- - approved Context Files and the strategic systems stored among them are
--   perpetual client authority;
-- - approved Execution Files are binding current operating authority;
-- - the fixed seven-technique manifest lives in application code;
-- - neither public.playbooks nor public.playbook_runs is altered or queried.

create table public.client_ideation_cycles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  period_type text not null,
  period_start date not null,
  period_end date not null,
  execution_months text[] not null,
  status text not null default 'running',
  idempotency_key text not null,
  input_hash text not null,
  quantity_plan jsonb not null default '{}'::jsonb,
  configuration_snapshot jsonb not null default '{}'::jsonb,
  slot_allocation jsonb not null default '{}'::jsonb,
  technique_summary jsonb not null default '[]'::jsonb,
  expected_candidate_count integer not null,
  candidate_count integer not null default 0,
  shortfall_count integer not null default 0,
  retryable boolean not null default false,
  attempt_count integer not null default 1,
  lease_owner text,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  error_code text,
  error_message text,
  created_by uuid references public.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_ideation_cycles_period_type_check
    check (period_type in ('one_day','one_week','date_range','one_month')),
  constraint client_ideation_cycles_period_check
    check (period_end >= period_start and period_end - period_start between 0 and 30),
  constraint client_ideation_cycles_execution_months_check
    check (cardinality(execution_months) between 1 and 3),
  constraint client_ideation_cycles_status_check
    check (status in ('running','retryable','completed','failed')),
  constraint client_ideation_cycles_idempotency_check
    check (length(idempotency_key) between 1 and 128),
  constraint client_ideation_cycles_input_hash_check
    check (input_hash ~ '^[0-9a-f]{64}$'),
  constraint client_ideation_cycles_quantity_plan_check
    check (jsonb_typeof(quantity_plan) = 'object'),
  constraint client_ideation_cycles_configuration_snapshot_check
    check (jsonb_typeof(configuration_snapshot) = 'object'),
  constraint client_ideation_cycles_slot_allocation_check
    check (jsonb_typeof(slot_allocation) = 'object'),
  constraint client_ideation_cycles_technique_summary_check
    check (jsonb_typeof(technique_summary) = 'array'),
  constraint client_ideation_cycles_counts_check
    check (
      expected_candidate_count >= 0 and candidate_count >= 0
      and shortfall_count >= 0
      and shortfall_count = greatest(expected_candidate_count - candidate_count, 0)
    ),
  constraint client_ideation_cycles_attempt_count_check
    check (attempt_count >= 1),
  constraint client_ideation_cycles_lease_check
    check (
      (status = 'running' and lease_owner is not null and lease_expires_at is not null and last_heartbeat_at is not null)
      or (status <> 'running' and lease_owner is null and lease_expires_at is null)
    ),
  constraint client_ideation_cycles_client_idempotency_key
    unique (client_id, idempotency_key),
  constraint client_ideation_cycles_id_client_key
    unique (id, client_id)
);

create index client_ideation_cycles_client_created_idx
  on public.client_ideation_cycles (client_id, created_at desc);
create index client_ideation_cycles_client_status_idx
  on public.client_ideation_cycles (client_id, status, updated_at desc);
create trigger client_ideation_cycles_updated_at
  before update on public.client_ideation_cycles
  for each row execute function public.set_updated_at();

comment on table public.client_ideation_cycles is
  'Upstream Ideation period batch shown as a Run in the UI. It has no Calendar, master, production, or render semantics.';

create table public.client_ideation_technique_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ideation_cycle_id uuid not null,
  technique_slug text not null,
  technique_version integer not null,
  technique_order integer not null,
  status text not null default 'running',
  idempotency_key text not null,
  input_hash text not null,
  authority_snapshot jsonb not null default '{}'::jsonb,
  technique_snapshot jsonb not null default '{}'::jsonb,
  proposed_output jsonb,
  provider text,
  model text,
  prompt_version text,
  requested_slots jsonb not null default '[]'::jsonb,
  generated_slots integer not null default 0,
  failed_slots integer not null default 0,
  retryable boolean not null default false,
  attempt_count integer not null default 1,
  error_code text,
  error_message text,
  initiated_by uuid references public.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_ideation_technique_runs_slug_check
    check (technique_slug in (
      'persona','review-mined-pain-language','competitor-objections',
      'end-customer-complaints','live-objection-log','trigger-event','format-swipe'
    )),
  constraint client_ideation_technique_runs_version_check
    check (technique_version >= 1),
  constraint client_ideation_technique_runs_order_check
    check (technique_order between 1 and 7),
  constraint client_ideation_technique_runs_status_check
    check (status in ('running','complete','no_source','inactive','shortfall','failed')),
  constraint client_ideation_technique_runs_idempotency_check
    check (length(idempotency_key) between 1 and 180),
  constraint client_ideation_technique_runs_input_hash_check
    check (input_hash ~ '^[0-9a-f]{64}$'),
  constraint client_ideation_technique_runs_snapshot_check
    check (
      jsonb_typeof(authority_snapshot) = 'object'
      and jsonb_typeof(technique_snapshot) = 'object'
      and (proposed_output is null or jsonb_typeof(proposed_output) = 'object')
    ),
  constraint client_ideation_technique_runs_slot_counts_check
    check (
      jsonb_typeof(requested_slots) = 'array'
      and generated_slots >= 0
      and failed_slots >= 0
      and failed_slots = greatest(jsonb_array_length(requested_slots) - generated_slots, 0)
    ),
  constraint client_ideation_technique_runs_attempt_count_check
    check (attempt_count >= 1),
  constraint client_ideation_technique_runs_cycle_slug_key
    unique (ideation_cycle_id, technique_slug),
  constraint client_ideation_technique_runs_cycle_order_key
    unique (ideation_cycle_id, technique_order),
  constraint client_ideation_technique_runs_client_idempotency_key
    unique (client_id, idempotency_key),
  constraint client_ideation_technique_runs_id_cycle_client_key
    unique (id, ideation_cycle_id, client_id),
  constraint client_ideation_technique_runs_cycle_client_fk
    foreign key (ideation_cycle_id, client_id)
    references public.client_ideation_cycles(id, client_id) on delete cascade
);

create index client_ideation_technique_runs_client_created_idx
  on public.client_ideation_technique_runs (client_id, created_at desc);
create index client_ideation_technique_runs_cycle_idx
  on public.client_ideation_technique_runs (ideation_cycle_id, technique_order);
create trigger client_ideation_technique_runs_updated_at
  before update on public.client_ideation_technique_runs
  for each row execute function public.set_updated_at();

comment on table public.client_ideation_technique_runs is
  'Execution records for the fixed Ideation technique manifest. These are not client strategic playbooks or Phase 1/Phase 2 runs.';

create table public.client_ideation_research_results (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ideation_cycle_id uuid not null,
  technique_run_id uuid not null,
  research_key text not null,
  source_identifier text not null,
  source_type text not null,
  source_url text not null,
  source_title text not null,
  source_excerpt text not null,
  source_provider text not null,
  retrieved_at timestamptz not null,
  content_hash text not null,
  status text not null default 'processed',
  source_findings jsonb not null default '{}'::jsonb,
  analysis_provider text,
  analysis_model text,
  analysis_prompt_version text,
  analysis_output_schema_version text,
  analyzed_at timestamptz,
  analysis_findings jsonb not null default '{}'::jsonb,
  analysis_source_references jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_ideation_research_source_url_check
    check (length(source_url) between 1 and 2048 and source_url ~* '^(https?://|aa-authority://)'),
  constraint client_ideation_research_source_identifier_check
    check (length(source_identifier) between 1 and 500),
  constraint client_ideation_research_source_type_check
    check (source_type in (
      'approved_context','approved_strategic_playbook','approved_execution',
      'approved_authority_bundle','external_research'
    )),
  constraint client_ideation_research_source_title_check
    check (length(source_title) between 1 and 300),
  constraint client_ideation_research_excerpt_check
    check (length(source_excerpt) between 1 and 8000),
  constraint client_ideation_research_provider_check
    check (length(source_provider) between 1 and 100),
  constraint client_ideation_research_hash_check
    check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint client_ideation_research_status_check
    check (status in ('processed','insufficient','failed')),
  constraint client_ideation_research_findings_check
    check (
      jsonb_typeof(source_findings) = 'object'
      and jsonb_typeof(analysis_findings) = 'object'
      and jsonb_typeof(analysis_source_references) = 'array'
    ),
  constraint client_ideation_research_analysis_provenance_check
    check (
      (analysis_provider is null and analysis_model is null and analysis_prompt_version is null
        and analysis_output_schema_version is null and analyzed_at is null)
      or
      (analysis_provider is not null and analysis_model is not null and analysis_prompt_version is not null
        and analysis_output_schema_version is not null and analyzed_at is not null)
    ),
  constraint client_ideation_research_cycle_key
    unique (ideation_cycle_id, research_key),
  constraint client_ideation_research_id_run_cycle_client_key
    unique (id, technique_run_id, ideation_cycle_id, client_id),
  constraint client_ideation_research_run_cycle_client_fk
    foreign key (technique_run_id, ideation_cycle_id, client_id)
    references public.client_ideation_technique_runs(id, ideation_cycle_id, client_id)
    on delete cascade
);

create index client_ideation_research_client_created_idx
  on public.client_ideation_research_results (client_id, created_at desc);
create index client_ideation_research_run_idx
  on public.client_ideation_research_results (technique_run_id);
create trigger client_ideation_research_results_updated_at
  before update on public.client_ideation_research_results
  for each row execute function public.set_updated_at();

comment on table public.client_ideation_research_results is
  'Bounded Ideation evidence and structured findings. Raw HTML and complete page storage are prohibited.';

create table public.client_ideation_candidates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ideation_cycle_id uuid not null,
  technique_run_id uuid not null,
  research_result_id uuid not null,
  candidate_index integer not null,
  asset_type text not null,
  status text not null default 'needs_review',
  working_title text not null,
  hook text not null,
  core_message text not null,
  psychological_angle text,
  cta text not null,
  evidence_references jsonb not null default '[]'::jsonb,
  draft_payload jsonb not null default '{}'::jsonb,
  model_provider text not null,
  model_name text not null,
  prompt_version text not null,
  output_schema_version text not null,
  input_hash text not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_ideation_candidates_index_check
    check (candidate_index >= 0),
  constraint client_ideation_candidates_asset_type_check
    check (asset_type in ('reel','carousel','static','story')),
  constraint client_ideation_candidates_status_check
    check (status in ('draft','needs_review')),
  constraint client_ideation_candidates_title_check
    check (length(working_title) between 1 and 300),
  constraint client_ideation_candidates_hook_check
    check (length(hook) between 1 and 1000),
  constraint client_ideation_candidates_core_message_check
    check (length(core_message) between 1 and 3000),
  constraint client_ideation_candidates_psychological_angle_check
    check (psychological_angle is null or length(psychological_angle) <= 1000),
  constraint client_ideation_candidates_cta_check
    check (length(cta) between 1 and 1000),
  constraint client_ideation_candidates_evidence_check
    check (jsonb_typeof(evidence_references) = 'array' and jsonb_array_length(evidence_references) > 0),
  constraint client_ideation_candidates_payload_check
    check (jsonb_typeof(draft_payload) = 'object'),
  constraint client_ideation_candidates_input_hash_check
    check (input_hash ~ '^[0-9a-f]{64}$'),
  constraint client_ideation_candidates_run_index
    unique (technique_run_id, candidate_index),
  constraint client_ideation_candidates_run_cycle_client_fk
    foreign key (technique_run_id, ideation_cycle_id, client_id)
    references public.client_ideation_technique_runs(id, ideation_cycle_id, client_id)
    on delete cascade,
  constraint client_ideation_candidates_research_run_cycle_client_fk
    foreign key (research_result_id, technique_run_id, ideation_cycle_id, client_id)
    references public.client_ideation_research_results(id, technique_run_id, ideation_cycle_id, client_id)
    on delete cascade
);

create index client_ideation_candidates_client_status_idx
  on public.client_ideation_candidates (client_id, status, created_at desc);
create index client_ideation_candidates_cycle_asset_idx
  on public.client_ideation_candidates (ideation_cycle_id, asset_type, created_at);
create trigger client_ideation_candidates_updated_at
  before update on public.client_ideation_candidates
  for each row execute function public.set_updated_at();

comment on table public.client_ideation_candidates is
  'Pre-Calendar Ideation draft. It has no master ref, Calendar date, score, rank, production brief, or render lifecycle.';

alter table public.client_ideation_cycles enable row level security;
alter table public.client_ideation_technique_runs enable row level security;
alter table public.client_ideation_research_results enable row level security;
alter table public.client_ideation_candidates enable row level security;

revoke all on public.client_ideation_cycles from public, anon, authenticated;
revoke all on public.client_ideation_technique_runs from public, anon, authenticated;
revoke all on public.client_ideation_research_results from public, anon, authenticated;
revoke all on public.client_ideation_candidates from public, anon, authenticated;
grant select on public.client_ideation_cycles to authenticated;
grant select on public.client_ideation_technique_runs to authenticated;
grant select on public.client_ideation_research_results to authenticated;
grant select on public.client_ideation_candidates to authenticated;
grant all on public.client_ideation_cycles to service_role;
grant all on public.client_ideation_technique_runs to service_role;
grant all on public.client_ideation_research_results to service_role;
grant all on public.client_ideation_candidates to service_role;

create policy client_ideation_cycles_select
  on public.client_ideation_cycles for select to authenticated
  using (client_id = any(public.auth_client_ids()));
create policy client_ideation_technique_runs_select
  on public.client_ideation_technique_runs for select to authenticated
  using (client_id = any(public.auth_client_ids()));
create policy client_ideation_research_results_select
  on public.client_ideation_research_results for select to authenticated
  using (client_id = any(public.auth_client_ids()));
create policy client_ideation_candidates_select
  on public.client_ideation_candidates for select to authenticated
  using (client_id = any(public.auth_client_ids()));

create or replace function public.begin_ideation_run(
  p_client_id uuid,
  p_period_type text,
  p_period_start date,
  p_period_end date,
  p_execution_months text[],
  p_idempotency_key text,
  p_input_hash text,
  p_quantity_plan jsonb,
  p_configuration_snapshot jsonb,
  p_techniques jsonb,
  p_slot_allocation jsonb,
  p_lease_owner text,
  p_lease_seconds integer,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle public.client_ideation_cycles%rowtype;
  v_inserted_id uuid;
  v_item jsonb;
  v_expected_slugs text[] := array[
    'persona','review-mined-pain-language','competitor-objections',
    'end-customer-complaints','live-objection-log','trigger-event','format-swipe'
  ];
  v_supplied_slugs text[];
  v_validated_count integer;
  v_expected_count integer;
  v_max_attempts integer;
  v_previous_status text;
  v_reclaimed boolean := false;
begin
  if jsonb_typeof(p_techniques) <> 'array' or jsonb_array_length(p_techniques) <> 7 then
    raise exception 'TECHNIQUE_SET_INVALID';
  end if;
  select array_agg(value->>'slug' order by value->>'slug'),
         count(distinct value->>'slug')
    into v_supplied_slugs, v_validated_count
  from jsonb_array_elements(p_techniques);
  if v_validated_count <> 7
    or v_supplied_slugs <> (
      select array_agg(slug order by slug)
      from unnest(v_expected_slugs) as expected(slug)
    ) then
    raise exception 'TECHNIQUE_SET_INVALID';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_techniques) as supplied(item)
    where coalesce((supplied.item->>'order')::integer, 0) not between 1 and 7
      or coalesce((supplied.item->>'version')::integer, 0) < 1
      or length(coalesce(supplied.item->>'name', '')) < 1
      or length(coalesce(supplied.item->>'prompt_template', '')) < 1
      or length(coalesce(supplied.item->>'output_schema_version', '')) < 1
      or length(coalesce(supplied.item->>'module_version', '')) < 1
      or jsonb_typeof(supplied.item->'source_policy') <> 'object'
      or jsonb_typeof(supplied.item->'model_policy') <> 'object'
      or supplied.item->>'slug' <> v_expected_slugs[(supplied.item->>'order')::integer]
  ) or (
    select count(distinct (value->>'order')::integer)
    from jsonb_array_elements(p_techniques)
  ) <> 7 then
    raise exception 'TECHNIQUE_CONFIGURATION_INVALID';
  end if;
  if p_configuration_snapshot->'technique_manifest' is distinct from p_techniques then
    raise exception 'TECHNIQUE_CONFIGURATION_CHANGED';
  end if;
  if jsonb_typeof(p_slot_allocation) <> 'object'
    or (select array_agg(key order by key) from jsonb_object_keys(p_slot_allocation) key)
       <> (
         select array_agg(slug order by slug)
         from unnest(v_expected_slugs) as expected(slug)
       ) then
    raise exception 'SLOT_ALLOCATION_INVALID';
  end if;
  if exists (
    select 1 from jsonb_each(p_slot_allocation)
    where jsonb_typeof(value) <> 'array'
  ) then raise exception 'SLOT_ALLOCATION_INVALID'; end if;
  select coalesce(sum(jsonb_array_length(value)), 0) into v_expected_count
  from jsonb_each(p_slot_allocation);
  if v_expected_count <> coalesce((p_quantity_plan->>'total')::integer, -1) then
    raise exception 'SLOT_ALLOCATION_QUANTITY_MISMATCH';
  end if;
  if length(trim(p_lease_owner)) < 8 or p_lease_seconds not between 60 and 600 then
    raise exception 'LEASE_CONFIGURATION_INVALID';
  end if;
  begin
    v_max_attempts := (p_configuration_snapshot #>> '{retry_policy,max_attempts}')::integer;
  exception when others then
    raise exception 'RETRY_CONFIGURATION_INVALID';
  end;
  if v_max_attempts is null or v_max_attempts not between 1 and 10 then
    raise exception 'RETRY_CONFIGURATION_INVALID';
  end if;

  insert into public.client_ideation_cycles (
    client_id, period_type, period_start, period_end, execution_months,
    idempotency_key, input_hash, quantity_plan, configuration_snapshot,
    slot_allocation, expected_candidate_count, shortfall_count, created_by,
    lease_owner, lease_expires_at, last_heartbeat_at
  ) values (
    p_client_id, p_period_type, p_period_start, p_period_end, p_execution_months,
    p_idempotency_key, p_input_hash, p_quantity_plan, p_configuration_snapshot,
    p_slot_allocation, v_expected_count, v_expected_count, p_actor_id,
    p_lease_owner, now() + make_interval(secs => p_lease_seconds), now()
  )
  on conflict (client_id, idempotency_key) do nothing
  returning id into v_inserted_id;

  select * into v_cycle
  from public.client_ideation_cycles
  where client_id = p_client_id and idempotency_key = p_idempotency_key
  for update;
  if v_cycle.input_hash <> p_input_hash then
    raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
  end if;

  if v_inserted_id is not null then
    for v_item in select value from jsonb_array_elements(p_techniques)
    loop
      insert into public.client_ideation_technique_runs (
        client_id, technique_slug, technique_version, technique_order,
        ideation_cycle_id, status, idempotency_key, input_hash,
        authority_snapshot, technique_snapshot, initiated_by,
        started_at, attempt_count, requested_slots, generated_slots,
        failed_slots, retryable
      ) values (
        p_client_id, v_item->>'slug', (v_item->>'version')::integer,
        (v_item->>'order')::integer, v_cycle.id, 'running',
        p_idempotency_key || ':' || (v_item->>'slug'), p_input_hash,
        p_configuration_snapshot->'authority', v_item, p_actor_id,
        now(), 1, p_slot_allocation->(v_item->>'slug'), 0,
        jsonb_array_length(p_slot_allocation->(v_item->>'slug')), false
      );
    end loop;
    insert into public.activity_log (
      client_id, actor_id, event_type, plain_english_message,
      object_type, object_id, metadata
    ) values (
      p_client_id, p_actor_id, 'ideation_run_started',
      'Ideation generation started for ' || p_period_start || ' through ' || p_period_end || '.',
      'client_ideation_cycle', v_cycle.id::text,
      jsonb_build_object('period_type', p_period_type, 'expected_candidates', v_expected_count)
    );
    return jsonb_build_object('created', true, 'reclaimed', false, 'cycle', to_jsonb(v_cycle));
  end if;

  if v_cycle.status in ('completed','failed') then
    return jsonb_build_object('created', false, 'reclaimed', false, 'cycle', to_jsonb(v_cycle));
  end if;
  if v_cycle.status = 'running' and v_cycle.lease_expires_at > now() then
    return jsonb_build_object('created', false, 'reclaimed', false, 'cycle', to_jsonb(v_cycle));
  end if;
  if v_cycle.status not in ('running','retryable') then
    raise exception 'RUN_STATE_INVALID';
  end if;
  begin
    v_max_attempts := (v_cycle.configuration_snapshot #>> '{retry_policy,max_attempts}')::integer;
  exception when others then
    raise exception 'RETRY_CONFIGURATION_INVALID';
  end;
  if v_max_attempts is null or v_max_attempts not between 1 and 10 then
    raise exception 'RETRY_CONFIGURATION_INVALID';
  end if;
  if v_cycle.attempt_count >= v_max_attempts then
    update public.client_ideation_technique_runs
    set status = case when status = 'running' or failed_slots > 0 then 'failed' else status end,
        retryable = false,
        error_code = case
          when status = 'running' or failed_slots > 0 then 'IDEATION_ATTEMPTS_EXHAUSTED'
          else error_code
        end,
        error_message = case
          when status = 'running' or failed_slots > 0
            then 'The configured Ideation attempt limit was exhausted.'
          else error_message
        end,
        finished_at = case when status = 'running' or failed_slots > 0 then now() else finished_at end
    where ideation_cycle_id = v_cycle.id;
    update public.client_ideation_cycles
    set status = 'failed',
        retryable = false,
        error_code = 'IDEATION_ATTEMPTS_EXHAUSTED',
        error_message = 'The configured Ideation attempt limit was exhausted.',
        finished_at = now(),
        lease_owner = null,
        lease_expires_at = null
    where id = v_cycle.id
    returning * into v_cycle;
    insert into public.activity_log (
      client_id, actor_id, event_type, plain_english_message,
      object_type, object_id, metadata
    ) values (
      p_client_id, p_actor_id, 'ideation_run_attempts_exhausted',
      'Ideation stopped after exhausting its configured attempt limit.',
      'client_ideation_cycle', v_cycle.id::text,
      jsonb_build_object('attempt_count', v_cycle.attempt_count, 'max_attempts', v_max_attempts)
    );
    return jsonb_build_object(
      'created', false,
      'reclaimed', false,
      'attempts_exhausted', true,
      'cycle', to_jsonb(v_cycle)
    );
  end if;

  v_previous_status := v_cycle.status;
  update public.client_ideation_cycles
  set status = 'running',
      retryable = false,
      attempt_count = attempt_count + 1,
      lease_owner = p_lease_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_heartbeat_at = now(),
      error_code = null,
      error_message = null,
      finished_at = null
  where id = v_cycle.id
  returning * into v_cycle;
  update public.client_ideation_technique_runs
  set status = 'running',
      started_at = now(),
      finished_at = null,
      error_code = null,
      error_message = null,
      retryable = false,
      attempt_count = attempt_count + 1
  where ideation_cycle_id = v_cycle.id
    and attempt_count < v_max_attempts
    and (
      (v_previous_status = 'running' and status = 'running')
      or
      (v_previous_status = 'retryable' and status = 'shortfall' and retryable)
    );
  v_reclaimed := true;
  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message,
    object_type, object_id, metadata
  ) values (
    p_client_id, p_actor_id, 'ideation_run_reclaimed',
    'An expired or retryable Ideation generation run was safely reclaimed.',
    'client_ideation_cycle', v_cycle.id::text,
    jsonb_build_object('attempt_count', v_cycle.attempt_count)
  );
  return jsonb_build_object('created', true, 'reclaimed', v_reclaimed, 'cycle', to_jsonb(v_cycle));
end
$$;

create or replace function public.renew_ideation_run_lease(
  p_cycle_id uuid,
  p_lease_owner text,
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle public.client_ideation_cycles%rowtype;
begin
  if p_lease_seconds not between 60 and 600 then raise exception 'LEASE_CONFIGURATION_INVALID'; end if;
  update public.client_ideation_cycles
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_heartbeat_at = now()
  where id = p_cycle_id
    and status = 'running'
    and lease_owner = p_lease_owner
    and lease_expires_at > now()
  returning * into v_cycle;
  if v_cycle.id is null then raise exception 'LEASE_OWNERSHIP_LOST'; end if;
  return to_jsonb(v_cycle);
end
$$;

create or replace function public.complete_ideation_run(
  p_cycle_id uuid,
  p_lease_owner text,
  p_research_results jsonb,
  p_candidates jsonb,
  p_run_results jsonb,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_output_schema_version text,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle public.client_ideation_cycles%rowtype;
  v_run public.client_ideation_technique_runs%rowtype;
  v_item jsonb;
  v_run_id uuid;
  v_research_id uuid;
  v_candidate_index integer;
  v_expected_asset_type text;
  v_candidate_count integer;
  v_generated integer;
  v_failed integer;
  v_run_count integer;
  v_distinct_results integer;
  v_max_attempts integer;
  v_any_retryable boolean := false;
  v_any_non_retryable boolean := false;
  v_all_slots_fulfilled boolean := false;
begin
  select * into v_cycle
  from public.client_ideation_cycles
  where id = p_cycle_id
  for update;
  if v_cycle.id is null then raise exception 'RUN_NOT_FOUND'; end if;
  if v_cycle.status <> 'running'
    or v_cycle.lease_owner <> p_lease_owner
    or v_cycle.lease_expires_at <= now() then
    raise exception 'LEASE_OWNERSHIP_LOST';
  end if;
  begin
    v_max_attempts := (v_cycle.configuration_snapshot #>> '{retry_policy,max_attempts}')::integer;
  exception when others then
    raise exception 'RETRY_CONFIGURATION_INVALID';
  end;
  if v_max_attempts is null or v_max_attempts not between 1 and 10 then
    raise exception 'RETRY_CONFIGURATION_INVALID';
  end if;
  if jsonb_typeof(coalesce(p_research_results, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_candidates, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_run_results, '[]'::jsonb)) <> 'array' then
    raise exception 'COMPLETION_PAYLOAD_INVALID';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_candidates) candidate
    group by candidate->>'technique_slug', candidate->>'candidate_index'
    having count(*) > 1
  ) then
    raise exception 'CANDIDATE_SLOT_DUPLICATE';
  end if;
  select count(*) into v_run_count from public.client_ideation_technique_runs where ideation_cycle_id = p_cycle_id;
  select count(distinct value->>'technique_slug') into v_distinct_results
  from jsonb_array_elements(coalesce(p_run_results, '[]'::jsonb));
  if v_run_count <> 7 or jsonb_array_length(coalesce(p_run_results, '[]'::jsonb)) <> 7
    or v_distinct_results <> 7
    or exists (
      select 1
      from jsonb_array_elements(p_run_results) result
      left join public.client_ideation_technique_runs run
        on run.ideation_cycle_id = p_cycle_id and run.technique_slug = result->>'technique_slug'
      where run.id is null
    )
    or exists (
      select 1 from public.client_ideation_technique_runs run
      where run.ideation_cycle_id = p_cycle_id
        and not exists (
          select 1 from jsonb_array_elements(p_run_results) result
          where result->>'technique_slug' = run.technique_slug
        )
    )
    or exists (
      select 1 from jsonb_array_elements(p_run_results) result
      where coalesce(result->>'status', '') not in (
        'complete','ready','reference_ready','no_source','inactive','shortfall','failed'
      )
    ) then
    raise exception 'RUN_RESULT_SET_INVALID';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_research_results, '[]'::jsonb))
  loop
    select r.* into v_run
    from public.client_ideation_technique_runs r
    where r.ideation_cycle_id = p_cycle_id and r.technique_slug = v_item->>'technique_slug';
    if v_run.id is null or v_run.client_id <> v_cycle.client_id then
      raise exception 'RESEARCH_RUN_INVALID';
    end if;
    if (v_item ? 'technique_run_id') and (v_item->>'technique_run_id')::uuid <> v_run.id then
      raise exception 'RESEARCH_RUN_INVALID';
    end if;
    if (v_item ? 'client_id') and (v_item->>'client_id')::uuid <> v_cycle.client_id then
      raise exception 'RESEARCH_CLIENT_INVALID';
    end if;
    if exists (
      select 1
      from public.client_ideation_research_results existing
      where existing.ideation_cycle_id = p_cycle_id
        and existing.research_key = v_item->>'research_key'
        and (
          existing.technique_run_id <> v_run.id
          or existing.client_id <> v_cycle.client_id
        )
    ) then
      raise exception 'RESEARCH_PROVENANCE_CONFLICT';
    end if;
    insert into public.client_ideation_research_results (
      client_id, ideation_cycle_id, technique_run_id,
      research_key, source_identifier, source_type, source_url, source_title,
      source_excerpt, source_provider, retrieved_at, content_hash, status,
      source_findings, analysis_provider, analysis_model, analysis_prompt_version,
      analysis_output_schema_version, analyzed_at, analysis_findings,
      analysis_source_references
    ) values (
      v_cycle.client_id, p_cycle_id, v_run.id,
      v_item->>'research_key', v_item->>'source_identifier', v_item->>'source_type',
      v_item->>'source_url', v_item->>'source_title', v_item->>'source_excerpt',
      v_item->>'source_provider', (v_item->>'retrieved_at')::timestamptz,
      v_item->>'content_hash', coalesce(v_item->>'status', 'processed'),
      coalesce(v_item->'source_findings', '{}'::jsonb),
      v_item->>'analysis_provider', v_item->>'analysis_model',
      v_item->>'analysis_prompt_version', v_item->>'analysis_output_schema_version',
      (v_item->>'analyzed_at')::timestamptz,
      coalesce(v_item->'analysis_findings', '{}'::jsonb),
      coalesce(v_item->'analysis_source_references', '[]'::jsonb)
    )
    on conflict (ideation_cycle_id, research_key) do update set
      analysis_provider = excluded.analysis_provider,
      analysis_model = excluded.analysis_model,
      analysis_prompt_version = excluded.analysis_prompt_version,
      analysis_output_schema_version = excluded.analysis_output_schema_version,
      analyzed_at = excluded.analyzed_at,
      analysis_findings = excluded.analysis_findings,
      analysis_source_references = excluded.analysis_source_references,
      updated_at = now();
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb))
  loop
    select r.* into v_run
    from public.client_ideation_technique_runs r
    where r.ideation_cycle_id = p_cycle_id and r.technique_slug = v_item->>'technique_slug';
    if v_run.id is null or v_run.client_id <> v_cycle.client_id then
      raise exception 'CANDIDATE_RUN_INVALID';
    end if;
    if (v_item ? 'technique_run_id') and (v_item->>'technique_run_id')::uuid <> v_run.id then
      raise exception 'CANDIDATE_RUN_INVALID';
    end if;
    if (v_item ? 'client_id') and (v_item->>'client_id')::uuid <> v_cycle.client_id then
      raise exception 'CANDIDATE_CLIENT_INVALID';
    end if;
    begin
      v_candidate_index := (v_item->>'candidate_index')::integer;
    exception when others then
      raise exception 'CANDIDATE_SLOT_INVALID';
    end;
    if v_candidate_index < 0
      or v_candidate_index >= jsonb_array_length(v_run.requested_slots) then
      raise exception 'CANDIDATE_SLOT_INVALID';
    end if;
    v_expected_asset_type := v_run.requested_slots ->> v_candidate_index;
    if coalesce(v_item->>'asset_type', '') <> v_expected_asset_type then
      raise exception 'CANDIDATE_ASSET_ALLOCATION_INVALID';
    end if;
    select id into v_research_id
    from public.client_ideation_research_results
    where ideation_cycle_id = p_cycle_id
      and client_id = v_cycle.client_id
      and technique_run_id = v_run.id
      and research_key = v_item->>'research_key';
    if v_research_id is null then raise exception 'CANDIDATE_PROVENANCE_INVALID'; end if;
    if (v_item ? 'research_result_id')
      and (v_item->>'research_result_id')::uuid <> v_research_id then
      raise exception 'CANDIDATE_PROVENANCE_INVALID';
    end if;
    if exists (
      select 1 from public.client_ideation_candidates
      where technique_run_id = v_run.id and candidate_index = v_candidate_index
    ) then
      raise exception 'CANDIDATE_SLOT_ALREADY_FILLED';
    end if;
    insert into public.client_ideation_candidates (
      client_id, ideation_cycle_id, technique_run_id,
      research_result_id, candidate_index, asset_type, status,
      working_title, hook, core_message, psychological_angle, cta,
      evidence_references, draft_payload, model_provider, model_name,
      prompt_version, output_schema_version, input_hash, created_by
    ) values (
      v_cycle.client_id, p_cycle_id, v_run.id,
      v_research_id, v_candidate_index,
      v_item->>'asset_type', 'needs_review',
      v_item->>'working_title', v_item->>'hook', v_item->>'core_message',
      nullif(v_item->>'psychological_angle', ''), v_item->>'cta',
      coalesce(v_item->'evidence_references', '[]'::jsonb),
      coalesce(v_item->'draft_payload', '{}'::jsonb),
      p_provider, p_model, p_prompt_version, p_output_schema_version,
      v_cycle.input_hash, p_actor_id
    );
  end loop;

  for v_item in select value from jsonb_array_elements(p_run_results)
  loop
    select * into v_run
    from public.client_ideation_technique_runs
    where ideation_cycle_id = p_cycle_id and technique_slug = v_item->>'technique_slug';
    select count(*) into v_generated
    from public.client_ideation_candidates where technique_run_id = v_run.id;
    if exists (
      select 1
      from public.client_ideation_candidates candidate
      where candidate.technique_run_id = v_run.id
        and (
          candidate.ideation_cycle_id <> p_cycle_id
          or candidate.client_id <> v_cycle.client_id
          or candidate.candidate_index < 0
          or candidate.candidate_index >= jsonb_array_length(v_run.requested_slots)
          or candidate.asset_type <> (v_run.requested_slots ->> candidate.candidate_index)
        )
    ) then
      raise exception 'PERSISTED_CANDIDATE_ALLOCATION_INVALID';
    end if;
    v_failed := greatest(jsonb_array_length(v_run.requested_slots) - v_generated, 0);
    if v_failed = 0 then
      update public.client_ideation_technique_runs
      set status = case
            when jsonb_array_length(v_run.requested_slots) = 0
              and coalesce(v_item->>'status', 'complete') = 'no_source' then 'no_source'
            when jsonb_array_length(v_run.requested_slots) = 0
              and coalesce(v_item->>'status', 'complete') = 'inactive' then 'inactive'
            else 'complete'
          end,
          provider = p_provider, model = p_model,
          prompt_version = p_prompt_version,
          proposed_output = coalesce(v_item->'summary', '{}'::jsonb),
          technique_snapshot = technique_snapshot
            || jsonb_build_object('result_status', coalesce(v_item->>'status', 'complete')),
          generated_slots = v_generated, failed_slots = 0, retryable = false,
          finished_at = now(), error_code = null, error_message = null
      where id = v_run.id;
    else
      update public.client_ideation_technique_runs
      set status = case
            when coalesce((v_item->>'retryable')::boolean, false)
              and v_cycle.attempt_count < v_max_attempts then 'shortfall'
            else 'failed'
          end,
          provider = p_provider, model = p_model,
          prompt_version = p_prompt_version, generated_slots = v_generated,
          failed_slots = v_failed,
          retryable = coalesce((v_item->>'retryable')::boolean, false)
            and v_cycle.attempt_count < v_max_attempts,
          finished_at = now(),
          error_code = coalesce(v_item->>'error_code', 'TECHNIQUE_SHORTFALL'),
          error_message = coalesce(v_item->>'error_message', 'Technique did not fill its requested slots.')
      where id = v_run.id;
    end if;
  end loop;
  if exists (
    select 1 from public.client_ideation_technique_runs where ideation_cycle_id = p_cycle_id and status = 'running'
  ) then raise exception 'NON_TERMINAL_TECHNIQUE_RUN'; end if;

  select count(*) into v_candidate_count
  from public.client_ideation_candidates where ideation_cycle_id = p_cycle_id;
  if (
    select coalesce(sum(jsonb_array_length(requested_slots)), 0)
    from public.client_ideation_technique_runs
    where ideation_cycle_id = p_cycle_id
  ) <> v_cycle.expected_candidate_count
    or coalesce((v_cycle.quantity_plan->>'total')::integer, -1) <> v_cycle.expected_candidate_count
    or v_candidate_count > v_cycle.expected_candidate_count then
    raise exception 'IMMUTABLE_QUANTITY_RECONCILIATION_FAILED';
  end if;
  select exists (
    select 1 from public.client_ideation_technique_runs
    where ideation_cycle_id = p_cycle_id and failed_slots > 0 and retryable
  ) into v_any_retryable;
  select exists (
    select 1 from public.client_ideation_technique_runs
    where ideation_cycle_id = p_cycle_id and failed_slots > 0 and not retryable
  ) into v_any_non_retryable;
  select not exists (
    select 1
    from public.client_ideation_technique_runs run
    where run.ideation_cycle_id = p_cycle_id
      and (
        run.generated_slots <> jsonb_array_length(run.requested_slots)
        or run.failed_slots <> 0
        or exists (
          select 1
          from generate_series(0, jsonb_array_length(run.requested_slots) - 1) slot_index
          where not exists (
            select 1
            from public.client_ideation_candidates candidate
            where candidate.technique_run_id = run.id
              and candidate.candidate_index = slot_index
              and candidate.asset_type = run.requested_slots ->> slot_index
          )
        )
      )
  ) into v_all_slots_fulfilled;
  update public.client_ideation_cycles
  set status = case
        when v_candidate_count = expected_candidate_count
          and v_all_slots_fulfilled
          and not v_any_retryable
          and not v_any_non_retryable then 'completed'
        when v_any_non_retryable then 'failed'
        when v_any_retryable then 'retryable'
        else 'failed'
      end,
      candidate_count = v_candidate_count,
      shortfall_count = greatest(expected_candidate_count - v_candidate_count, 0),
      retryable = v_any_retryable and not v_any_non_retryable,
      technique_summary = p_run_results,
      finished_at = now(),
      lease_owner = null,
      lease_expires_at = null,
      error_code = case
        when v_candidate_count = expected_candidate_count
          and v_all_slots_fulfilled
          and not v_any_retryable
          and not v_any_non_retryable then null
        when v_any_non_retryable then 'NON_RETRYABLE_TECHNIQUE_SHORTFALL'
        when v_any_retryable then 'RETRYABLE_TECHNIQUE_SHORTFALL'
        else 'NON_RETRYABLE_TECHNIQUE_SHORTFALL'
      end,
      error_message = case
        when v_candidate_count = expected_candidate_count
          and v_all_slots_fulfilled
          and not v_any_retryable
          and not v_any_non_retryable then null
        when v_any_non_retryable then 'A required technique has a terminal non-retryable shortfall.'
        when v_any_retryable then 'One or more techniques can be retried to fill missing candidate slots.'
        else 'The required candidate quantity could not be generated within the retry policy.'
      end
  where id = p_cycle_id
  returning * into v_cycle;

  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message,
    object_type, object_id, metadata
  ) values (
    v_cycle.client_id, p_actor_id,
    case v_cycle.status
      when 'completed' then 'ideation_run_completed'
      when 'retryable' then 'ideation_run_retryable'
      else 'ideation_run_failed'
    end,
    case v_cycle.status
      when 'completed' then 'Ideation generated all ' || v_candidate_count || ' required candidate ideas.'
      when 'retryable' then 'Ideation retained successful candidates and can retry ' || v_cycle.shortfall_count || ' missing ideas.'
      else 'Ideation ended with a non-retryable shortfall of ' || v_cycle.shortfall_count || ' ideas.'
    end,
    'client_ideation_cycle', v_cycle.id::text,
    jsonb_build_object(
      'candidate_count', v_candidate_count,
      'expected_candidate_count', v_cycle.expected_candidate_count,
      'shortfall_count', v_cycle.shortfall_count,
      'attempt_count', v_cycle.attempt_count
    )
  );
  return jsonb_build_object('cycle', to_jsonb(v_cycle), 'created', true);
end
$$;

create or replace function public.fail_ideation_run(
  p_cycle_id uuid,
  p_lease_owner text,
  p_error_code text,
  p_error_message text,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle public.client_ideation_cycles%rowtype;
begin
  select * into v_cycle
  from public.client_ideation_cycles
  where id = p_cycle_id
  for update;
  if v_cycle.id is null then raise exception 'RUN_NOT_FOUND'; end if;
  if v_cycle.status <> 'running'
    or v_cycle.lease_owner <> p_lease_owner
    or v_cycle.lease_expires_at <= now() then
    raise exception 'LEASE_OWNERSHIP_LOST';
  end if;
  update public.client_ideation_technique_runs
  set status = 'failed', error_code = p_error_code,
      error_message = left(p_error_message, 2000), finished_at = now(),
      retryable = false
  where ideation_cycle_id = p_cycle_id and status = 'running';
  update public.client_ideation_cycles
  set status = 'failed', retryable = false,
      error_code = p_error_code, error_message = left(p_error_message, 2000),
      finished_at = now(), lease_owner = null, lease_expires_at = null
  where id = p_cycle_id
  returning * into v_cycle;
  insert into public.activity_log (
    client_id, actor_id, event_type, plain_english_message,
    object_type, object_id, metadata
  ) values (
    v_cycle.client_id, p_actor_id, 'ideation_run_failed',
    'Ideation generation failed: ' || left(p_error_message, 500),
    'client_ideation_cycle', v_cycle.id::text,
    jsonb_build_object('error_code', p_error_code, 'attempt_count', v_cycle.attempt_count)
  );
  return to_jsonb(v_cycle);
end
$$;

revoke all on function public.begin_ideation_run(
  uuid,text,date,date,text[],text,text,jsonb,jsonb,jsonb,jsonb,text,integer,uuid
) from public, anon, authenticated;
revoke all on function public.renew_ideation_run_lease(uuid,text,integer)
  from public, anon, authenticated;
revoke all on function public.complete_ideation_run(
  uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid
) from public, anon, authenticated;
revoke all on function public.fail_ideation_run(uuid,text,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.begin_ideation_run(
  uuid,text,date,date,text[],text,text,jsonb,jsonb,jsonb,jsonb,text,integer,uuid
) to service_role;
grant execute on function public.renew_ideation_run_lease(uuid,text,integer)
  to service_role;
grant execute on function public.complete_ideation_run(
  uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid
) to service_role;
grant execute on function public.fail_ideation_run(uuid,text,text,text,uuid)
  to service_role;
