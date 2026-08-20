-- Stage 2, Phase 05 — Marketing IA consolidation: the Campaigns object.
--
-- Additive only, per the Phase 05 dependency trace
-- (docs/STAGE_2_PHASE_05_DEPENDENCY_TRACE.md) -- no table dropped, no
-- existing route/column touched. Named client_marketing_campaigns
-- deliberately, not "campaigns": that name is already used for two other,
-- different concepts in this schema (ad_campaigns -- a single-channel paid
-- execution record; client_campaign_periods/client_campaign_intelligence_
-- releases -- a strategic time-window concept). This is a third, distinct
-- object: a cross-channel marketing initiative linking an approved offer
-- and avatar.
--
-- budget_cents and results are real columns but deliberately never
-- accepted by the create/update RPCs below -- they stay null until Finance
-- (Phase 08) and real Distribution linkage exist to populate them
-- meaningfully (Phase 05's own explicit deferral). Asset linkage is
-- deferred entirely (no column at all): nothing in this app today tags an
-- asset as belonging to a campaign, so a join table now would be guessing
-- at a shape before real usage exists to design it against.

create table public.client_marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  channel text,
  main_offer_id uuid references public.client_main_offers(id) on delete set null,
  avatar_release_id uuid references public.client_avatar_releases(id) on delete set null,
  status text not null default 'planning',
  starts_at date,
  ends_at date,
  budget_cents integer,
  results jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_marketing_campaigns_name_check check (length(trim(name)) > 0),
  constraint client_marketing_campaigns_status_check check (status in ('planning','active','completed','archived')),
  constraint client_marketing_campaigns_dates_check check (starts_at is null or ends_at is null or ends_at >= starts_at),
  constraint client_marketing_campaigns_budget_check check (budget_cents is null or budget_cents >= 0)
);

create index client_marketing_campaigns_client_idx on public.client_marketing_campaigns (client_id, status);

drop trigger if exists client_marketing_campaigns_updated_at on public.client_marketing_campaigns;
create trigger client_marketing_campaigns_updated_at before update on public.client_marketing_campaigns
  for each row execute function public.set_updated_at();

alter table public.client_marketing_campaigns enable row level security;
revoke all on public.client_marketing_campaigns from public, anon, authenticated;
grant select on public.client_marketing_campaigns to authenticated;
grant all on public.client_marketing_campaigns to service_role;

create policy client_marketing_campaigns_select on public.client_marketing_campaigns
  for select to authenticated using (client_id = any(public.auth_client_ids()));

comment on table public.client_marketing_campaigns is 'Stage 2 Phase 05: the Campaigns object -- a cross-channel marketing initiative linking an approved offer and avatar. budget_cents/results are real columns, never written by any RPC yet -- explicit empty shells pending Finance (08) and real Distribution linkage. Asset linkage deliberately deferred entirely (no workflow tags an asset to a campaign yet).';

create or replace function public.create_marketing_campaign(
  p_client_id uuid, p_name text, p_channel text default null,
  p_main_offer_id uuid default null, p_avatar_release_id uuid default null,
  p_starts_at date default null, p_ends_at date default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if length(trim(coalesce(p_name,''))) = 0 then raise exception 'VALIDATION: name is required'; end if;
  if p_main_offer_id is not null and not exists (select 1 from public.client_main_offers where id = p_main_offer_id and client_id = p_client_id) then
    raise exception 'NOT_FOUND: main offer';
  end if;
  if p_avatar_release_id is not null and not exists (select 1 from public.client_avatar_releases where id = p_avatar_release_id and client_id = p_client_id) then
    raise exception 'NOT_FOUND: avatar release';
  end if;

  insert into public.client_marketing_campaigns (client_id, name, channel, main_offer_id, avatar_release_id, starts_at, ends_at, created_by)
  values (p_client_id, trim(p_name), nullif(trim(coalesce(p_channel,'')),''), p_main_offer_id, p_avatar_release_id, p_starts_at, p_ends_at, auth.uid())
  returning id into v_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (p_client_id, auth.uid(), 'marketing_campaign_created', 'Campaign "' || trim(p_name) || '" created.', 'client_marketing_campaign', v_id, jsonb_build_object('channel', p_channel));

  return v_id;
end; $$;

create or replace function public.update_marketing_campaign_status(p_campaign_id uuid, p_new_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.client_marketing_campaigns;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if p_new_status not in ('planning','active','completed','archived') then raise exception 'VALIDATION: invalid status'; end if;

  select * into v_row from public.client_marketing_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'NOT_FOUND: campaign'; end if;

  update public.client_marketing_campaigns set status = p_new_status where id = p_campaign_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_row.client_id, auth.uid(), 'marketing_campaign_status_changed', 'Campaign "' || v_row.name || '" moved to ' || p_new_status || '.', 'client_marketing_campaign', v_row.id, jsonb_build_object('previous_status', v_row.status, 'new_status', p_new_status));
end; $$;

revoke all on function public.create_marketing_campaign(uuid,text,text,uuid,uuid,date,date) from public, anon;
revoke all on function public.update_marketing_campaign_status(uuid,text) from public, anon;
grant execute on function public.create_marketing_campaign(uuid,text,text,uuid,uuid,date,date) to authenticated, service_role;
grant execute on function public.update_marketing_campaign_status(uuid,text) to authenticated, service_role;
