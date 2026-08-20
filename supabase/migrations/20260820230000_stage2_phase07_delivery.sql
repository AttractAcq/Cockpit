-- Stage 2, Phase 07 — Delivery/Operations.
--
-- Reconciled against Phase 00's own audit (docs/STAGE_2_PHASE_00_GROUND_TRUTH.md
-- §1) before writing anything: Clients, Onboarding (client_onboarding_templates
-- + onboard_client), and Tasks (client_work_items, Stage O's generic
-- polymorphic work-allocation table) are all already real. The genuinely
-- missing piece of Clients -> Onboarding -> Projects -> Tasks -> Deliverables
-- is Projects -- there is no grouping above an individual work item today --
-- plus Deliverables, a client-facing output with its own review/approval
-- state that a plain work item doesn't carry. Phase 00's acceptance bar for
-- this department explicitly stops at Deliverables ("Clients->Onboarding->
-- Projects->Tasks->Deliverables by hand"); SOPs/Quality/Reporting from the
-- phase card's longer wishlist are deliberately deferred -- no existing
-- workflow in this codebase to design a checklist/QA system against yet
-- (Principle 01), and Reporting is satisfied by a computed rollup in the UI,
-- not new schema.
--
-- Two new tables (client_projects, client_deliverables) plus one additive
-- column on the existing client_work_items table (project_id) -- Tasks
-- reuse Stage O's real Work Items table exactly as Phase 00 intended
-- ("This is the direct, reusable pattern for Phase 06 (Sales) and Phase 07
-- (Delivery) rather than bespoke new schemas"), not a third new table.
-- Within Decision 4's <=3-table budget.

create table public.client_projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'planning',
  owner_id uuid references public.users(id) on delete set null,
  started_at date,
  target_completion_at date,
  completed_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_projects_name_check check (length(trim(name)) > 0),
  constraint client_projects_status_check check (status in ('planning','active','on_hold','completed','archived')),
  constraint client_projects_dates_check check (target_completion_at is null or started_at is null or target_completion_at >= started_at),
  constraint client_projects_completed_check check ((status = 'completed') = (completed_at is not null))
);

create index client_projects_client_idx on public.client_projects (client_id, status);

drop trigger if exists client_projects_updated_at on public.client_projects;
create trigger client_projects_updated_at before update on public.client_projects
  for each row execute function public.set_updated_at();

alter table public.client_projects enable row level security;
revoke all on public.client_projects from public, anon, authenticated;
grant select on public.client_projects to authenticated;
grant all on public.client_projects to service_role;

create policy client_projects_select on public.client_projects
  for select to authenticated using (client_id = any(public.auth_client_ids()));

comment on table public.client_projects is 'Stage 2 Phase 07: the grouping Clients->Onboarding->Projects->Tasks->Deliverables was missing above individual client_work_items rows. Tasks stay on client_work_items (extended below with project_id); Deliverables get their own table for their client-facing review/approval state.';

create table public.client_deliverables (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.client_projects(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft',
  owner_id uuid references public.users(id) on delete set null,
  due_at timestamptz,
  link text,
  delivered_at timestamptz,
  approved_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_deliverables_name_check check (length(trim(name)) > 0),
  constraint client_deliverables_status_check check (status in ('draft','in_review','delivered','approved','rejected')),
  constraint client_deliverables_delivered_check check (status not in ('delivered','approved') or delivered_at is not null),
  constraint client_deliverables_approved_check check ((status = 'approved') = (approved_at is not null))
);

create index client_deliverables_project_idx on public.client_deliverables (project_id, status);

drop trigger if exists client_deliverables_updated_at on public.client_deliverables;
create trigger client_deliverables_updated_at before update on public.client_deliverables
  for each row execute function public.set_updated_at();

alter table public.client_deliverables enable row level security;
revoke all on public.client_deliverables from public, anon, authenticated;
grant select on public.client_deliverables to authenticated;
grant all on public.client_deliverables to service_role;

-- No direct client_id column, so RLS goes through the parent project -- the
-- same indirect-scoping shape client_offer_approval_decisions and similar
-- child tables already use in this schema.
create policy client_deliverables_select on public.client_deliverables
  for select to authenticated using (
    exists (select 1 from public.client_projects p where p.id = project_id and p.client_id = any(public.auth_client_ids()))
  );

comment on table public.client_deliverables is 'Stage 2 Phase 07: a client-facing output belonging to a client_projects row, with its own draft->in_review->delivered->approved/rejected state -- distinct from an internal client_work_items task.';

-- Additive: Tasks reuse client_work_items, not a new table. Nullable so
-- every existing work item (none of which belong to a project) is
-- unaffected.
alter table public.client_work_items add column project_id uuid references public.client_projects(id) on delete set null;
create index client_work_items_project_idx on public.client_work_items (project_id) where project_id is not null;
comment on column public.client_work_items.project_id is 'Stage 2 Phase 07: optional link to a client_projects row. Null for every work item created before this phase, and for any work item that still isn''t project-scoped.';

create or replace function public.create_project(
  p_client_id uuid, p_name text, p_description text default null, p_owner_id uuid default null,
  p_started_at date default null, p_target_completion_at date default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if length(trim(coalesce(p_name,''))) = 0 then raise exception 'VALIDATION: name is required'; end if;
  if not exists (select 1 from public.clients where id = p_client_id) then raise exception 'NOT_FOUND: client'; end if;

  insert into public.client_projects (client_id, name, description, owner_id, started_at, target_completion_at, created_by)
  values (p_client_id, trim(p_name), nullif(trim(coalesce(p_description,'')),''), p_owner_id, p_started_at, p_target_completion_at, auth.uid())
  returning id into v_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (p_client_id, auth.uid(), 'project_created', 'Project "' || trim(p_name) || '" created.', 'client_project', v_id, jsonb_build_object());

  return v_id;
end; $$;

create or replace function public.update_project_status(p_project_id uuid, p_new_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.client_projects;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if p_new_status not in ('planning','active','on_hold','completed','archived') then raise exception 'VALIDATION: invalid status'; end if;

  select * into v_row from public.client_projects where id = p_project_id for update;
  if not found then raise exception 'NOT_FOUND: project'; end if;

  update public.client_projects set
    status = p_new_status,
    completed_at = case when p_new_status = 'completed' then now() else null end
  where id = p_project_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_row.client_id, auth.uid(), 'project_status_changed', 'Project "' || v_row.name || '" moved to ' || p_new_status || '.', 'client_project', v_row.id, jsonb_build_object('previous_status', v_row.status, 'new_status', p_new_status));
end; $$;

create or replace function public.create_deliverable(
  p_project_id uuid, p_name text, p_description text default null, p_owner_id uuid default null,
  p_due_at timestamptz default null, p_link text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_project public.client_projects;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if length(trim(coalesce(p_name,''))) = 0 then raise exception 'VALIDATION: name is required'; end if;

  select * into v_project from public.client_projects where id = p_project_id;
  if not found then raise exception 'NOT_FOUND: project'; end if;

  insert into public.client_deliverables (project_id, name, description, owner_id, due_at, link, created_by)
  values (p_project_id, trim(p_name), nullif(trim(coalesce(p_description,'')),''), p_owner_id, p_due_at, nullif(trim(coalesce(p_link,'')),''), auth.uid())
  returning id into v_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_project.client_id, auth.uid(), 'deliverable_created', 'Deliverable "' || trim(p_name) || '" created on project "' || v_project.name || '".', 'client_deliverable', v_id, jsonb_build_object('project_id', p_project_id));

  return v_id;
end; $$;

create or replace function public.update_deliverable_status(p_deliverable_id uuid, p_new_status text, p_link text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.client_deliverables; v_project public.client_projects; v_link text;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if p_new_status not in ('draft','in_review','delivered','approved','rejected') then raise exception 'VALIDATION: invalid status'; end if;

  select * into v_row from public.client_deliverables where id = p_deliverable_id for update;
  if not found then raise exception 'NOT_FOUND: deliverable'; end if;

  v_link := coalesce(nullif(trim(coalesce(p_link,'')),''), v_row.link);

  update public.client_deliverables set
    status = p_new_status,
    link = v_link,
    delivered_at = case when p_new_status in ('delivered','approved') then coalesce(v_row.delivered_at, now()) else null end,
    approved_at = case when p_new_status = 'approved' then now() else null end
  where id = p_deliverable_id;

  select * into v_project from public.client_projects where id = v_row.project_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_project.client_id, auth.uid(), 'deliverable_status_changed', 'Deliverable "' || v_row.name || '" moved to ' || p_new_status || '.', 'client_deliverable', v_row.id, jsonb_build_object('previous_status', v_row.status, 'new_status', p_new_status));
end; $$;

-- create_work_item gains an optional project_id, validated to belong to the
-- same client. A new trailing parameter changes the function's signature,
-- so `create or replace` would leave the old 12-arg overload in place
-- alongside this one (Postgres/PostgREST would then see two candidates for
-- the same RPC name) -- drop the old signature explicitly first.
drop function if exists public.create_work_item(uuid,text,text,text,text,uuid,uuid,uuid,timestamptz,text,numeric,numeric);
create or replace function public.create_work_item(
  p_client_id uuid, p_title text, p_description text default null, p_source_system text default null,
  p_source_table text default null, p_source_id uuid default null, p_assignee_id uuid default null,
  p_review_owner_id uuid default null, p_due_at timestamptz default null, p_priority text default 'normal',
  p_capacity_estimate_hours numeric default null, p_sla_hours numeric default null, p_project_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if p_project_id is not null and not exists (select 1 from public.client_projects where id = p_project_id and client_id = p_client_id) then
    raise exception 'NOT_FOUND: project';
  end if;
  insert into public.client_work_items (
    client_id, source_system, source_table, source_id, title, description,
    assignee_id, review_owner_id, due_at, priority, capacity_estimate_hours, sla_hours, created_by, project_id
  ) values (
    p_client_id, p_source_system, p_source_table, p_source_id, trim(p_title), nullif(trim(coalesce(p_description,'')),''),
    p_assignee_id, p_review_owner_id, p_due_at, p_priority, p_capacity_estimate_hours, p_sla_hours, auth.uid(), p_project_id
  ) returning id into v_id;
  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (p_client_id, 'work_item_created', 'Work item created: ' || trim(p_title) || '.', 'client_work_item', v_id, jsonb_build_object('priority', p_priority, 'project_id', p_project_id));
  return v_id;
end; $$;

revoke all on function public.create_project(uuid,text,text,uuid,date,date) from public, anon;
revoke all on function public.update_project_status(uuid,text) from public, anon;
revoke all on function public.create_deliverable(uuid,text,text,uuid,timestamptz,text) from public, anon;
revoke all on function public.update_deliverable_status(uuid,text,text) from public, anon;
revoke all on function public.create_work_item(uuid,text,text,text,text,uuid,uuid,uuid,timestamptz,text,numeric,numeric,uuid) from public, anon;
grant execute on function public.create_project(uuid,text,text,uuid,date,date) to authenticated, service_role;
grant execute on function public.update_project_status(uuid,text) to authenticated, service_role;
grant execute on function public.create_deliverable(uuid,text,text,uuid,timestamptz,text) to authenticated, service_role;
grant execute on function public.update_deliverable_status(uuid,text,text) to authenticated, service_role;
grant execute on function public.create_work_item(uuid,text,text,text,text,uuid,uuid,uuid,timestamptz,text,numeric,numeric,uuid) to authenticated, service_role;
