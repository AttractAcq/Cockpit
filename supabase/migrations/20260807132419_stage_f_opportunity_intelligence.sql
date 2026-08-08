-- Programme Stage F — Content Opportunity Intelligence.
--
-- Additive only. Stage B already owns content_opportunities /
-- content_opportunity_sources as the canonical supply-pool tables; this
-- migration expands them with the rich Opportunity fields, eligibility and
-- deduplication tracking Stage F requires, and adds an append-only scoring
-- history table (re-scoring must never overwrite a prior score).
--
-- Nothing here removes or narrows an existing column, constraint or policy.

-- ---------------------------------------------------------------------------
-- content_opportunities: rich fields, eligibility, deduplication, provenance
-- ---------------------------------------------------------------------------

alter table public.content_opportunities
  add column core_claim text,
  add column hook_direction text,
  add column audience text,
  add column pain_or_objection text,
  add column belief_before text,
  add column belief_after text,
  add column objective text,
  add column offer_relationship text,
  add column funnel_stage text,
  add column candidate_formats text[] not null default '{}',
  add column candidate_channels text[] not null default '{}',
  add column cta_direction text,
  add column visual_potential smallint,
  add column production_requirements text,
  add column eligibility_status text not null default 'pending',
  add column eligibility_reason text,
  add column eligibility_checked_at timestamptz,
  add column duplicate_of_opportunity_id uuid references public.content_opportunities(id) on delete set null,
  add column dedup_reason text,
  add column generated_by text not null default 'manual',
  add column provider text,
  add column model text;

alter table public.content_opportunities
  add constraint content_opportunities_visual_potential_check
    check (visual_potential is null or visual_potential between 1 and 5),
  add constraint content_opportunities_eligibility_status_check
    check (eligibility_status in ('pending', 'eligible', 'ineligible')),
  add constraint content_opportunities_eligibility_reason_check
    check ((eligibility_status = 'ineligible') = (eligibility_reason is not null)),
  add constraint content_opportunities_generated_by_check
    check (generated_by in ('manual', 'ai')),
  add constraint content_opportunities_not_self_duplicate_check
    check (duplicate_of_opportunity_id is null or duplicate_of_opportunity_id <> id);

create index content_opportunities_duplicate_of_idx
  on public.content_opportunities (duplicate_of_opportunity_id)
  where duplicate_of_opportunity_id is not null;

create index content_opportunities_eligibility_idx
  on public.content_opportunities (client_id, eligibility_status);

-- ---------------------------------------------------------------------------
-- content_opportunity_scores — append-only scoring history.
--
-- Re-scoring inserts a new row; it never updates or deletes a prior one, so
-- the full scoring history for an Opportunity is always reconstructable.
-- content_opportunities.score / score_method are a denormalised pointer to
-- the latest row here, written by the calling Edge Function in the same
-- request as the insert below (not a trigger, so the computation stays
-- visible and testable in application code).
-- ---------------------------------------------------------------------------

create table public.content_opportunity_scores (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  content_opportunity_id uuid not null references public.content_opportunities(id) on delete cascade,
  strategic_fit numeric(5,2) not null,
  audience_relevance numeric(5,2) not null,
  proof_strength numeric(5,2) not null,
  commercial_relevance numeric(5,2) not null,
  novelty numeric(5,2) not null,
  timeliness numeric(5,2) not null,
  visual_potential numeric(5,2) not null,
  production_readiness numeric(5,2) not null,
  overall_score numeric(6,3) not null,
  score_method text not null,
  rationale text,
  strengths text[] not null default '{}',
  risks text[] not null default '{}',
  provider text,
  model text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint content_opportunity_scores_dimension_range_check
    check (
      strategic_fit between 0 and 100 and
      audience_relevance between 0 and 100 and
      proof_strength between 0 and 100 and
      commercial_relevance between 0 and 100 and
      novelty between 0 and 100 and
      timeliness between 0 and 100 and
      visual_potential between 0 and 100 and
      production_readiness between 0 and 100
    ),
  constraint content_opportunity_scores_overall_range_check
    check (overall_score between 0 and 100)
);

create index content_opportunity_scores_opportunity_idx
  on public.content_opportunity_scores (content_opportunity_id, created_at desc);

create index content_opportunity_scores_client_idx
  on public.content_opportunity_scores (client_id);

alter table public.content_opportunity_scores enable row level security;

revoke all on public.content_opportunity_scores from public, anon, authenticated;
grant select on public.content_opportunity_scores to authenticated;
grant all on public.content_opportunity_scores to service_role;

create policy content_opportunity_scores_select on public.content_opportunity_scores
  for select to authenticated using (client_id = any(public.auth_client_ids()));
