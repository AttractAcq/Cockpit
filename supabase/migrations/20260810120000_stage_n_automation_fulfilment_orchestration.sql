-- Programme Stage N — Automation and Fulfilment Orchestration.
--
-- Additive only. The context scan found this codebase already has several
-- real, independent, battle-tested lease/retry/attempt-tracking systems,
-- one per domain: client_ideation_cycles (Ideation, with a working
-- lease_owner/lease_expires_at reclaim mechanism -- "Stale leases recover"
-- is already true there, untouched here), client_insights_collection_runs
-- (Gate C), ad_launch_attempts (Stage L), client_publish_attempts (scheduled
-- publishing). Building one central job-queue/orchestrator that replaces
-- all of them would mean rewriting several already-live, already-tested
-- systems for no functional gain -- out of proportion for this pass and not
-- how this whole programme has approached any prior stage.
--
-- What Stage N actually adds, once that's subtracted: (1) a real per-client
-- Automation Policy -- nothing today lets an operator declare "for this
-- client, scheduling runs Automatic but paid campaign actions stay
-- Manual"; (2) a real per-client Capacity Policy (budgets, max simultaneous
-- jobs, priority, a configurable retry cap -- today's retry cap is a single
-- hardcoded constant shared by every client); (3) a real, generic Exception
-- Queue that any failure surface can file into, wired for real into the one
-- existing, already-live, unattended background worker in this codebase
-- (process-scheduled-publishing) as proof the mechanism works end to end,
-- not just at the schema level.

-- ---------------------------------------------------------------------------
-- client_automation_policies — one row per (client, area). Absence of a row
-- for an area means "automatic", matching every affected system's current,
-- unrestricted behaviour exactly -- adding this table changes nothing for a
-- client who never configures it.
-- ---------------------------------------------------------------------------

create table public.client_automation_policies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  area text not null,
  automation_level text not null default 'automatic',
  thresholds jsonb not null default '{}'::jsonb,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_automation_policies_area_check check (area in (
    'source_processing','opportunity_generation','scoring','weekly_planning','proposal_approval',
    'brief_generation','production_start','human_review','client_review','scheduling','publishing',
    'analytics_collection','iteration_generation','paid_campaign_actions'
  )),
  constraint client_automation_policies_level_check check (automation_level in ('manual','assisted','automatic')),
  constraint client_automation_policies_thresholds_check check (jsonb_typeof(thresholds) = 'object'),
  constraint client_automation_policies_client_area_unique unique (client_id, area)
);

create index client_automation_policies_client_idx on public.client_automation_policies (client_id);

drop trigger if exists client_automation_policies_updated_at on public.client_automation_policies;
create trigger client_automation_policies_updated_at before update on public.client_automation_policies
  for each row execute function public.set_updated_at();

alter table public.client_automation_policies enable row level security;
revoke all on public.client_automation_policies from public, anon, authenticated;
grant select on public.client_automation_policies to authenticated;
grant all on public.client_automation_policies to service_role;
create policy client_automation_policies_select on public.client_automation_policies
  for select to authenticated using (client_id = any(public.auth_client_ids()));

comment on table public.client_automation_policies is 'Per-client, per-area automation level (manual/assisted/automatic). No row for an area means automatic — the same unrestricted behaviour every affected system already has today.';

-- ---------------------------------------------------------------------------
-- client_capacity_policies — one row per client. Budgets/caps are all
-- nullable ("unset" = unrestricted, matching today); retry_cap defaults to
-- 5, matching process-scheduled-publishing's current hardcoded MAX_ATTEMPTS
-- exactly, so a client with no policy behaves identically to today.
-- ---------------------------------------------------------------------------

create table public.client_capacity_policies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  monthly_generation_budget_units integer,
  per_asset_budget_units integer,
  provider_credit_budget_units integer,
  max_simultaneous_jobs integer,
  human_review_capacity_per_day integer,
  client_priority text not null default 'normal',
  due_date_priority_enabled boolean not null default true,
  retry_cap integer not null default 5,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_capacity_policies_client_unique unique (client_id),
  constraint client_capacity_policies_priority_check check (client_priority in ('low','normal','high')),
  constraint client_capacity_policies_retry_cap_check check (retry_cap between 1 and 20),
  constraint client_capacity_policies_budgets_check check (
    (monthly_generation_budget_units is null or monthly_generation_budget_units >= 0) and
    (per_asset_budget_units is null or per_asset_budget_units >= 0) and
    (provider_credit_budget_units is null or provider_credit_budget_units >= 0) and
    (max_simultaneous_jobs is null or max_simultaneous_jobs >= 1) and
    (human_review_capacity_per_day is null or human_review_capacity_per_day >= 0)
  )
);

drop trigger if exists client_capacity_policies_updated_at on public.client_capacity_policies;
create trigger client_capacity_policies_updated_at before update on public.client_capacity_policies
  for each row execute function public.set_updated_at();

