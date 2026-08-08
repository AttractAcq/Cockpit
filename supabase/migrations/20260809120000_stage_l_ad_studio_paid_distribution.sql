-- Programme Stage L — Ad Studio and Paid Distribution.
--
-- Additive only. Preserves ads_master/ad_creative (Stage B-era content-
-- planning rows, read/written by MastersPanel/Phase3CalendarPanel/Reel
-- Studio's source-row picker) completely untouched -- they remain what they
-- always were: planning metadata, not campaign execution objects. This
-- migration adds the canonical paid-content spine the Cockpit build plan
-- describes: Ad Opportunity -> Ad Brief -> Creative Matrix -> Campaign ->
-- Ad Set -> Ad, plus the per-client safety policy every launch is gated by
-- and an audit trail of every campaign-affecting action.
--
-- The dead `meta-ad-ops` edge function (targets a `campaigns`/`entities`
-- schema that does not exist in this database -- see CLAUDE.md) is left
-- alone by this migration; it is superseded by real functions in this
-- stage and should be considered retired, not extended.

-- ---------------------------------------------------------------------------
-- ad_opportunities — where a paid idea comes from, mirroring
-- content_opportunities' origin/status shape but with the 8 origins Stage L
-- names, including promotion from an existing organic Content Opportunity.
-- ---------------------------------------------------------------------------

create table if not exists public.ad_opportunities (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  origin text not null,
  promoted_from_content_opportunity_id uuid references public.content_opportunities(id) on delete set null,
  status text not null default 'identified',
  core_claim text,
  offer_ref text,
  notes text,
  generated_by text not null default 'manual',
  rejected_reason text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_opportunities_title_check check (length(title) >= 1 and length(title) <= 400),
  constraint ad_opportunities_origin_check check (origin in (
    'manual_idea', 'proof', 'research', 'campaign_requirement',
    'organic_winner', 'performance_insight', 'offer_launch', 'seasonal_trigger'
  )),
  constraint ad_opportunities_status_check check (status in (
    'identified', 'shortlisted', 'selected', 'rejected', 'expired'
  )),
  constraint ad_opportunities_generated_by_check check (generated_by in ('manual', 'ai')),
  constraint ad_opportunities_rejected_check check ((status = 'rejected') = (rejected_reason is not null)),
  constraint ad_opportunities_organic_winner_check check (
    origin <> 'organic_winner' or promoted_from_content_opportunity_id is not null
  )
);

create index if not exists ad_opportunities_client_idx on public.ad_opportunities (client_id);

drop trigger if exists ad_opportunities_updated_at on public.ad_opportunities;
create trigger ad_opportunities_updated_at before update on public.ad_opportunities
  for each row execute function public.set_updated_at();

alter table public.ad_opportunities enable row level security;
revoke all on public.ad_opportunities from public, anon, authenticated;
grant select on public.ad_opportunities to authenticated;
grant all on public.ad_opportunities to service_role;
drop policy if exists ad_opportunities_select on public.ad_opportunities;
create policy ad_opportunities_select on public.ad_opportunities
  for select to authenticated using (client_id = any(public.auth_client_ids()));

-- ---------------------------------------------------------------------------
-- ad_briefs — the Ad Brief contract. Same 4-state lifecycle as content_briefs
-- (Stage H precedent: draft/in_review/approved/superseded), structured body.
-- ---------------------------------------------------------------------------

create table if not exists public.ad_briefs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ad_opportunity_id uuid not null references public.ad_opportunities(id) on delete cascade,
  brief_version integer not null default 1,
  status text not null default 'draft',
  body jsonb not null,
  rendered_markdown text,
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_briefs_version_check check (brief_version >= 1),
  constraint ad_briefs_version_unique unique (ad_opportunity_id, brief_version),
  constraint ad_briefs_status_check check (status in ('draft', 'in_review', 'approved', 'superseded')),
  constraint ad_briefs_body_check check (jsonb_typeof(body) = 'object'),
  constraint ad_briefs_approval_check check ((status = 'approved') = (approved_by is not null and approved_at is not null))
);

create index if not exists ad_briefs_client_idx on public.ad_briefs (client_id);
create index if not exists ad_briefs_opportunity_idx on public.ad_briefs (ad_opportunity_id);

drop trigger if exists ad_briefs_updated_at on public.ad_briefs;
create trigger ad_briefs_updated_at before update on public.ad_briefs
  for each row execute function public.set_updated_at();

alter table public.ad_briefs enable row level security;
revoke all on public.ad_briefs from public, anon, authenticated;
grant select on public.ad_briefs to authenticated;
grant all on public.ad_briefs to service_role;
drop policy if exists ad_briefs_select on public.ad_briefs;
create policy ad_briefs_select on public.ad_briefs
  for select to authenticated using (client_id = any(public.auth_client_ids()));

-- ---------------------------------------------------------------------------
-- ad_creative_variants — the Hooks x Visuals x Copy x CTA x Format matrix.
-- One row per generated combination, always traceable back to which brief
-- index produced it (source provenance, never fabricated).
-- ---------------------------------------------------------------------------

