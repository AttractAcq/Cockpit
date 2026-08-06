-- Programme Stage E3: explicit per-technique source strategy for the existing
-- seven-technique Ideation system. The technique manifest, runs and candidates
-- are preserved and unaltered. Rows are AA methodology, not client data, so the
-- table is intentionally left EMPTY for Alex to populate; seeding invented
-- research methods or cost limits would be fabricated authority.

create table public.ideation_technique_strategies (
  id uuid primary key default gen_random_uuid(),
  technique_slug text not null,
  strategy_version integer not null default 1,
  status text not null default 'draft',
  required_inputs jsonb not null default '[]'::jsonb,
  research_method text not null,
  evidence_contract jsonb not null default '{}'::jsonb,
  freshness_max_age_days integer not null,
  candidate_contract jsonb not null default '{}'::jsonb,
  failure_behaviour text not null,
  cost_limit_usd numeric(10,4),
  cost_limit_calls integer,
  content_hash text not null,
  published_at timestamptz,
  published_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ideation_technique_strategies_slug_check check (length(technique_slug) between 1 and 100),
  constraint ideation_technique_strategies_version_check check (strategy_version >= 1),
  constraint ideation_technique_strategies_status_check check (status in ('draft','active','superseded')),
  constraint ideation_technique_strategies_jsonb_check
    check (jsonb_typeof(required_inputs) = 'array'
      and jsonb_typeof(evidence_contract) = 'object'
      and jsonb_typeof(candidate_contract) = 'object'),
  constraint ideation_technique_strategies_freshness_check check (freshness_max_age_days > 0),
  constraint ideation_technique_strategies_failure_check
    check (failure_behaviour in ('fail_closed','skip_technique','retry_then_fail')),
  constraint ideation_technique_strategies_cost_check
    check (cost_limit_usd is null or cost_limit_usd > 0),
  constraint ideation_technique_strategies_hash_check check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint ideation_technique_strategies_published_check
    check ((status = 'active') = (published_at is not null and published_by is not null)),
  constraint ideation_technique_strategies_unique unique (technique_slug, strategy_version)
);
create unique index ideation_technique_strategies_single_active
  on public.ideation_technique_strategies (technique_slug) where status = 'active';

create trigger ideation_technique_strategies_updated_at before update on public.ideation_technique_strategies for each row execute function public.set_updated_at();

alter table public.ideation_technique_strategies enable row level security;
revoke all on public.ideation_technique_strategies from public, anon, authenticated;
grant select on public.ideation_technique_strategies to authenticated;
grant all on public.ideation_technique_strategies to service_role;
create policy ideation_technique_strategies_select on public.ideation_technique_strategies for select to authenticated using (status = 'active');

comment on table public.ideation_technique_strategies is 'Stage E3: required inputs, research method, evidence contract, freshness, candidate contract, failure behaviour and cost limit per Ideation technique. AA methodology, not client data - role-scoped, active version only.';
