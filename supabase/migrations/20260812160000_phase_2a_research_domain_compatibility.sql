-- Phase 2A compatibility: extend the preserved Stage C2 research-run domain.
--
-- client_research_runs remains the canonical execution table for both the
-- legacy research workflow and the Phase 2A intelligence operating systems.
-- The original Stage C2 check only knew its legacy domains, so the first run
-- for Avatar OS and later Phase 2A domains was rejected before orchestration
-- could create a draft release.

alter table public.client_research_runs
  drop constraint if exists client_research_runs_domain_check;

alter table public.client_research_runs
  add constraint client_research_runs_domain_check check (research_domain in (
    -- Preserved Stage C2 values.
    'business',
    'market',
    'competitors',
    'customer_language',
    'category_regulation',
    'market_conditions',
    -- Phase 2A execution values.
    'avatar',
    'competitor',
    'association',
    'brand_strategist'
  ));

comment on column public.client_research_runs.research_domain is
  'Execution/research capability identifier. Preserves Stage C2 values and supports every Phase 2A intelligence workflow.';
