-- Stage 2, Phase 06 — Sales. The first genuinely new department: no
-- existing table is touched, no existing feature is being converged onto.
-- Greenfield, built additive per Phase 00's Decision 4 (<=3 new tables,
-- <=2 new UI sections, 0 new edge functions where a direct RPC suffices).
--
-- Cross-business, not per-client -- a lead is prospective and has no
-- clients row yet, so these tables key off businesses(id), following the
-- no-client_id-prefix precedent set by businesses/command_center_notes.
-- Named sales_leads/sales_conversations deliberately: the only existing
-- "lead" concept in this schema is Website's unrelated lead_magnets
-- (a downloadable content asset, not a prospect), so there is no real
-- naming collision, unlike Phase 05's Campaigns finding -- but the
-- sales_ prefix is used anyway to keep the boundary unambiguous.
--
-- Thin pipeline per the build plan: Leads -> Conversations -> Opportunities
-- -> Follow-Up -> Closing. Communications Hub integration (auto-logging
-- real emails/calls as conversations) is explicitly deferred to Phase 10 --
-- log_sales_conversation is a manual entry point only, same discipline as
-- Phase 05's Campaigns staying a manual object pending real integration.

create table public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  contact_email text,
  contact_phone text,
  source text,
  estimated_value_cents integer,
  stage text not null default 'lead',
  assignee_id uuid references public.users(id) on delete set null,
  lost_reason text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint sales_leads_name_check check (length(trim(name)) > 0),
  constraint sales_leads_stage_check check (stage in ('lead','conversation','opportunity','follow_up','closed_won','closed_lost')),
  constraint sales_leads_value_check check (estimated_value_cents is null or estimated_value_cents >= 0),
  constraint sales_leads_lost_reason_check check ((stage = 'closed_lost') = (lost_reason is not null)),
  constraint sales_leads_closed_at_check check ((stage in ('closed_won','closed_lost')) = (closed_at is not null))
);

create index sales_leads_business_idx on public.sales_leads (business_id, stage);
create index sales_leads_assignee_idx on public.sales_leads (assignee_id) where assignee_id is not null;

drop trigger if exists sales_leads_updated_at on public.sales_leads;
create trigger sales_leads_updated_at before update on public.sales_leads
  for each row execute function public.set_updated_at();

alter table public.sales_leads enable row level security;
revoke all on public.sales_leads from public, anon, authenticated;
grant select on public.sales_leads to authenticated;
grant all on public.sales_leads to service_role;

-- Staff-only read, matching businesses/command_center_notes' own precedent
-- for cross-business content -- there is no client-portal concept of a
-- sales pipeline.
create policy sales_leads_select on public.sales_leads
  for select to authenticated using (coalesce(public.auth_role(), '') <> 'client');

comment on table public.sales_leads is 'Stage 2 Phase 06: the Sales pipeline''s prospect object. Cross-business (keyed off businesses(id), no client_id -- a lead has no clients row until it converts). Deliberately thin: stage is a flat 6-value pipeline (lead/conversation/opportunity/follow_up/closed_won/closed_lost), no forecasting/quota columns yet (Stage 2 build plan, Principle 01).';

create table public.sales_conversations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id) on delete cascade,
  channel text not null default 'manual',
  summary text not null,
  occurred_at timestamptz not null default now(),
  logged_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint sales_conversations_summary_check check (length(trim(summary)) > 0)
);

create index sales_conversations_lead_idx on public.sales_conversations (lead_id, occurred_at desc);

alter table public.sales_conversations enable row level security;
revoke all on public.sales_conversations from public, anon, authenticated;
grant select on public.sales_conversations to authenticated;
grant all on public.sales_conversations to service_role;

create policy sales_conversations_select on public.sales_conversations
  for select to authenticated using (coalesce(public.auth_role(), '') <> 'client');

comment on table public.sales_conversations is 'Stage 2 Phase 06: a manually-logged touchpoint against a sales_leads row. Manual entry point only -- Communications Hub auto-logging is explicitly deferred to Phase 10.';

create or replace function public.create_sales_lead(
  p_business_id uuid, p_name text, p_contact_email text default null,
  p_contact_phone text default null, p_source text default null,
  p_estimated_value_cents integer default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_client_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if length(trim(coalesce(p_name,''))) = 0 then raise exception 'VALIDATION: name is required'; end if;
  if not exists (select 1 from public.businesses where id = p_business_id) then
    raise exception 'NOT_FOUND: business';
  end if;
  if p_estimated_value_cents is not null and p_estimated_value_cents < 0 then
    raise exception 'VALIDATION: estimated value must not be negative';
  end if;

  insert into public.sales_leads (business_id, name, contact_email, contact_phone, source, estimated_value_cents, assignee_id, created_by)
  values (p_business_id, trim(p_name), nullif(trim(coalesce(p_contact_email,'')),''), nullif(trim(coalesce(p_contact_phone,'')),''), nullif(trim(coalesce(p_source,'')),''), p_estimated_value_cents, auth.uid(), auth.uid())
  returning id into v_id;

  select client_id into v_client_id from public.businesses where id = p_business_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_client_id, auth.uid(), 'sales_lead_created', 'Lead "' || trim(p_name) || '" created.', 'sales_lead', v_id, jsonb_build_object('business_id', p_business_id, 'source', p_source));

  return v_id;
end; $$;

