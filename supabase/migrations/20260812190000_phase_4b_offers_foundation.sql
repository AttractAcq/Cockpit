-- Phase 4B: Offers foundation.
--
-- Offers is separate from Campaign Intelligence and Ideation:
-- Main Offers define the underlying commercial engine.
-- Seasonal Offers adapt/package offers around approved Campaign Intelligence periods.
-- Neither table creates content ideas.

alter table public.client_research_runs
  drop constraint if exists client_research_runs_domain_check;

alter table public.client_research_runs
  add constraint client_research_runs_domain_check check (research_domain in (
    'business',
    'market',
    'competitors',
    'customer_language',
    'category_regulation',
    'market_conditions',
    'avatar',
    'competitor',
    'association',
    'brand_strategist',
    'campaign_intelligence',
    'offer_system'
  ));

create table public.client_offer_architecture_releases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  version integer not null,
  status text not null default 'draft',
  research_run_id uuid,
  title text not null,
  summary text not null default '',
  authority_snapshot jsonb not null default '{}'::jsonb,
  generated_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  superseded_at timestamptz,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_offer_arch_releases_run_client_fk foreign key (research_run_id, client_id)
    references public.client_research_runs(id, client_id) on delete restrict,
  constraint client_offer_arch_releases_status_check check (status in (
    'draft','needs_review','approved','superseded','archived'
  )),
  constraint client_offer_arch_releases_version_check check (version >= 1),
  constraint client_offer_arch_releases_summary_check check (length(summary) <= 5000),
  constraint client_offer_arch_releases_authority_snapshot_check check (jsonb_typeof(authority_snapshot) = 'object'),
  constraint client_offer_arch_releases_client_version_unique unique (client_id, version),
  constraint client_offer_arch_releases_id_client_unique unique (id, client_id)
);

create index client_offer_arch_releases_client_status_idx
  on public.client_offer_architecture_releases (client_id, status, created_at desc);

create table public.client_main_offers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  release_id uuid not null,
  offer_key text not null,
  offer_name text not null,
  offer_role text not null,
  offer_stage text not null default 'foundational',
  customer_segment text not null default '',
  problem_addressed text not null default '',
  promised_outcome text not null default '',
  mechanism text not null default '',
  dream_outcome text not null default '',
  perceived_likelihood text not null default '',
  time_delay text not null default '',
  effort_sacrifice text not null default '',
  price_risk_friction text not null default '',
  value_stack text[] not null default '{}'::text[],
  bonus_stack text[] not null default '{}'::text[],
  risk_reversal text not null default '',
  guarantee text not null default '',
  pricing_model text not null default '',
  delivery_model text not null default '',
  eligibility text not null default '',
  proof_requirements text not null default '',
  offer_sequence_note text not null default '',
  money_model_notes text not null default '',
  constraints text not null default '',
  payload jsonb not null default '{}'::jsonb,
  display_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_main_offers_release_client_fk foreign key (release_id, client_id)
    references public.client_offer_architecture_releases(id, client_id) on delete cascade,
  constraint client_main_offers_key_check check (length(trim(offer_key)) between 1 and 120),
  constraint client_main_offers_role_check check (offer_role in (
    'core_front_end','upsell','downsell','continuity','recurring','cross_sell','other'
  )),
  constraint client_main_offers_stage_check check (offer_stage in (
    'foundational','ascension','retention','reactivation','other'
  )),
  constraint client_main_offers_order_check check (display_order >= 1),
  constraint client_main_offers_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint client_main_offers_release_key_unique unique (release_id, offer_key),
  constraint client_main_offers_release_order_unique unique (release_id, display_order),
  constraint client_main_offers_id_client_unique unique (id, client_id)
);

create index client_main_offers_release_idx
  on public.client_main_offers (release_id, display_order);