create table if not exists public.ad_creative_variants (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ad_brief_id uuid not null references public.ad_briefs(id) on delete cascade,
  hook_index integer not null,
  visual_index integer not null,
  copy_index integer not null,
  cta_index integer not null,
  format text not null,
  hook_text text not null,
  visual_ref text not null,
  copy_text text not null,
  cta_text text not null,
  status text not null default 'draft',
  source_provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_creative_variants_indices_check check (
    hook_index >= 0 and visual_index >= 0 and copy_index >= 0 and cta_index >= 0
  ),
  constraint ad_creative_variants_status_check check (status in ('draft', 'approved', 'rejected')),
  constraint ad_creative_variants_unique unique (ad_brief_id, hook_index, visual_index, copy_index, cta_index, format)
);

create index if not exists ad_creative_variants_client_idx on public.ad_creative_variants (client_id);
create index if not exists ad_creative_variants_brief_idx on public.ad_creative_variants (ad_brief_id);

drop trigger if exists ad_creative_variants_updated_at on public.ad_creative_variants;
create trigger ad_creative_variants_updated_at before update on public.ad_creative_variants
  for each row execute function public.set_updated_at();

alter table public.ad_creative_variants enable row level security;
revoke all on public.ad_creative_variants from public, anon, authenticated;
grant select on public.ad_creative_variants to authenticated;
grant all on public.ad_creative_variants to service_role;
drop policy if exists ad_creative_variants_select on public.ad_creative_variants;
create policy ad_creative_variants_select on public.ad_creative_variants
  for select to authenticated using (client_id = any(public.auth_client_ids()));

-- ---------------------------------------------------------------------------
-- ad_budget_policies — the per-client safety policy every launch is gated
-- by. One row per client. No campaign may launch without one that approves
-- it (checked in application code, _shared/ad-safety-policy.ts).
-- ---------------------------------------------------------------------------

create table if not exists public.ad_budget_policies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ad_account_id text,
  ad_account_owner_verified boolean not null default false,
  payment_method_verified boolean not null default false,
  spend_limit_daily numeric,
  spend_limit_total numeric,
  requires_client_approval boolean not null default true,
  allowed_geographies jsonb not null default '[]'::jsonb,
  restricted_audience_flags jsonb not null default '[]'::jsonb,
  regulated_categories jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_budget_policies_client_unique unique (client_id),
  constraint ad_budget_policies_spend_limit_daily_check check (spend_limit_daily is null or spend_limit_daily >= 0),
  constraint ad_budget_policies_spend_limit_total_check check (spend_limit_total is null or spend_limit_total >= 0),
  constraint ad_budget_policies_geographies_check check (jsonb_typeof(allowed_geographies) = 'array'),
  constraint ad_budget_policies_audience_flags_check check (jsonb_typeof(restricted_audience_flags) = 'array'),
  constraint ad_budget_policies_regulated_categories_check check (jsonb_typeof(regulated_categories) = 'array')
);

drop trigger if exists ad_budget_policies_updated_at on public.ad_budget_policies;
create trigger ad_budget_policies_updated_at before update on public.ad_budget_policies
  for each row execute function public.set_updated_at();

alter table public.ad_budget_policies enable row level security;
revoke all on public.ad_budget_policies from public, anon, authenticated;
grant select on public.ad_budget_policies to authenticated;
grant all on public.ad_budget_policies to service_role;
drop policy if exists ad_budget_policies_select on public.ad_budget_policies;
create policy ad_budget_policies_select on public.ad_budget_policies
  for select to authenticated using (client_id = any(public.auth_client_ids()));

-- ---------------------------------------------------------------------------
-- ad_campaigns — the canonical Campaign. A state machine from draft through
-- to archived; external_campaign_id is only ever set after a REAL Meta
-- Marketing API success (never fabricated -- see _shared/meta-ads.ts).
-- idempotency_key blocks duplicate campaign creation the same way
-- production_jobs already does for Stage I production jobs.
-- ---------------------------------------------------------------------------

create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ad_brief_id uuid not null references public.ad_briefs(id) on delete cascade,
  idempotency_key text not null,
  name text not null,
  objective text not null,
  status text not null default 'draft',
  budget_daily numeric,
  budget_total numeric,
  attribution jsonb not null default '{}'::jsonb,
  client_approved_by uuid references public.users(id) on delete set null,
  client_approved_at timestamptz,
  external_campaign_id text,
  external_status text,
  spend_to_date numeric,
  impressions bigint,
  clicks bigint,
  conversions bigint,
  last_error text,
  launch_attempted_at timestamptz,
  last_reconciled_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_campaigns_idempotency_check check (length(idempotency_key) >= 1 and length(idempotency_key) <= 160),
  constraint ad_campaigns_idempotency_unique unique (client_id, idempotency_key),
  constraint ad_campaigns_status_check check (status in (
    'draft', 'pending_approval', 'approved', 'launching', 'active',
    'paused', 'completed', 'archived', 'failed'
  )),
  constraint ad_campaigns_budget_daily_check check (budget_daily is null or budget_daily >= 0),
  constraint ad_campaigns_budget_total_check check (budget_total is null or budget_total >= 0),
  constraint ad_campaigns_attribution_check check (jsonb_typeof(attribution) = 'object'),
  constraint ad_campaigns_client_approval_check check (
    client_approved_by is null or client_approved_at is not null
  )
);

