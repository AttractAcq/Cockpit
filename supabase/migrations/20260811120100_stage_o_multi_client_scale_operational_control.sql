-- Programme Stage O — Multi-Client Scale and Operational Control, part 2.
--
-- Additive only, plus one careful fix to an already-live security function
-- (auth_client_ids), justified and safety-checked below. Runs after
-- 20260811120000_stage_o_role_enum_extension.sql, which added the 5 new
-- user_role enum labels this migration's RPCs reference as plain text
-- comparisons (auth_role() returns text, so no enum-value-in-same-
-- transaction restriction applies to this file).
--
-- Context scan found a real, confirmed client-isolation gap. public.users.role
-- is a Postgres enum (user_role) -- already a real, enforced vocabulary --
-- but auth_client_ids(), the function nearly every RLS SELECT policy in this
-- database calls, only routes 'admin' and 'account_manager' to real client
-- visibility via team_members. Every OTHER staff role, including 'editor'
-- (already checked as a valid staff role in dozens of RPCs across Stage
-- H-N, e.g. "auth_role() in ('admin','account_manager','editor')"), gets
-- an EMPTY client list -- meaning an editor could pass a write-permission
-- check in an RPC but see none of the underlying rows via RLS. This is a
-- real, latent defect (not a hypothetical one), safe to fix now because
-- exactly one real user exists in this database today (role='admin'),
-- confirmed by direct query before this migration was written -- so the
-- fix changes no live access for any real person, it only makes future
-- non-admin staff roles actually work the way dozens of already-written
-- RPCs already assume.

-- ---------------------------------------------------------------------------
-- 1) The isolation fix itself. Every staff role now resolves its client list
-- through team_members, exactly as account_manager already did -- 'admin'
-- and 'client' are unchanged. Safety-checked above: zero real non-admin
-- users exist today, so this changes no live person's access.
-- ---------------------------------------------------------------------------

create or replace function public.auth_client_ids() returns uuid[]
language plpgsql stable security definer set search_path to 'public' as $$
declare v_role text;
begin
  v_role := public.auth_role();
  return case
    when v_role = 'admin' then array(select id from public.clients)
    when v_role = 'client' then array(select client_id from public.client_users where user_id = auth.uid())
    when v_role is not null then array(select client_id from public.team_members where user_id = auth.uid())
    else array[]::uuid[]
  end;
end;
$$;

comment on column public.users.role is 'Stage O role vocabulary (user_role enum): admin, account_manager (full client-scoped staff access via team_members), strategist/content_operator/editor/media_buyer/analyst/client_approver (client-scoped staff access via team_members, identical read visibility today -- no fine-grained per-role permission split yet, see Stage_O_Status.md), client (client-portal access via client_users).';

-- ---------------------------------------------------------------------------
-- 2) client_work_items — a generic assignment/tracking overlay, mirroring
-- client_exception_queue's polymorphic source-reference pattern (Stage N),
-- so cross-system "what needs attention and who owns it" doesn't require
-- retrofitting assignee/due-date columns onto dozens of existing tables.
-- ---------------------------------------------------------------------------

create table public.client_work_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source_system text,
  source_table text,
  source_id uuid,
  title text not null,
  description text,
  assignee_id uuid references public.users(id) on delete set null,
  review_owner_id uuid references public.users(id) on delete set null,
  due_at timestamptz,
  priority text not null default 'normal',
  capacity_estimate_hours numeric(6,2),
  sla_hours numeric(6,2),
  status text not null default 'open',
  is_blocked boolean not null default false,
  blocked_reason text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint client_work_items_title_check check (length(trim(title)) > 0),
  constraint client_work_items_priority_check check (priority in ('low','normal','high','urgent')),
  constraint client_work_items_status_check check (status in ('open','in_progress','blocked','review','done')),
  constraint client_work_items_capacity_check check (capacity_estimate_hours is null or capacity_estimate_hours >= 0),
  constraint client_work_items_sla_check check (sla_hours is null or sla_hours >= 0),
  constraint client_work_items_blocked_check check ((status = 'blocked') = is_blocked),
  constraint client_work_items_completed_check check ((status = 'done') = (completed_at is not null))
);

create index client_work_items_client_idx on public.client_work_items (client_id, status, due_at);
create index client_work_items_assignee_idx on public.client_work_items (assignee_id, status) where assignee_id is not null;
create index client_work_items_source_idx on public.client_work_items (source_system, source_table, source_id);