create table public.client_money_model_components (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  release_id uuid not null,
  component_key text not null,
  component_type text not null,
  title text not null,
  description text not null default '',
  trigger_condition text not null default '',
  commercial_role text not null default '',
  dependency_note text not null default '',
  payload jsonb not null default '{}'::jsonb,
  display_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_money_model_release_client_fk foreign key (release_id, client_id)
    references public.client_offer_architecture_releases(id, client_id) on delete cascade,
  constraint client_money_model_key_check check (length(trim(component_key)) between 1 and 120),
  constraint client_money_model_type_check check (component_type in (
    'front_end','upsell','downsell','continuity','recurring_revenue','offer_sequence','monetization_mechanic','other'
  )),
  constraint client_money_model_order_check check (display_order >= 1),
  constraint client_money_model_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint client_money_model_release_key_unique unique (release_id, component_key),
  constraint client_money_model_release_order_unique unique (release_id, display_order),
  constraint client_money_model_id_client_unique unique (id, client_id)
);

create index client_money_model_release_idx
  on public.client_money_model_components (release_id, display_order);

create table public.client_seasonal_offer_releases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  version integer not null,
  status text not null default 'draft',
  research_run_id uuid,
  campaign_intelligence_release_id uuid,
  main_offer_release_id uuid,
  title text not null,
  summary text not null default '',
  authority_snapshot jsonb not null default '{}'::jsonb,
  generated_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  superseded_at timestamptz,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_seasonal_offer_releases_run_client_fk foreign key (research_run_id, client_id)
    references public.client_research_runs(id, client_id) on delete restrict,
  constraint client_seasonal_offer_campaign_release_fk foreign key (campaign_intelligence_release_id, client_id)
    references public.client_campaign_intelligence_releases(id, client_id) on delete restrict,
  constraint client_seasonal_offer_main_release_fk foreign key (main_offer_release_id, client_id)
    references public.client_offer_architecture_releases(id, client_id) on delete restrict,
  constraint client_seasonal_offer_releases_status_check check (status in (
    'draft','needs_review','approved','superseded','archived'
  )),
  constraint client_seasonal_offer_releases_version_check check (version >= 1),
  constraint client_seasonal_offer_releases_summary_check check (length(summary) <= 5000),
  constraint client_seasonal_offer_releases_authority_snapshot_check check (jsonb_typeof(authority_snapshot) = 'object'),
  constraint client_seasonal_offer_releases_client_version_unique unique (client_id, version),
  constraint client_seasonal_offer_releases_id_client_unique unique (id, client_id)
);

create index client_seasonal_offer_releases_client_status_idx
  on public.client_seasonal_offer_releases (client_id, status, created_at desc);

create table public.client_seasonal_offers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  release_id uuid not null,
  campaign_period_id uuid not null,
  main_offer_id uuid,
  seasonal_offer_key text not null,
  title text not null,
  campaign_period_title text not null default '',
  offer_angle text not null default '',
  packaging_direction text not null default '',
  urgency_driver text not null default '',
  bonus_direction text not null default '',
  positioning_direction text not null default '',
  mechanism_direction text not null default '',
  reason_to_act_now text not null default '',
  cta_direction text not null default '',
  offer_risk text not null default '',
  constraints text not null default '',
  payload jsonb not null default '{}'::jsonb,
  display_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_seasonal_offers_release_client_fk foreign key (release_id, client_id)
    references public.client_seasonal_offer_releases(id, client_id) on delete cascade,
  constraint client_seasonal_offers_period_client_fk foreign key (campaign_period_id, client_id)
    references public.client_campaign_periods(id, client_id) on delete restrict,
  constraint client_seasonal_offers_main_offer_client_fk foreign key (main_offer_id, client_id)
    references public.client_main_offers(id, client_id) on delete restrict,
  constraint client_seasonal_offers_key_check check (length(trim(seasonal_offer_key)) between 1 and 120),
  constraint client_seasonal_offers_order_check check (display_order >= 1),
  constraint client_seasonal_offers_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint client_seasonal_offers_release_key_unique unique (release_id, seasonal_offer_key),
  constraint client_seasonal_offers_release_order_unique unique (release_id, display_order),
  constraint client_seasonal_offers_id_client_unique unique (id, client_id)
);

create index client_seasonal_offers_release_idx
  on public.client_seasonal_offers (release_id, display_order);
create index client_seasonal_offers_period_idx
  on public.client_seasonal_offers (campaign_period_id);

