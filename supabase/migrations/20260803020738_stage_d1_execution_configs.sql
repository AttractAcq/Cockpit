-- Programme Stage D1: machine-executable Phase 2 authority.
-- Preserves the 11 Execution files, monthly generation and approval boundaries.
-- The Markdown remains human-readable authority; this adds the structured twin
-- and the reconciliation that proves the two do not contradict each other.

create table public.client_execution_configs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  execution_month text not null,
  config_version integer not null default 1,
  status text not null default 'draft',
  config jsonb not null default '{}'::jsonb,
  content_hash text not null,
  source_execution_file_ids jsonb not null default '[]'::jsonb,
  source_execution_files_hash text not null,
  reconciliation_status text not null default 'pending',
  reconciliation_ran_at timestamptz,
  generated_by_function text,
  provider text,
  model text,
  prompt_digest text,
  supersedes_config_id uuid references public.client_execution_configs(id) on delete set null,
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_execution_configs_month_check check (execution_month ~ '^[0-9]{4}-[0-9]{2}$'),
  constraint client_execution_configs_version_check check (config_version >= 1),
  constraint client_execution_configs_status_check
    check (status in ('draft','needs_review','approved','superseded','rejected')),
  constraint client_execution_configs_config_check check (jsonb_typeof(config) = 'object'),
  constraint client_execution_configs_sources_check check (jsonb_typeof(source_execution_file_ids) = 'array'),
  constraint client_execution_configs_hash_check
    check (content_hash ~ '^[0-9a-f]{64}$' and source_execution_files_hash ~ '^[0-9a-f]{64}$'),
  constraint client_execution_configs_reconciliation_check
    check (reconciliation_status in ('pending','passed','failed')),
  constraint client_execution_configs_reconciliation_ran_check
    check ((reconciliation_status = 'pending') = (reconciliation_ran_at is null)),
  -- Fails closed: approval is impossible unless reconciliation against the
  -- approved Execution Markdown has passed, and requires a human approver.
  constraint client_execution_configs_approval_check
    check (status <> 'approved'
      or (reconciliation_status = 'passed' and approved_by is not null and approved_at is not null)),
  constraint client_execution_configs_unique unique (client_id, execution_month, config_version)
);
create unique index client_execution_configs_single_approved
  on public.client_execution_configs (client_id, execution_month) where status = 'approved';
create index client_execution_configs_client_month_idx
  on public.client_execution_configs (client_id, execution_month);

create table public.client_execution_config_checks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  execution_config_id uuid not null references public.client_execution_configs(id) on delete cascade,
  check_code text not null,
  severity text not null default 'blocking',
  status text not null,
  expected_value text,
  actual_value text,
  detail text not null,
  source_execution_file_id uuid references public.client_execution_files(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint client_execution_config_checks_code_check check (length(check_code) between 1 and 120),
  constraint client_execution_config_checks_severity_check check (severity in ('info','warning','blocking')),
  constraint client_execution_config_checks_status_check check (status in ('pass','fail')),
  constraint client_execution_config_checks_detail_check check (length(detail) between 1 and 4000),
  constraint client_execution_config_checks_unique unique (execution_config_id, check_code)
);
create index client_execution_config_checks_config_idx
  on public.client_execution_config_checks (execution_config_id, status);

create trigger client_execution_configs_updated_at before update on public.client_execution_configs for each row execute function public.set_updated_at();

alter table public.client_execution_configs enable row level security;
alter table public.client_execution_config_checks enable row level security;
revoke all on public.client_execution_configs from public, anon, authenticated;
revoke all on public.client_execution_config_checks from public, anon, authenticated;
grant select on public.client_execution_configs to authenticated;
grant select on public.client_execution_config_checks to authenticated;
grant all on public.client_execution_configs to service_role;
grant all on public.client_execution_config_checks to service_role;
create policy client_execution_configs_select on public.client_execution_configs for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_execution_config_checks_select on public.client_execution_config_checks for select to authenticated using (client_id = any(public.auth_client_ids()));

comment on table public.client_execution_configs is 'Stage D: versioned machine-executable Phase 2 authority. Approval is impossible unless reconciliation against the approved Execution Markdown has passed.';
comment on table public.client_execution_config_checks is 'Stage D reconciliation results. Any blocking fail prevents the config reaching approved, so contradictory configuration fails closed.';