drop trigger if exists client_work_items_updated_at on public.client_work_items;
create trigger client_work_items_updated_at before update on public.client_work_items
  for each row execute function public.set_updated_at();

alter table public.client_work_items enable row level security;
revoke all on public.client_work_items from public, anon, authenticated;
grant select on public.client_work_items to authenticated;
grant all on public.client_work_items to service_role;
create policy client_work_items_select on public.client_work_items
  for select to authenticated using (client_id = any(public.auth_client_ids()));

comment on table public.client_work_items is 'Generic cross-system work-allocation overlay (Stage O): assignee, due date, priority, capacity, SLA, blocker, review owner, referencing any source row via source_system/source_table/source_id.';

create or replace function public.create_work_item(
  p_client_id uuid, p_title text, p_description text default null, p_source_system text default null,
  p_source_table text default null, p_source_id uuid default null, p_assignee_id uuid default null,
  p_review_owner_id uuid default null, p_due_at timestamptz default null, p_priority text default 'normal',
  p_capacity_estimate_hours numeric default null, p_sla_hours numeric default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  insert into public.client_work_items (
    client_id, source_system, source_table, source_id, title, description,
    assignee_id, review_owner_id, due_at, priority, capacity_estimate_hours, sla_hours, created_by
  ) values (
    p_client_id, p_source_system, p_source_table, p_source_id, trim(p_title), nullif(trim(coalesce(p_description,'')),''),
    p_assignee_id, p_review_owner_id, p_due_at, p_priority, p_capacity_estimate_hours, p_sla_hours, auth.uid()
  ) returning id into v_id;
  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (p_client_id, 'work_item_created', 'Work item created: ' || trim(p_title) || '.', 'client_work_item', v_id, jsonb_build_object('priority', p_priority));
  return v_id;
end; $$;

create or replace function public.update_work_item_status(
  p_work_item_id uuid, p_new_status text, p_blocked_reason text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.client_work_items;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if p_new_status not in ('open','in_progress','blocked','review','done') then raise exception 'VALIDATION: invalid status'; end if;
  if p_new_status = 'blocked' and nullif(trim(coalesce(p_blocked_reason,'')),'') is null then
    raise exception 'VALIDATION: blocked_reason is required when status is blocked';
  end if;
  select * into v_row from public.client_work_items where id = p_work_item_id for update;
  if not found then raise exception 'NOT_FOUND: work item'; end if;
  update public.client_work_items set
    status = p_new_status,
    is_blocked = (p_new_status = 'blocked'),
    blocked_reason = case when p_new_status = 'blocked' then trim(p_blocked_reason) else null end,
    completed_at = case when p_new_status = 'done' then now() else null end,
    updated_at = now()
  where id = p_work_item_id;
  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_row.client_id, 'work_item_status_changed', 'Work item "' || v_row.title || '" moved to ' || p_new_status || '.', 'client_work_item', v_row.id, jsonb_build_object('previous_status', v_row.status, 'new_status', p_new_status));
end; $$;

create or replace function public.assign_work_item(p_work_item_id uuid, p_assignee_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.client_work_items;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  select * into v_row from public.client_work_items where id = p_work_item_id for update;
  if not found then raise exception 'NOT_FOUND: work item'; end if;
  update public.client_work_items set assignee_id = p_assignee_id, updated_at = now() where id = p_work_item_id;
  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_row.client_id, 'work_item_assigned', 'Work item "' || v_row.title || '" assignee updated.', 'client_work_item', v_row.id, jsonb_build_object('assignee_id', p_assignee_id));
end; $$;

revoke all on function public.create_work_item(uuid,text,text,text,text,uuid,uuid,uuid,timestamptz,text,numeric,numeric) from public, anon;
revoke all on function public.update_work_item_status(uuid,text,text) from public, anon;
revoke all on function public.assign_work_item(uuid,uuid) from public, anon;
grant execute on function public.create_work_item(uuid,text,text,text,text,uuid,uuid,uuid,timestamptz,text,numeric,numeric) to authenticated, service_role;
grant execute on function public.update_work_item_status(uuid,text,text) to authenticated, service_role;
grant execute on function public.assign_work_item(uuid,uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) client_cost_ledger — the 7 named cost categories, one row per cost
-- event, plus a nullable monthly revenue estimate on clients so a margin
-- figure can be computed without fabricating a number that isn't tracked
-- anywhere yet.
-- ---------------------------------------------------------------------------

alter table public.clients add column if not exists monthly_revenue_estimate numeric(12,2);
alter table public.clients add constraint clients_monthly_revenue_check check (monthly_revenue_estimate is null or monthly_revenue_estimate >= 0);
comment on column public.clients.monthly_revenue_estimate is 'Optional operator-entered monthly revenue estimate for this client (EUR, per root CLAUDE.md commercial authority), used only for the Stage O margin estimate. Null means margin cannot be computed, never fabricated as zero.';

create table public.client_cost_ledger (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  cost_category text not null,
  amount numeric(12,2) not null,
  currency text not null default 'EUR',
  source_system text,
  source_table text,
  source_id uuid,
  occurred_at timestamptz not null default now(),
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint client_cost_ledger_category_check check (cost_category in (
    'model_spend','storage','rendering','human_time','ad_management_time','revision_cost','fulfilment_cost'
  )),
  constraint client_cost_ledger_amount_check check (amount >= 0)
);

create index client_cost_ledger_client_idx on public.client_cost_ledger (client_id, occurred_at desc);
create index client_cost_ledger_category_idx on public.client_cost_ledger (client_id, cost_category, occurred_at desc);

alter table public.client_cost_ledger enable row level security;
revoke all on public.client_cost_ledger from public, anon, authenticated;
grant select on public.client_cost_ledger to authenticated;
grant all on public.client_cost_ledger to service_role;
create policy client_cost_ledger_select on public.client_cost_ledger
  for select to authenticated using (client_id = any(public.auth_client_ids()));

comment on table public.client_cost_ledger is 'Per-client cost events across the 7 Stage O categories. No aggregation is precomputed; client_margin_summary aggregates on read.';

create or replace function public.record_cost_entry(
  p_client_id uuid, p_cost_category text, p_amount numeric, p_currency text default 'EUR',
  p_source_system text default null, p_source_table text default null, p_source_id uuid default null,
  p_occurred_at timestamptz default now(), p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(), '') not in ('admin','account_manager')) then
    raise exception 'AUTH: admin or account manager role required';
  end if;
  if p_amount < 0 then raise exception 'VALIDATION: amount must be non-negative'; end if;
  insert into public.client_cost_ledger (client_id, cost_category, amount, currency, source_system, source_table, source_id, occurred_at, notes, created_by)
  values (p_client_id, p_cost_category, p_amount, coalesce(p_currency, 'EUR'), p_source_system, p_source_table, p_source_id, coalesce(p_occurred_at, now()), nullif(trim(coalesce(p_notes,'')),''),
    case when auth.role() = 'service_role' then null else auth.uid() end)
  returning id into v_id;
  return v_id;