create table public.client_offer_approval_decisions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  release_kind text not null,
  release_id uuid not null,
  decision text not null,
  previous_status text not null,
  resulting_status text not null,
  note text,
  decided_by uuid not null,
  decided_at timestamptz not null default now(),
  constraint client_offer_decisions_release_kind_check check (release_kind in (
    'main_offers','seasonal_offers'
  )),
  constraint client_offer_decisions_decision_check check (decision in (
    'approved','changes_requested','rejected'
  ))
);

create index client_offer_decisions_release_idx
  on public.client_offer_approval_decisions (client_id, release_kind, release_id, decided_at desc);

create table public.client_offer_architecture_active_releases (
  client_id uuid primary key references public.clients(id) on delete cascade,
  release_id uuid not null,
  activated_by uuid not null,
  activated_at timestamptz not null default now(),
  constraint client_offer_arch_active_release_fk foreign key (release_id, client_id)
    references public.client_offer_architecture_releases(id, client_id) on delete restrict
);

create table public.client_seasonal_offer_active_releases (
  client_id uuid primary key references public.clients(id) on delete cascade,
  release_id uuid not null,
  activated_by uuid not null,
  activated_at timestamptz not null default now(),
  constraint client_seasonal_offer_active_release_fk foreign key (release_id, client_id)
    references public.client_seasonal_offer_releases(id, client_id) on delete restrict
);

create trigger client_offer_arch_releases_updated_at before update on public.client_offer_architecture_releases
  for each row execute function public.set_updated_at();
create trigger client_main_offers_updated_at before update on public.client_main_offers
  for each row execute function public.set_updated_at();
create trigger client_money_model_components_updated_at before update on public.client_money_model_components
  for each row execute function public.set_updated_at();
create trigger client_seasonal_offer_releases_updated_at before update on public.client_seasonal_offer_releases
  for each row execute function public.set_updated_at();
create trigger client_seasonal_offers_updated_at before update on public.client_seasonal_offers
  for each row execute function public.set_updated_at();

create or replace function public.prevent_approved_main_offer_mutation()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_status text;
  v_release_id uuid;
begin
  v_release_id := coalesce(old.release_id, new.release_id);
  select status into v_status from public.client_offer_architecture_releases where id = v_release_id;
  if v_status in ('approved','superseded','archived') then
    raise exception 'IMMUTABLE: approved main offer releases cannot be changed';
  end if;
  return coalesce(new, old);
end; $$;

create or replace function public.prevent_approved_seasonal_offer_mutation()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_status text;
  v_release_id uuid;
begin
  v_release_id := coalesce(old.release_id, new.release_id);
  select status into v_status from public.client_seasonal_offer_releases where id = v_release_id;
  if v_status in ('approved','superseded','archived') then
    raise exception 'IMMUTABLE: approved seasonal offer releases cannot be changed';
  end if;
  return coalesce(new, old);
end; $$;

create trigger client_main_offers_release_guard
  before insert or update or delete on public.client_main_offers
  for each row execute function public.prevent_approved_main_offer_mutation();
create trigger client_money_model_release_guard
  before insert or update or delete on public.client_money_model_components
  for each row execute function public.prevent_approved_main_offer_mutation();
create trigger client_seasonal_offers_release_guard
  before insert or update or delete on public.client_seasonal_offers
  for each row execute function public.prevent_approved_seasonal_offer_mutation();

