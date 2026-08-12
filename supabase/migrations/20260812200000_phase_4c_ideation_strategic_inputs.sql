-- Phase 4C: Ideation strategic input bridge.
--
-- Ideation remains a hub. Campaign Intelligence, Main Offers, and Seasonal
-- Offers are optional approved inputs that can shape the content mix without
-- turning Ideation into a campaign-only or offer-only generation pipeline.

alter table public.client_ideation_research_results
  drop constraint if exists client_ideation_research_source_type_check;

alter table public.client_ideation_research_results
  add constraint client_ideation_research_source_type_check
  check (source_type in (
    'approved_context',
    'approved_strategic_playbook',
    'approved_execution',
    'approved_intelligence',
    'approved_authority_bundle',
    'approved_campaign_intelligence',
    'approved_main_offer',
    'approved_seasonal_offer',
    'external_research'
  ));

create table public.client_ideation_authority_inputs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ideation_cycle_id uuid not null,
  source_kind text not null,
  source_release_id uuid,
  campaign_period_id uuid,
  main_offer_id uuid,
  seasonal_offer_id uuid,
  title text not null,
  summary text not null default '',
  source_url text not null,
  payload jsonb not null default '{}'::jsonb,
  display_order integer not null,
  created_at timestamptz not null default now(),
  constraint client_ideation_inputs_cycle_client_fk foreign key (ideation_cycle_id, client_id)
    references public.client_ideation_cycles(id, client_id) on delete cascade,
  constraint client_ideation_inputs_campaign_period_fk foreign key (campaign_period_id, client_id)
    references public.client_campaign_periods(id, client_id) on delete restrict,
  constraint client_ideation_inputs_main_offer_fk foreign key (main_offer_id, client_id)
    references public.client_main_offers(id, client_id) on delete restrict,
  constraint client_ideation_inputs_seasonal_offer_fk foreign key (seasonal_offer_id, client_id)
    references public.client_seasonal_offers(id, client_id) on delete restrict,
  constraint client_ideation_inputs_source_kind_check check (source_kind in (
    'campaign_intelligence','main_offer','seasonal_offer'
  )),
  constraint client_ideation_inputs_source_url_check
    check (length(source_url) between 1 and 2048 and source_url ~* '^aa-authority://'),
  constraint client_ideation_inputs_title_check check (length(trim(title)) between 1 and 300),
  constraint client_ideation_inputs_summary_check check (length(summary) <= 5000),
  constraint client_ideation_inputs_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint client_ideation_inputs_order_check check (display_order >= 1),
  constraint client_ideation_inputs_kind_reference_check check (
    (source_kind = 'campaign_intelligence'
      and source_release_id is not null
      and campaign_period_id is not null
      and main_offer_id is null
      and seasonal_offer_id is null)
    or
    (source_kind = 'main_offer'
      and source_release_id is not null
      and campaign_period_id is null
      and main_offer_id is not null
      and seasonal_offer_id is null)
    or
    (source_kind = 'seasonal_offer'
      and source_release_id is not null
      and campaign_period_id is null
      and main_offer_id is null
      and seasonal_offer_id is not null)
  ),
  constraint client_ideation_inputs_cycle_kind_order_unique
    unique (ideation_cycle_id, source_kind, display_order),
  constraint client_ideation_inputs_cycle_url_unique
    unique (ideation_cycle_id, source_url)
);

create index client_ideation_inputs_client_cycle_idx
  on public.client_ideation_authority_inputs (client_id, ideation_cycle_id, display_order);
create index client_ideation_inputs_campaign_period_idx
  on public.client_ideation_authority_inputs (campaign_period_id)
  where campaign_period_id is not null;
create index client_ideation_inputs_main_offer_idx
  on public.client_ideation_authority_inputs (main_offer_id)
  where main_offer_id is not null;
create index client_ideation_inputs_seasonal_offer_idx
  on public.client_ideation_authority_inputs (seasonal_offer_id)
  where seasonal_offer_id is not null;

alter table public.client_ideation_authority_inputs enable row level security;

revoke all on public.client_ideation_authority_inputs from public, anon, authenticated;
grant select on public.client_ideation_authority_inputs to authenticated;
grant all on public.client_ideation_authority_inputs to service_role;

create policy client_ideation_authority_inputs_select
  on public.client_ideation_authority_inputs for select to authenticated
  using (client_id = any(public.auth_client_ids()));

comment on table public.client_ideation_authority_inputs is
  'Approved Campaign Intelligence and Offer inputs consumed by an Ideation cycle. This is a hub bridge only; it does not require candidates to sell an offer or follow a campaign exclusively.';