alter table public.client_capacity_policies enable row level security;
revoke all on public.client_capacity_policies from public, anon, authenticated;
grant select on public.client_capacity_policies to authenticated;
grant all on public.client_capacity_policies to service_role;
create policy client_capacity_policies_select on public.client_capacity_policies
  for select to authenticated using (client_id = any(public.auth_client_ids()));

comment on table public.client_capacity_policies is 'Per-client capacity/cost controls. retry_cap defaults to 5, matching process-scheduled-publishing''s pre-existing hardcoded MAX_ATTEMPTS — a client with no policy row behaves exactly as before this stage.';

-- ---------------------------------------------------------------------------
-- client_exception_queue — one place for the 9 exception types the build
-- plan names. Any system can file into it; an operator acknowledges/
-- resolves. Open exceptions for the same source are deduplicated, matching
-- the convention client_performance_insights/client_iteration_candidates
-- already use for their own open-item uniqueness.
-- ---------------------------------------------------------------------------

create table public.client_exception_queue (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  exception_type text not null,
  source_system text not null,
  source_table text,
  source_id uuid,
  title text not null,
  summary text not null,
  severity text not null default 'medium',
  status text not null default 'open',
  resolution_notes text,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_exception_queue_type_check check (exception_type in (
    'failed_job','missing_approval','missing_proof','provider_error','budget_exceeded',
    'invalid_claim','distribution_failure','attribution_gap','stale_workflow'
  )),
  constraint client_exception_queue_severity_check check (severity in ('low','medium','high')),
  constraint client_exception_queue_status_check check (status in ('open','acknowledged','resolved')),
  constraint client_exception_queue_title_check check (length(trim(title)) > 0),
  constraint client_exception_queue_resolution_check check (
    (status = 'resolved') = (resolved_by is not null and resolved_at is not null)
  ),
  constraint client_exception_queue_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index client_exception_queue_client_idx on public.client_exception_queue (client_id, status, created_at desc);
create index client_exception_queue_source_idx on public.client_exception_queue (source_system, source_table, source_id);
create unique index client_exception_queue_open_unique on public.client_exception_queue (client_id, source_system, coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid), exception_type) where status <> 'resolved';

drop trigger if exists client_exception_queue_updated_at on public.client_exception_queue;
create trigger client_exception_queue_updated_at before update on public.client_exception_queue
  for each row execute function public.set_updated_at();

alter table public.client_exception_queue enable row level security;
revoke all on public.client_exception_queue from public, anon, authenticated;
grant select on public.client_exception_queue to authenticated;
grant all on public.client_exception_queue to service_role;
create policy client_exception_queue_select on public.client_exception_queue
  for select to authenticated using (client_id = any(public.auth_client_ids()));

comment on table public.client_exception_queue is 'One place for failed jobs, missing approvals/proof, provider errors, budget/claim/distribution/attribution/workflow problems across every subsystem. Open exceptions for the same source are deduplicated, not re-filed.';

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public.set_client_automation_policy(
  p_client_id uuid, p_area text, p_automation_level text, p_thresholds jsonb default '{}'::jsonb
) returns public.client_automation_policies
language plpgsql security definer set search_path = '' as $$
declare v_row public.client_automation_policies;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager') then raise exception 'AUTH: admin or account manager role required'; end if;
  if jsonb_typeof(coalesce(p_thresholds, '{}'::jsonb)) <> 'object' then raise exception 'VALIDATION: thresholds must be an object'; end if;
  insert into public.client_automation_policies (client_id, area, automation_level, thresholds, updated_by)
  values (p_client_id, p_area, p_automation_level, coalesce(p_thresholds, '{}'::jsonb), auth.uid())
  on conflict (client_id, area) do update set automation_level = excluded.automation_level, thresholds = excluded.thresholds, updated_by = excluded.updated_by, updated_at = now()
  returning * into v_row;
  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (p_client_id, 'automation_policy_set', 'Automation policy for ' || p_area || ' set to ' || p_automation_level || '.', 'client_automation_policy', v_row.id, jsonb_build_object('area', p_area, 'automation_level', p_automation_level));
  return v_row;
end; $$;

