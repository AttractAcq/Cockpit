-- Stage 5E: Avatar OS optional Ideation integration.
--
-- Ideation remains a hub. Approved Avatar OS authority can inform voice,
-- knowledge boundaries, reusable formats, and creative identity choices, but
-- avatar-led ideas are optional and never replace proof, manual ideas, campaign
-- context, offer context, or the seven research techniques.

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
    'approved_avatar_os',
    'external_research'
  ));

alter table public.client_ideation_authority_inputs
  add column if not exists avatar_component_id uuid;

alter table public.client_ideation_authority_inputs
  drop constraint if exists client_ideation_inputs_avatar_component_fk;

alter table public.client_ideation_authority_inputs
  add constraint client_ideation_inputs_avatar_component_fk
  foreign key (avatar_component_id, client_id)
  references public.client_avatar_components(id, client_id) on delete restrict;

alter table public.client_ideation_authority_inputs
  drop constraint if exists client_ideation_inputs_source_kind_check;

alter table public.client_ideation_authority_inputs
  add constraint client_ideation_inputs_source_kind_check
  check (source_kind in (
    'campaign_intelligence',
    'main_offer',
    'seasonal_offer',
    'avatar'
  ));

alter table public.client_ideation_authority_inputs
  drop constraint if exists client_ideation_inputs_kind_reference_check;

alter table public.client_ideation_authority_inputs
  add constraint client_ideation_inputs_kind_reference_check check (
    (source_kind = 'campaign_intelligence'
      and source_release_id is not null
      and campaign_period_id is not null
      and main_offer_id is null
      and seasonal_offer_id is null
      and avatar_component_id is null)
    or
    (source_kind = 'main_offer'
      and source_release_id is not null
      and campaign_period_id is null
      and main_offer_id is not null
      and seasonal_offer_id is null
      and avatar_component_id is null)
    or
    (source_kind = 'seasonal_offer'
      and source_release_id is not null
      and campaign_period_id is null
      and main_offer_id is null
      and seasonal_offer_id is not null
      and avatar_component_id is null)
    or
    (source_kind = 'avatar'
      and source_release_id is not null
      and campaign_period_id is null
      and main_offer_id is null
      and seasonal_offer_id is null
      and avatar_component_id is not null)
  );

create index if not exists client_ideation_inputs_avatar_component_idx
  on public.client_ideation_authority_inputs (avatar_component_id)
  where avatar_component_id is not null;

comment on table public.client_ideation_authority_inputs is
  'Approved Campaign Intelligence, Offer, and Avatar OS inputs consumed by an Ideation cycle. This is a hub bridge only; it does not require candidates to sell an offer, follow a campaign exclusively, or become avatar-led.';
