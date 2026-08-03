-- Programme Stage C2: controlled research runs and immutable playbook authority.
-- public.playbooks keeps its mutable pointer columns; generation authority is a
-- frozen playbook_versions row identified by content hash.

create table public.client_research_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  research_domain text not null,
  status text not null default 'running',
  idempotency_key text not null,
  provider text,
  model text,
  prompt_digest text,
  configuration_snapshot jsonb not null default '{}'::jsonb,
  source_count integer not null default 0,
  attempt_count integer not null default 1,
  maximum_attempts integer not null default 3,
  retryable boolean not null default false,
  lease_owner text,
  lease_expires_at timestamptz,
  failure_code text,
  failure_message text,
  completed_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_research_runs_domain_check
    check (research_domain in ('business','market','competitors','customer_language','category_regulation','market_conditions')),
  constraint client_research_runs_status_check check (status in ('running','retryable','failed','completed','cancelled')),
  constraint client_research_runs_idempotency_check check (length(idempotency_key) between 1 and 160),
  constraint client_research_runs_digest_check check (prompt_digest is null or prompt_digest ~ '^[0-9a-f]{64}$'),
  constraint client_research_runs_attempts_check check (attempt_count >= 1 and maximum_attempts >= 1 and attempt_count <= maximum_attempts),
  constraint client_research_runs_failure_check check (status <> 'failed' or failure_code is not null),
  constraint client_research_runs_completed_check check ((status = 'completed') = (completed_at is not null)),
  constraint client_research_runs_idempotency_unique unique (client_id, idempotency_key)
);
create index client_research_runs_client_domain_idx on public.client_research_runs (client_id, research_domain);

create table public.client_research_sources (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  research_run_id uuid not null references public.client_research_runs(id) on delete cascade,
  url text not null,
  title text not null,
  publisher text,
  retrieved_at timestamptz not null,
  evidence_kind text not null,
  evidence_text text not null,
  confidence text not null,
  use_restriction text not null default 'review_required',
  created_at timestamptz not null default now(),
  constraint client_research_sources_url_check check (length(url) between 1 and 2000),
  constraint client_research_sources_title_check check (length(title) between 1 and 500),
  constraint client_research_sources_evidence_kind_check check (evidence_kind in ('quoted','paraphrased')),
  constraint client_research_sources_evidence_check check (length(evidence_text) between 1 and 20000),
  constraint client_research_sources_confidence_check check (confidence in ('low','medium','high')),
  constraint client_research_sources_restriction_check check (use_restriction in ('unrestricted','attribution_required','review_required','do_not_publish'))
);
create index client_research_sources_run_idx on public.client_research_sources (research_run_id);
create index client_research_sources_client_idx on public.client_research_sources (client_id);

create table public.playbook_versions (
  id uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references public.playbooks(id) on delete cascade,
  version integer not null,
  content_md text not null,
  content_hash text not null,
  status text not null default 'draft',
  published_at timestamptz,
  published_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint playbook_versions_version_check check (version >= 1),
  constraint playbook_versions_hash_check check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint playbook_versions_status_check check (status in ('draft','active','superseded')),
  constraint playbook_versions_published_check check ((status = 'active') = (published_at is not null and published_by is not null)),
  constraint playbook_versions_unique unique (playbook_id, version)
);
create unique index playbook_versions_single_active on public.playbook_versions (playbook_id) where status = 'active';

create trigger client_research_runs_updated_at before update on public.client_research_runs for each row execute function public.set_updated_at();
create trigger playbook_versions_updated_at before update on public.playbook_versions for each row execute function public.set_updated_at();

alter table public.client_research_runs enable row level security;
alter table public.client_research_sources enable row level security;
alter table public.playbook_versions enable row level security;
revoke all on public.client_research_runs from public, anon, authenticated;
revoke all on public.client_research_sources from public, anon, authenticated;
revoke all on public.playbook_versions from public, anon, authenticated;
grant select on public.client_research_runs to authenticated;
grant select on public.client_research_sources to authenticated;
grant select on public.playbook_versions to authenticated;
grant all on public.client_research_runs to service_role;
grant all on public.client_research_sources to service_role;
grant all on public.playbook_versions to service_role;
create policy client_research_runs_select on public.client_research_runs for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_research_sources_select on public.client_research_sources for select to authenticated using (client_id = any(public.auth_client_ids()));
-- Playbooks are AA methodology, not client data: role-scoped, active version only.
create policy playbook_versions_select on public.playbook_versions for select to authenticated using (status = 'active');