create or replace function public.set_client_capacity_policy(
  p_client_id uuid, p_monthly_generation_budget_units integer default null, p_per_asset_budget_units integer default null,
  p_provider_credit_budget_units integer default null, p_max_simultaneous_jobs integer default null,
  p_human_review_capacity_per_day integer default null, p_client_priority text default 'normal',
  p_due_date_priority_enabled boolean default true, p_retry_cap integer default 5
) returns public.client_capacity_policies
language plpgsql security definer set search_path = '' as $$
declare v_row public.client_capacity_policies;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager') then raise exception 'AUTH: admin or account manager role required'; end if;
  insert into public.client_capacity_policies (
    client_id, monthly_generation_budget_units, per_asset_budget_units, provider_credit_budget_units,
    max_simultaneous_jobs, human_review_capacity_per_day, client_priority, due_date_priority_enabled, retry_cap, updated_by
  ) values (
    p_client_id, p_monthly_generation_budget_units, p_per_asset_budget_units, p_provider_credit_budget_units,
    p_max_simultaneous_jobs, p_human_review_capacity_per_day, p_client_priority, p_due_date_priority_enabled, p_retry_cap, auth.uid()
  )
  on conflict (client_id) do update set
    monthly_generation_budget_units = excluded.monthly_generation_budget_units, per_asset_budget_units = excluded.per_asset_budget_units,
    provider_credit_budget_units = excluded.provider_credit_budget_units, max_simultaneous_jobs = excluded.max_simultaneous_jobs,
    human_review_capacity_per_day = excluded.human_review_capacity_per_day, client_priority = excluded.client_priority,
    due_date_priority_enabled = excluded.due_date_priority_enabled, retry_cap = excluded.retry_cap, updated_by = excluded.updated_by, updated_at = now()
  returning * into v_row;
  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (p_client_id, 'capacity_policy_set', 'Capacity policy updated.', 'client_capacity_policy', v_row.id, jsonb_build_object('retry_cap', p_retry_cap, 'client_priority', p_client_priority));
  return v_row;
end; $$;

create or replace function public.file_exception(
  p_client_id uuid, p_exception_type text, p_source_system text, p_source_table text, p_source_id uuid,
  p_title text, p_summary text, p_severity text default 'medium', p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(), '') not in ('admin','account_manager','editor')) then
    raise exception 'AUTH: staff role required';
  end if;
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then raise exception 'VALIDATION: metadata must be an object'; end if;
  select id into v_id from public.client_exception_queue
    where client_id = p_client_id and source_system = p_source_system
      and coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_source_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and exception_type = p_exception_type and status <> 'resolved';
  if v_id is not null then return v_id; end if;
  insert into public.client_exception_queue (client_id, exception_type, source_system, source_table, source_id, title, summary, severity, metadata)
  values (p_client_id, p_exception_type, p_source_system, p_source_table, p_source_id, trim(p_title), trim(p_summary), p_severity, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (p_client_id, 'exception_filed', 'Exception filed: ' || trim(p_title) || '.', 'client_exception_queue', v_id, jsonb_build_object('exception_type', p_exception_type, 'source_system', p_source_system));
  return v_id;
end; $$;

create or replace function public.resolve_exception(
  p_exception_id uuid, p_new_status text, p_resolution_notes text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.client_exception_queue;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  if p_new_status not in ('acknowledged','resolved') then raise exception 'VALIDATION: new status must be acknowledged or resolved'; end if;
  select * into v_row from public.client_exception_queue where id = p_exception_id for update;
  if not found then raise exception 'NOT_FOUND: exception'; end if;
  if v_row.status = 'resolved' then raise exception 'VALIDATION: exception is already resolved'; end if;
  update public.client_exception_queue set
    status = p_new_status,
    resolution_notes = case when p_new_status = 'resolved' then nullif(trim(p_resolution_notes), '') else resolution_notes end,
    resolved_by = case when p_new_status = 'resolved' then auth.uid() else resolved_by end,
    resolved_at = case when p_new_status = 'resolved' then now() else resolved_at end,
    updated_at = now()
  where id = p_exception_id;
  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_row.client_id, 'exception_' || p_new_status, 'Exception ' || p_new_status || ': ' || v_row.title || '.', 'client_exception_queue', v_row.id, jsonb_build_object('exception_type', v_row.exception_type));
end; $$;

revoke all on function public.set_client_automation_policy(uuid,text,text,jsonb) from public, anon;
revoke all on function public.set_client_capacity_policy(uuid,integer,integer,integer,integer,integer,text,boolean,integer) from public, anon;
revoke all on function public.file_exception(uuid,text,text,text,uuid,text,text,text,jsonb) from public, anon;
revoke all on function public.resolve_exception(uuid,text,text) from public, anon;
grant execute on function public.set_client_automation_policy(uuid,text,text,jsonb) to authenticated, service_role;
grant execute on function public.set_client_capacity_policy(uuid,integer,integer,integer,integer,integer,text,boolean,integer) to authenticated, service_role;
grant execute on function public.file_exception(uuid,text,text,text,uuid,text,text,text,jsonb) to authenticated, service_role;
grant execute on function public.resolve_exception(uuid,text,text) to authenticated, service_role;

comment on function public.file_exception(uuid,text,text,text,uuid,text,text,text,jsonb) is 'Files or reuses an open exception for the same (client, source_system, source_id, exception_type) — never duplicates an already-open exception.';