create index if not exists ad_campaigns_client_idx on public.ad_campaigns (client_id);
create index if not exists ad_campaigns_brief_idx on public.ad_campaigns (ad_brief_id);

drop trigger if exists ad_campaigns_updated_at on public.ad_campaigns;
create trigger ad_campaigns_updated_at before update on public.ad_campaigns
  for each row execute function public.set_updated_at();

alter table public.ad_campaigns enable row level security;
revoke all on public.ad_campaigns from public, anon, authenticated;
grant select on public.ad_campaigns to authenticated;
grant all on public.ad_campaigns to service_role;
drop policy if exists ad_campaigns_select on public.ad_campaigns;
create policy ad_campaigns_select on public.ad_campaigns
  for select to authenticated using (client_id = any(public.auth_client_ids()));

-- ---------------------------------------------------------------------------
-- ad_sets
-- ---------------------------------------------------------------------------

create table if not exists public.ad_sets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ad_campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  name text not null,
  audience jsonb not null default '{}'::jsonb,
  placement jsonb not null default '[]'::jsonb,
  budget_daily numeric,
  status text not null default 'draft',
  external_ad_set_id text,
  external_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_sets_status_check check (status in ('draft', 'active', 'paused', 'archived', 'failed')),
  constraint ad_sets_budget_daily_check check (budget_daily is null or budget_daily >= 0),
  constraint ad_sets_audience_check check (jsonb_typeof(audience) = 'object'),
  constraint ad_sets_placement_check check (jsonb_typeof(placement) = 'array')
);

create index if not exists ad_sets_client_idx on public.ad_sets (client_id);
create index if not exists ad_sets_campaign_idx on public.ad_sets (ad_campaign_id);

drop trigger if exists ad_sets_updated_at on public.ad_sets;
create trigger ad_sets_updated_at before update on public.ad_sets
  for each row execute function public.set_updated_at();

alter table public.ad_sets enable row level security;
revoke all on public.ad_sets from public, anon, authenticated;
grant select on public.ad_sets to authenticated;
grant all on public.ad_sets to service_role;
drop policy if exists ad_sets_select on public.ad_sets;
create policy ad_sets_select on public.ad_sets
  for select to authenticated using (client_id = any(public.auth_client_ids()));

-- ---------------------------------------------------------------------------
-- ads — one per (Ad Set, Creative Variant). The unique constraint is what
-- makes "duplicate campaign creation is blocked" true one level down too:
-- the same variant can never be attached to the same Ad Set twice.
-- ---------------------------------------------------------------------------

create table if not exists public.ads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ad_set_id uuid not null references public.ad_sets(id) on delete cascade,
  ad_creative_variant_id uuid not null references public.ad_creative_variants(id) on delete cascade,
  name text not null,
  status text not null default 'draft',
  external_ad_id text,
  external_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ads_status_check check (status in ('draft', 'active', 'paused', 'archived', 'failed')),
  constraint ads_unique_variant_per_set unique (ad_set_id, ad_creative_variant_id)
);

create index if not exists ads_client_idx on public.ads (client_id);
create index if not exists ads_ad_set_idx on public.ads (ad_set_id);

drop trigger if exists ads_updated_at on public.ads;
create trigger ads_updated_at before update on public.ads
  for each row execute function public.set_updated_at();

alter table public.ads enable row level security;
revoke all on public.ads from public, anon, authenticated;
grant select on public.ads to authenticated;
grant all on public.ads to service_role;
drop policy if exists ads_select on public.ads;
create policy ads_select on public.ads
  for select to authenticated using (client_id = any(public.auth_client_ids()));

-- ---------------------------------------------------------------------------
-- ad_launch_attempts — audit trail of every campaign-affecting action,
-- mirroring client_publish_attempts' role for organic distribution.
-- ---------------------------------------------------------------------------

create table if not exists public.ad_launch_attempts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ad_campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  attempt_number integer not null,
  action text not null,
  result text not null,
  category text,
  message text,
  external_ids jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ad_launch_attempts_action_check check (action in (
    'create_campaign', 'create_ad_set', 'create_ad', 'launch', 'pause', 'resume',
    'update_budget', 'reconcile'
  )),
  constraint ad_launch_attempts_result_check check (result in ('success', 'blocked', 'failed')),
  constraint ad_launch_attempts_attempt_number_check check (attempt_number >= 1)
);

create index if not exists ad_launch_attempts_campaign_idx on public.ad_launch_attempts (ad_campaign_id);

alter table public.ad_launch_attempts enable row level security;
revoke all on public.ad_launch_attempts from public, anon, authenticated;
grant select on public.ad_launch_attempts to authenticated;
grant all on public.ad_launch_attempts to service_role;
drop policy if exists ad_launch_attempts_select on public.ad_launch_attempts;
create policy ad_launch_attempts_select on public.ad_launch_attempts
  for select to authenticated using (client_id = any(public.auth_client_ids()));