create or replace function public.update_sales_lead_stage(p_lead_id uuid, p_new_stage text, p_lost_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.sales_leads; v_client_id uuid; v_lost_reason text;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if p_new_stage not in ('lead','conversation','opportunity','follow_up','closed_won','closed_lost') then
    raise exception 'VALIDATION: invalid stage';
  end if;

  select * into v_row from public.sales_leads where id = p_lead_id for update;
  if not found then raise exception 'NOT_FOUND: sales lead'; end if;

  v_lost_reason := nullif(trim(coalesce(p_lost_reason, v_row.lost_reason, '')), '');
  if p_new_stage = 'closed_lost' and v_lost_reason is null then
    raise exception 'VALIDATION: lost_reason is required to close a lead as lost';
  end if;
  if p_new_stage <> 'closed_lost' then v_lost_reason := null; end if;

  update public.sales_leads set
    stage = p_new_stage,
    lost_reason = v_lost_reason,
    closed_at = case when p_new_stage in ('closed_won','closed_lost') then now() else null end
  where id = p_lead_id;

  select client_id into v_client_id from public.businesses where id = v_row.business_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_client_id, auth.uid(), 'sales_lead_stage_changed', 'Lead "' || v_row.name || '" moved to ' || p_new_stage || '.', 'sales_lead', v_row.id, jsonb_build_object('previous_stage', v_row.stage, 'new_stage', p_new_stage));
end; $$;

create or replace function public.assign_sales_lead(p_lead_id uuid, p_assignee_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.sales_leads; v_client_id uuid; v_assignee_name text;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;

  select * into v_row from public.sales_leads where id = p_lead_id for update;
  if not found then raise exception 'NOT_FOUND: sales lead'; end if;

  if p_assignee_id is not null and not exists (select 1 from public.users where id = p_assignee_id) then
    raise exception 'NOT_FOUND: assignee';
  end if;

  update public.sales_leads set assignee_id = p_assignee_id where id = p_lead_id;

  select client_id into v_client_id from public.businesses where id = v_row.business_id;
  select full_name into v_assignee_name from public.users where id = p_assignee_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_client_id, auth.uid(), 'sales_lead_assigned', 'Lead "' || v_row.name || '" assigned to ' || coalesce(v_assignee_name, 'unassigned') || '.', 'sales_lead', v_row.id, jsonb_build_object('assignee_id', p_assignee_id));
end; $$;

create or replace function public.log_sales_conversation(
  p_lead_id uuid, p_summary text, p_channel text default 'manual', p_occurred_at timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_row public.sales_leads; v_client_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if length(trim(coalesce(p_summary,''))) = 0 then raise exception 'VALIDATION: summary is required'; end if;

  select * into v_row from public.sales_leads where id = p_lead_id for update;
  if not found then raise exception 'NOT_FOUND: sales lead'; end if;

  insert into public.sales_conversations (lead_id, channel, summary, occurred_at, logged_by)
  values (p_lead_id, nullif(trim(coalesce(p_channel,'')),''), trim(p_summary), coalesce(p_occurred_at, now()), auth.uid())
  returning id into v_id;

  -- The pipeline's own first real signal: a lead's first logged
  -- conversation advances it out of the bare 'lead' stage automatically.
  -- Every later transition stays a deliberate, explicit staff action via
  -- update_sales_lead_stage -- this is the one earned exception.
  if v_row.stage = 'lead' then
    update public.sales_leads set stage = 'conversation' where id = p_lead_id;
  end if;

  select client_id into v_client_id from public.businesses where id = v_row.business_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_client_id, auth.uid(), 'sales_conversation_logged', 'Conversation logged for lead "' || v_row.name || '".', 'sales_lead', v_row.id, jsonb_build_object('conversation_id', v_id, 'channel', p_channel));

  return v_id;
end; $$;

revoke all on function public.create_sales_lead(uuid,text,text,text,text,integer) from public, anon;
revoke all on function public.update_sales_lead_stage(uuid,text,text) from public, anon;
revoke all on function public.assign_sales_lead(uuid,uuid) from public, anon;
revoke all on function public.log_sales_conversation(uuid,text,text,timestamptz) from public, anon;
grant execute on function public.create_sales_lead(uuid,text,text,text,text,integer) to authenticated, service_role;
grant execute on function public.update_sales_lead_stage(uuid,text,text) to authenticated, service_role;
grant execute on function public.assign_sales_lead(uuid,uuid) to authenticated, service_role;
grant execute on function public.log_sales_conversation(uuid,text,text,timestamptz) to authenticated, service_role;

comment on function public.create_sales_lead(uuid,text,text,text,text,integer) is 'Staff-only. Creates a sales_leads row, self-assigned to the creator by default.';
comment on function public.update_sales_lead_stage(uuid,text,text) is 'Staff-only. Moves a lead through the pipeline; requires lost_reason when closing as closed_lost, sets/clears closed_at accordingly.';
comment on function public.assign_sales_lead(uuid,uuid) is 'Staff-only. Reassigns (or unassigns, if null) a lead''s owner.';
comment on function public.log_sales_conversation(uuid,text,text,timestamptz) is 'Staff-only. Logs one manual touchpoint against a lead; auto-advances a lead from ''lead'' to ''conversation'' stage on its first logged conversation. Communications Hub auto-logging deferred to Phase 10.';