end; $$;

revoke all on function public.record_cost_entry(uuid,text,numeric,text,text,text,uuid,timestamptz,text) from public, anon;
grant execute on function public.record_cost_entry(uuid,text,numeric,text,text,text,uuid,timestamptz,text) to authenticated, service_role;

-- Read-side aggregation view — a client's total cost by category and the
-- resulting margin estimate, only when a revenue estimate is on file.
create or replace view public.client_margin_summary as
select
  c.id as client_id, c.name as client_name, c.monthly_revenue_estimate,
  coalesce(sum(l.category_total), 0) as total_cost,
  case when c.monthly_revenue_estimate is not null then c.monthly_revenue_estimate - coalesce(sum(l.category_total), 0) else null end as estimated_margin,
  jsonb_object_agg(l.cost_category, l.category_total) filter (where l.cost_category is not null) as cost_by_category
from public.clients c
left join (
  select client_id, cost_category, sum(amount) as category_total
  from public.client_cost_ledger group by client_id, cost_category
) l on l.client_id = c.id
group by c.id, c.name, c.monthly_revenue_estimate;

comment on view public.client_margin_summary is 'Per-client cost rollup by category and, only where a monthly_revenue_estimate is on file, an estimated gross margin. Never fabricates revenue.';

grant select on public.client_margin_summary to authenticated;

-- ---------------------------------------------------------------------------
-- 4) client_onboarding_templates + onboard_client — a real, repeatable
-- onboarding path that applies default automation and capacity policies
-- (Stage N's own tables/RPCs) at client-creation time, rather than leaving
-- every new client with no policy until an operator remembers to set one.
-- ---------------------------------------------------------------------------

create table public.client_onboarding_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  default_automation_policies jsonb not null default '[]'::jsonb,
  default_capacity_policy jsonb not null default '{}'::jsonb,
  default_content_requirements text[] not null default '{}',
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_onboarding_templates_name_check check (length(trim(name)) > 0),
  constraint client_onboarding_templates_automation_check check (jsonb_typeof(default_automation_policies) = 'array'),
  constraint client_onboarding_templates_capacity_check check (jsonb_typeof(default_capacity_policy) = 'object')
);