create or replace function public.review_offer_architecture_release(
  p_release_id uuid,
  p_decision text,
  p_note text default null
) returns public.client_offer_architecture_releases
language plpgsql security definer set search_path = '' as $$
declare
  v_release public.client_offer_architecture_releases;
  v_previous public.client_offer_architecture_releases;
  v_resulting_status text;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then
    raise exception 'AUTH: staff role required';
  end if;
  if p_decision not in ('approved','changes_requested','rejected') then
    raise exception 'VALIDATION: invalid approval decision';
  end if;

  select * into v_release
  from public.client_offer_architecture_releases
  where id = p_release_id
  for update;

  if not found then raise exception 'NOT_FOUND: main offers release'; end if;
  if not (v_release.client_id = any(public.auth_client_ids())) then
    raise exception 'AUTH: client access required';
  end if;
  if v_release.status <> 'needs_review' then
    raise exception 'VALIDATION: release must be awaiting review';
  end if;

  if p_decision = 'approved' then
    if not exists (
      select 1 from public.client_main_offers offer
      where offer.release_id = v_release.id and offer.client_id = v_release.client_id
    ) then
      raise exception 'VALIDATION: release has no main offers';
    end if;
    v_resulting_status := 'approved';
    update public.client_offer_architecture_releases
    set status = 'approved', approved_at = now()
    where id = v_release.id
    returning * into v_release;

    select release.* into v_previous
    from public.client_offer_architecture_active_releases active
    join public.client_offer_architecture_releases release on release.id = active.release_id
    where active.client_id = v_release.client_id
      and active.release_id <> v_release.id
    for update of release;

    if found then
      update public.client_offer_architecture_releases
      set status = 'superseded', superseded_at = now()
      where id = v_previous.id;
    end if;

    insert into public.client_offer_architecture_active_releases (
      client_id, release_id, activated_by, activated_at
    ) values (
      v_release.client_id, v_release.id, auth.uid(), now()
    ) on conflict (client_id) do update set
      release_id = excluded.release_id,
      activated_by = excluded.activated_by,
      activated_at = excluded.activated_at;
  elsif p_decision = 'changes_requested' then
    v_resulting_status := 'draft';
    update public.client_offer_architecture_releases
    set status = 'draft', submitted_at = null
    where id = v_release.id
    returning * into v_release;
  else
    v_resulting_status := 'archived';
    update public.client_offer_architecture_releases
    set status = 'archived', archived_at = now()
    where id = v_release.id
    returning * into v_release;
  end if;

  insert into public.client_offer_approval_decisions (
    client_id, release_kind, release_id, decision, previous_status, resulting_status, note, decided_by
  ) values (
    v_release.client_id, 'main_offers', v_release.id, p_decision, 'needs_review', v_resulting_status,
    nullif(trim(coalesce(p_note, '')), ''), auth.uid()
  );

  insert into public.activity_log (
    client_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    v_release.client_id, auth.uid(), 'main_offers.reviewed',
    'client_offer_architecture_releases', v_release.id,
    jsonb_build_object('decision', p_decision, 'resulting_status', v_resulting_status)
  );

  return v_release;
end; $$;

create or replace function public.review_seasonal_offer_release(
  p_release_id uuid,
  p_decision text,
  p_note text default null
) returns public.client_seasonal_offer_releases
language plpgsql security definer set search_path = '' as $$
declare
  v_release public.client_seasonal_offer_releases;
  v_previous public.client_seasonal_offer_releases;
  v_resulting_status text;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then
    raise exception 'AUTH: staff role required';
  end if;
  if p_decision not in ('approved','changes_requested','rejected') then
    raise exception 'VALIDATION: invalid approval decision';
  end if;

  select * into v_release
  from public.client_seasonal_offer_releases
  where id = p_release_id
  for update;

  if not found then raise exception 'NOT_FOUND: seasonal offers release'; end if;
  if not (v_release.client_id = any(public.auth_client_ids())) then
    raise exception 'AUTH: client access required';
  end if;
  if v_release.status <> 'needs_review' then
    raise exception 'VALIDATION: release must be awaiting review';
  end if;

  if p_decision = 'approved' then
    if not exists (
      select 1 from public.client_seasonal_offers offer
      where offer.release_id = v_release.id and offer.client_id = v_release.client_id
    ) then
      raise exception 'VALIDATION: release has no seasonal offers';
    end if;
    v_resulting_status := 'approved';
    update public.client_seasonal_offer_releases
    set status = 'approved', approved_at = now()
    where id = v_release.id
    returning * into v_release;

    select release.* into v_previous
    from public.client_seasonal_offer_active_releases active
    join public.client_seasonal_offer_releases release on release.id = active.release_id
    where active.client_id = v_release.client_id
      and active.release_id <> v_release.id
    for update of release;

    if found then
      update public.client_seasonal_offer_releases
      set status = 'superseded', superseded_at = now()
      where id = v_previous.id;
    end if;

    insert into public.client_seasonal_offer_active_releases (
      client_id, release_id, activated_by, activated_at
    ) values (
      v_release.client_id, v_release.id, auth.uid(), now()
    ) on conflict (client_id) do update set
      release_id = excluded.release_id,
      activated_by = excluded.activated_by,
      activated_at = excluded.activated_at;
  elsif p_decision = 'changes_requested' then
    v_resulting_status := 'draft';
    update public.client_seasonal_offer_releases
    set status = 'draft', submitted_at = null
    where id = v_release.id
    returning * into v_release;
  else
    v_resulting_status := 'archived';
    update public.client_seasonal_offer_releases
    set status = 'archived', archived_at = now()
    where id = v_release.id
    returning * into v_release;
  end if;

  insert into public.client_offer_approval_decisions (
    client_id, release_kind, release_id, decision, previous_status, resulting_status, note, decided_by
  ) values (
    v_release.client_id, 'seasonal_offers', v_release.id, p_decision, 'needs_review', v_resulting_status,
    nullif(trim(coalesce(p_note, '')), ''), auth.uid()
  );

  insert into public.activity_log (
    client_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    v_release.client_id, auth.uid(), 'seasonal_offers.reviewed',
    'client_seasonal_offer_releases', v_release.id,
    jsonb_build_object('decision', p_decision, 'resulting_status', v_resulting_status)
  );

  return v_release;
