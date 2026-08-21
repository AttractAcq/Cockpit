-- Cockpit v3, Step 4 (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md) — deepen Sales.
--
-- This step's own card names the decision explicitly: "add
-- sales_contacts/sales_companies (or fold into sales_leads if the
-- dependency trace shows that's cleaner -- decide via trace, not
-- preference)." The trace: sales_leads has zero real rows in production as
-- of this migration (confirmed live) -- no real usage anywhere has ever
-- needed more than one contact or one company per lead. Building a separate
-- Companies/Contacts relational model now, ahead of any real friction that
-- would justify it, is exactly the premature generalization Principle 01
-- (Stage 2) and this plan's own "generalize on friction, not in advance"
-- rule both forbid. Folded in: one additive `company` column on
-- sales_leads, not a new entity.
--
-- Proposals and follow-up are genuinely new state a single lead row can't
-- already express (a lead can have zero, one, or several proposals over its
-- lifetime; a follow-up date is a real, distinct concept from stage), so
-- those get real new surface: an additive `follow_up_at` column, and a new
-- `sales_proposals` table (one lead -> many proposals).

alter table public.sales_leads add column if not exists company text;
alter table public.sales_leads add column if not exists follow_up_at timestamptz;

comment on column public.sales_leads.company is 'Cockpit v3 Step 4: free-text company name, folded directly onto the lead rather than a separate sales_companies table -- see this migration''s header for the trace that decided this.';
comment on column public.sales_leads.follow_up_at is 'Cockpit v3 Step 4: when this lead is next due a follow-up. Presentational only (surfaced in the UI) -- no notification/reminder infrastructure exists in this codebase, so this is not a push/email reminder.';

-- A new parameter changes create_sales_lead's Postgres signature (its own
-- argument-type list, not just a default value) -- the old 6-arg version
-- must be dropped explicitly first, or both remain independently callable
-- and a bare 6-arg call becomes ambiguous. Same discipline Phase 07 used
-- when create_work_item gained p_project_id.
drop function if exists public.create_sales_lead(uuid,text,text,text,text,integer);

create or replace function public.create_sales_lead(
  p_business_id uuid, p_name text, p_contact_email text default null,
  p_contact_phone text default null, p_source text default null,
  p_estimated_value_cents integer default null, p_company text default null
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

  insert into public.sales_leads (business_id, name, contact_email, contact_phone, source, estimated_value_cents, company, assignee_id, created_by)
  values (p_business_id, trim(p_name), nullif(trim(coalesce(p_contact_email,'')),''), nullif(trim(coalesce(p_contact_phone,'')),''), nullif(trim(coalesce(p_source,'')),''), p_estimated_value_cents, nullif(trim(coalesce(p_company,'')),''), auth.uid(), auth.uid())
  returning id into v_id;

  select client_id into v_client_id from public.businesses where id = p_business_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_client_id, auth.uid(), 'sales_lead_created', 'Lead "' || trim(p_name) || '" created.', 'sales_lead', v_id, jsonb_build_object('business_id', p_business_id, 'source', p_source));

  return v_id;
end; $$;

revoke all on function public.create_sales_lead(uuid,text,text,text,text,integer,text) from public, anon;
grant execute on function public.create_sales_lead(uuid,text,text,text,text,integer,text) to authenticated, service_role;
comment on function public.create_sales_lead(uuid,text,text,text,text,integer,text) is 'Staff-only. Creates a sales_leads row, self-assigned to the creator by default. p_company is free-text (Cockpit v3 Step 4), folded onto the lead rather than a separate table.';

create or replace function public.set_sales_lead_follow_up(p_lead_id uuid, p_follow_up_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if not exists (select 1 from public.sales_leads where id = p_lead_id) then
    raise exception 'NOT_FOUND: sales lead';
  end if;

  update public.sales_leads set follow_up_at = p_follow_up_at where id = p_lead_id;
end; $$;

revoke all on function public.set_sales_lead_follow_up(uuid,timestamptz) from public, anon;
grant execute on function public.set_sales_lead_follow_up(uuid,timestamptz) to authenticated, service_role;
comment on function public.set_sales_lead_follow_up(uuid,timestamptz) is 'Staff-only. Sets (or clears, if null) a lead''s follow_up_at. Presentational reminder only -- see the column comment.';

create table public.sales_proposals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id) on delete cascade,
  title text not null,
  amount_cents integer,
  status text not null default 'draft',
  sent_at timestamptz,
  responded_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_proposals_title_check check (length(trim(title)) > 0),
  constraint sales_proposals_amount_check check (amount_cents is null or amount_cents >= 0),
  constraint sales_proposals_status_check check (status in ('draft','sent','accepted','declined')),
  constraint sales_proposals_sent_at_check check ((status in ('sent','accepted','declined')) = (sent_at is not null)),
  constraint sales_proposals_responded_at_check check ((status in ('accepted','declined')) = (responded_at is not null))
);