drop trigger if exists client_onboarding_templates_updated_at on public.client_onboarding_templates;
create trigger client_onboarding_templates_updated_at before update on public.client_onboarding_templates
  for each row execute function public.set_updated_at();

alter table public.client_onboarding_templates enable row level security;
revoke all on public.client_onboarding_templates from public, anon, authenticated;
grant select on public.client_onboarding_templates to authenticated;
grant all on public.client_onboarding_templates to service_role;
create policy client_onboarding_templates_select on public.client_onboarding_templates
  for select to authenticated using (coalesce(public.auth_role(), '') <> 'client');

comment on table public.client_onboarding_templates is 'Named default bundles (automation policy set + capacity policy + starter content requirements) applied by onboard_client. Industry-specific packs / proof schemas / brand configuration templates are deferred -- see Stage_O_Status.md.';

alter table public.clients add column if not exists onboarded_from_template_id uuid references public.client_onboarding_templates(id) on delete set null;
alter table public.clients add column if not exists onboarded_at timestamptz;

create or replace function public.onboard_client(
  p_name text, p_slug text, p_package_tier text default 'proof_sprint', p_template_id uuid default null,
  p_account_manager_id uuid default null, p_geography text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_client_id uuid;
  v_template public.client_onboarding_templates;
  v_area jsonb;
  v_capacity jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') <> 'admin' then raise exception 'AUTH: admin role required'; end if;
  if length(trim(coalesce(p_name,''))) = 0 then raise exception 'VALIDATION: name is required'; end if;
  if length(trim(coalesce(p_slug,''))) = 0 then raise exception 'VALIDATION: slug is required'; end if;

  insert into public.clients (name, slug, package_tier, status, account_manager_id, geography, onboarded_at)
  values (trim(p_name), trim(p_slug), p_package_tier::package_tier, 'prospect', p_account_manager_id, p_geography, now())
  returning id into v_client_id;

  if p_account_manager_id is not null then
    insert into public.team_members (user_id, client_id) values (p_account_manager_id, v_client_id)
    on conflict do nothing;
  end if;

  if p_template_id is not null then
    select * into v_template from public.client_onboarding_templates where id = p_template_id;
    if not found then raise exception 'NOT_FOUND: onboarding template'; end if;

    for v_area in select * from jsonb_array_elements(v_template.default_automation_policies) loop
      perform public.set_client_automation_policy(
        v_client_id, v_area->>'area', v_area->>'automation_level', coalesce(v_area->'thresholds', '{}'::jsonb)
      );
    end loop;

    if v_template.default_capacity_policy <> '{}'::jsonb then
      v_capacity := v_template.default_capacity_policy;
      perform public.set_client_capacity_policy(
        v_client_id,
        (v_capacity->>'monthly_generation_budget_units')::integer,
        (v_capacity->>'per_asset_budget_units')::integer,
        (v_capacity->>'provider_credit_budget_units')::integer,
        (v_capacity->>'max_simultaneous_jobs')::integer,
        (v_capacity->>'human_review_capacity_per_day')::integer,
        coalesce(v_capacity->>'client_priority', 'normal'),
        coalesce((v_capacity->>'due_date_priority_enabled')::boolean, true),
        coalesce((v_capacity->>'retry_cap')::integer, 5)
      );
    end if;

    update public.clients set onboarded_from_template_id = p_template_id where id = v_client_id;
  end if;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_client_id, 'client_onboarded', 'Client "' || trim(p_name) || '" onboarded' || case when p_template_id is not null then ' from template "' || v_template.name || '".' else '.' end,
    'client', v_client_id, jsonb_build_object('template_id', p_template_id, 'package_tier', p_package_tier));

  return v_client_id;
end; $$;

revoke all on function public.onboard_client(text,text,text,uuid,uuid,text) from public, anon;
grant execute on function public.onboard_client(text,text,text,uuid,uuid,text) to authenticated, service_role;

comment on function public.onboard_client(text,text,text,uuid,uuid,text) is 'Creates a client, assigns an account manager via team_members, and applies a named onboarding template''s default automation + capacity policies (reusing Stage N''s own RPCs) in one call.';