end; $$;

alter table public.client_offer_architecture_releases enable row level security;
alter table public.client_main_offers enable row level security;
alter table public.client_money_model_components enable row level security;
alter table public.client_seasonal_offer_releases enable row level security;
alter table public.client_seasonal_offers enable row level security;
alter table public.client_offer_approval_decisions enable row level security;
alter table public.client_offer_architecture_active_releases enable row level security;
alter table public.client_seasonal_offer_active_releases enable row level security;

revoke all on
  public.client_offer_architecture_releases,
  public.client_main_offers,
  public.client_money_model_components,
  public.client_seasonal_offer_releases,
  public.client_seasonal_offers,
  public.client_offer_approval_decisions,
  public.client_offer_architecture_active_releases,
  public.client_seasonal_offer_active_releases
from public, anon, authenticated;

grant select on
  public.client_offer_architecture_releases,
  public.client_main_offers,
  public.client_money_model_components,
  public.client_seasonal_offer_releases,
  public.client_seasonal_offers,
  public.client_offer_approval_decisions,
  public.client_offer_architecture_active_releases,
  public.client_seasonal_offer_active_releases
to authenticated;

grant all on
  public.client_offer_architecture_releases,
  public.client_main_offers,
  public.client_money_model_components,
  public.client_seasonal_offer_releases,
  public.client_seasonal_offers,
  public.client_offer_approval_decisions,
  public.client_offer_architecture_active_releases,
  public.client_seasonal_offer_active_releases
to service_role;

create policy client_offer_arch_releases_select on public.client_offer_architecture_releases
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_main_offers_select on public.client_main_offers
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_money_model_components_select on public.client_money_model_components
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_seasonal_offer_releases_select on public.client_seasonal_offer_releases
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_seasonal_offers_select on public.client_seasonal_offers
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_offer_decisions_select on public.client_offer_approval_decisions
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_offer_arch_active_select on public.client_offer_architecture_active_releases
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_seasonal_offer_active_select on public.client_seasonal_offer_active_releases
  for select to authenticated using (client_id = any(public.auth_client_ids()));

revoke all on function public.review_offer_architecture_release(uuid,text,text) from public, anon;
revoke all on function public.review_seasonal_offer_release(uuid,text,text) from public, anon;
grant execute on function public.review_offer_architecture_release(uuid,text,text) to authenticated, service_role;
grant execute on function public.review_seasonal_offer_release(uuid,text,text) to authenticated, service_role;

comment on table public.client_offer_architecture_releases is
  'Versioned Main Offers authority. Defines the commercial engine and money model; does not generate campaign periods or content ideas.';
comment on table public.client_main_offers is
  'Foundational offers, upsells, downsells, continuity offers and related core commercial packaging.';
comment on table public.client_money_model_components is
  'Money Model mechanics attached to an approved Main Offers release.';
comment on table public.client_seasonal_offer_releases is
  'Versioned Seasonal Offers authority informed by approved Campaign Intelligence and optionally approved Main Offers.';
comment on table public.client_seasonal_offers is
  'Contextual packaging for campaign moments. Ideation may consume approved rows but is not controlled exclusively by them.';