create index sales_proposals_lead_idx on public.sales_proposals (lead_id, created_at desc);

drop trigger if exists sales_proposals_updated_at on public.sales_proposals;
create trigger sales_proposals_updated_at before update on public.sales_proposals
  for each row execute function public.set_updated_at();

alter table public.sales_proposals enable row level security;
revoke all on public.sales_proposals from public, anon, authenticated;
grant select on public.sales_proposals to authenticated;
grant all on public.sales_proposals to service_role;

create policy sales_proposals_select on public.sales_proposals
  for select to authenticated using (coalesce(public.auth_role(), '') <> 'client');

comment on table public.sales_proposals is 'Cockpit v3 Step 4: a formal proposal against a sales_leads row. One lead may have zero, one, or several over its lifetime (re-scoped/revised proposals), which is exactly why this is its own table rather than columns on sales_leads.';

create or replace function public.create_sales_proposal(p_lead_id uuid, p_title text, p_amount_cents integer default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_row public.sales_leads; v_client_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if length(trim(coalesce(p_title,''))) = 0 then raise exception 'VALIDATION: title is required'; end if;
  if p_amount_cents is not null and p_amount_cents < 0 then raise exception 'VALIDATION: amount must not be negative'; end if;

  select * into v_row from public.sales_leads where id = p_lead_id;
  if not found then raise exception 'NOT_FOUND: sales lead'; end if;

  insert into public.sales_proposals (lead_id, title, amount_cents, created_by)
  values (p_lead_id, trim(p_title), p_amount_cents, auth.uid())
  returning id into v_id;

  select client_id into v_client_id from public.businesses where id = v_row.business_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_client_id, auth.uid(), 'sales_proposal_created', 'Proposal "' || trim(p_title) || '" drafted for lead "' || v_row.name || '".', 'sales_proposal', v_id, jsonb_build_object('lead_id', p_lead_id));

  return v_id;
end; $$;

create or replace function public.update_sales_proposal_status(p_proposal_id uuid, p_new_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.sales_proposals;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if p_new_status not in ('draft','sent','accepted','declined') then
    raise exception 'VALIDATION: invalid status';
  end if;

  select * into v_row from public.sales_proposals where id = p_proposal_id for update;
  if not found then raise exception 'NOT_FOUND: sales proposal'; end if;

  -- sent_at is null exactly when status = 'draft' (table CHECK enforces
  -- this), so this alone is sufficient to mean "never sent".
  if p_new_status in ('accepted','declined') and v_row.sent_at is null then
    raise exception 'VALIDATION: a proposal must be sent before it can be accepted or declined';
  end if;

  update public.sales_proposals set
    status = p_new_status,
    sent_at = case when p_new_status in ('sent','accepted','declined') then coalesce(v_row.sent_at, now()) else null end,
    responded_at = case when p_new_status in ('accepted','declined') then coalesce(v_row.responded_at, now()) else null end
  where id = p_proposal_id;
end; $$;

revoke all on function public.create_sales_proposal(uuid,text,integer) from public, anon;
revoke all on function public.update_sales_proposal_status(uuid,text) from public, anon;
grant execute on function public.create_sales_proposal(uuid,text,integer) to authenticated, service_role;
grant execute on function public.update_sales_proposal_status(uuid,text) to authenticated, service_role;

comment on function public.create_sales_proposal(uuid,text,integer) is 'Staff-only. Creates a draft sales_proposals row against a lead.';
comment on function public.update_sales_proposal_status(uuid,text) is 'Staff-only. Moves a proposal through draft -> sent -> accepted/declined; sets/clears sent_at and responded_at to match the new status (both enforced present-together by table CHECK, not just this function). Rejects accepting/declining a proposal that was never sent.';
