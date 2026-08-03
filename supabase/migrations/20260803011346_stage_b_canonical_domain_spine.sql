-- Programme Stage B: canonical architecture and data spine.
--
-- Additive only. This migration creates the shared domain model that every
-- later Programme stage must use. It creates NO trigger, view, or write path
-- into any existing operational table, and it removes nothing.
--
-- Frozen boundaries preserved (read-only to Stage B, not altered here):
-- - public.calendar_cells, public.organic_master, public.story_master,
--   public.ads_master, public.proof_master, public.asset_master;
-- - public.client_context_files and public.client_execution_files;
-- - public.client_production_briefs, public.client_assets,
--   public.client_distribution_records, public.client_analytics_records;
-- - all public.client_ideation_* tables (Ideation remains upstream and
--   advisory; Stage B does not consume or supersede it);
-- - all public.video_* Reel Studio tables.
--
-- Cutover discipline: these tables are created empty and have no callers yet.
-- Backfill, dual-write and contraction of legacy paths are later stages. A
-- table created here without a caller is expected at Stage B and is not
-- partial integration.
--
-- OWNERSHIP BOUNDARIES (canonical, may not be redefined by later stages):
-- - scheduled date          -> public.calendar_slots.scheduled_for
-- - format                  -> public.content_requirements.asset_format
--                              (calendar_slots and content_items inherit;
--                               they never independently declare format)
-- - source relationship     -> public.content_opportunity_sources and
--                              public.content_item_sources (join tables only)
-- - production status       -> public.production_jobs.status
-- - approval                -> public.content_items.status
--                              (asset_review -> approved is the only approval
--                               transition; no other table grants approval)
-- - distribution            -> public.client_distribution_records (existing,
--                              unchanged; content_items reference it, never
--                              duplicate it)
-- - analytics               -> public.content_performance
-- - authority provenance    -> context_version / execution_version columns,
--                              carried on every entity that originates work
--
-- STATUS MACHINES (enforced by check constraints; transition enforcement is
-- Stage B backend work, not schema-level triggers):
-- - content_opportunities: draft -> needs_review -> shortlisted -> selected
--   -> scheduled -> produced; draft|needs_review|shortlisted -> rejected;
--   draft|needs_review|shortlisted -> expired.
-- - content_items: planned -> brief_pending -> brief_review ->
--   production_ready -> in_production -> asset_review -> approved ->
--   scheduled -> published -> analysed -> iterated.

-- ---------------------------------------------------------------------------
-- Content Source
-- ---------------------------------------------------------------------------

create table public.content_sources (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source_kind text not null,
  external_ref text,
  title text not null,
  summary text,
  payload jsonb not null default '{}'::jsonb,
  context_version integer,
  execution_version integer,
  captured_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_sources_kind_check
    check (source_kind in ('manual_idea','proof_item','research_candidate',
                           'performance_insight')),
  constraint content_sources_title_check
    check (length(title) between 1 and 400),
  constraint content_sources_payload_check
    check (jsonb_typeof(payload) = 'object')
);

create index content_sources_client_idx on public.content_sources (client_id);
create index content_sources_kind_idx on public.content_sources (client_id, source_kind);

-- ---------------------------------------------------------------------------
-- Manual Idea / Proof Item  (typed detail tables; content_sources is the spine)
-- ---------------------------------------------------------------------------

create table public.manual_ideas (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  content_source_id uuid not null references public.content_sources(id) on delete cascade,
  body text not null,
  submitted_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manual_ideas_body_check check (length(body) between 1 and 20000),
  constraint manual_ideas_source_unique unique (content_source_id)
);

create index manual_ideas_client_idx on public.manual_ideas (client_id);

create table public.proof_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  content_source_id uuid not null references public.content_sources(id) on delete cascade,
  proof_kind text not null,
  claim text not null,
  evidence_ref text,
  -- Unsupported claims fail closed: a proof item is unusable until verified.
  verification_status text not null default 'unverified',
  verified_by uuid references public.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proof_items_kind_check
    check (proof_kind in ('testimonial','result','case_study','metric',
                          'credential','artefact')),
  constraint proof_items_claim_check check (length(claim) between 1 and 4000),
  constraint proof_items_verification_check
    check (verification_status in ('unverified','verified','rejected')),
  constraint proof_items_verified_consistency_check
    check ((verification_status = 'verified')
           = (verified_by is not null and verified_at is not null)),
  constraint proof_items_source_unique unique (content_source_id)
);

create index proof_items_client_idx on public.proof_items (client_id);

-- ---------------------------------------------------------------------------
-- Content Opportunity
-- ---------------------------------------------------------------------------

create table public.content_opportunities (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  angle text,
  rationale text,
  status text not null default 'draft',
  origin text not null,
  context_version integer,
  execution_version integer,
  score numeric(6,3),
  score_method text,
  expires_at timestamptz,
  rejected_reason text,
  selected_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_opportunities_title_check
    check (length(title) between 1 and 400),
  constraint content_opportunities_status_check
    check (status in ('draft','needs_review','shortlisted','selected',
                      'scheduled','produced','rejected','expired')),
  constraint content_opportunities_origin_check
    check (origin in ('manual','proof','research','performance')),
  constraint content_opportunities_rejected_check
    check ((status = 'rejected') = (rejected_reason is not null)),
  constraint content_opportunities_selected_check
    check (status not in ('selected','scheduled','produced')
           or selected_at is not null)
);

create index content_opportunities_client_status_idx
  on public.content_opportunities (client_id, status);

create table public.content_opportunity_sources (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  content_opportunity_id uuid not null
    references public.content_opportunities(id) on delete cascade,
  content_source_id uuid not null
    references public.content_sources(id) on delete restrict,
  contribution text,
  created_at timestamptz not null default now(),
  constraint content_opportunity_sources_unique
    unique (content_opportunity_id, content_source_id)
);

create index content_opportunity_sources_client_idx
  on public.content_opportunity_sources (client_id);

-- ---------------------------------------------------------------------------
-- Content Requirement  (owns format)  and Calendar Slot  (owns scheduled date)
-- ---------------------------------------------------------------------------

create table public.content_requirements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  asset_format text not null,
  channel text not null,
  required_count integer not null,
  fulfilled_count integer not null default 0,
  execution_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_requirements_period_check check (period_end >= period_start),
  constraint content_requirements_count_check
    check (required_count >= 0 and fulfilled_count >= 0
           and fulfilled_count <= required_count),
  constraint content_requirements_format_check
    check (length(asset_format) between 1 and 60),
  constraint content_requirements_channel_check
    check (length(channel) between 1 and 60)
);

create index content_requirements_client_period_idx
  on public.content_requirements (client_id, period_start, period_end);

create table public.calendar_slots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  content_requirement_id uuid not null
    references public.content_requirements(id) on delete restrict,
  -- Canonical owner of the scheduled date for the whole spine.
  scheduled_for date not null,
  slot_index integer not null default 0,
  status text not null default 'open',
  filled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_slots_status_check
    check (status in ('open','reserved','filled','cancelled')),
  constraint calendar_slots_index_check check (slot_index >= 0),
  constraint calendar_slots_filled_check
    check ((status = 'filled') = (filled_at is not null)),
  constraint calendar_slots_unique
    unique (content_requirement_id, scheduled_for, slot_index)
);

create index calendar_slots_client_date_idx
  on public.calendar_slots (client_id, scheduled_for);

-- ---------------------------------------------------------------------------
-- Content Item  (owns approval)
-- ---------------------------------------------------------------------------

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  content_opportunity_id uuid
    references public.content_opportunities(id) on delete set null,
  calendar_slot_id uuid references public.calendar_slots(id) on delete set null,
  title text not null,
  status text not null default 'planned',
  context_version integer,
  execution_version integer,
  -- Distribution remains owned by client_distribution_records; referenced only.
  distribution_record_id uuid
    references public.client_distribution_records(id) on delete set null,
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  published_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_items_title_check check (length(title) between 1 and 400),
  constraint content_items_status_check
    check (status in ('planned','brief_pending','brief_review',
                      'production_ready','in_production','asset_review',
                      'approved','scheduled','published','analysed','iterated')),
  -- Approval is never machine-set: approved and beyond requires a human.
  constraint content_items_approval_check
    check (status not in ('approved','scheduled','published','analysed','iterated')
           or (approved_by is not null and approved_at is not null)),
  constraint content_items_published_check
    check (status not in ('published','analysed','iterated')
           or published_at is not null)
);

create index content_items_client_status_idx
  on public.content_items (client_id, status);
create unique index content_items_calendar_slot_unique
  on public.content_items (calendar_slot_id)
  where calendar_slot_id is not null;

create table public.content_item_sources (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  content_source_id uuid not null references public.content_sources(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint content_item_sources_unique unique (content_item_id, content_source_id)
);

create index content_item_sources_client_idx on public.content_item_sources (client_id);

create table public.content_item_proof (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  proof_item_id uuid not null references public.proof_items(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint content_item_proof_unique unique (content_item_id, proof_item_id)
);

create index content_item_proof_client_idx on public.content_item_proof (client_id);

-- ---------------------------------------------------------------------------
-- Content Brief
-- ---------------------------------------------------------------------------

create table public.content_briefs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  brief_version integer not null default 1,
  status text not null default 'draft',
  body jsonb not null default '{}'::jsonb,
  context_version integer,
  execution_version integer,
  provider text,
  model text,
  prompt_digest text,
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_briefs_status_check
    check (status in ('draft','in_review','approved','superseded')),
  constraint content_briefs_version_check check (brief_version >= 1),
  constraint content_briefs_body_check check (jsonb_typeof(body) = 'object'),
  constraint content_briefs_digest_check
    check (prompt_digest is null or prompt_digest ~ '^[0-9a-f]{64}$'),
  constraint content_briefs_approval_check
    check ((status = 'approved')
           = (approved_by is not null and approved_at is not null)),
  constraint content_briefs_version_unique unique (content_item_id, brief_version)
);

create index content_briefs_client_idx on public.content_briefs (client_id);

-- ---------------------------------------------------------------------------
-- Production Job  (owns production status)
-- ---------------------------------------------------------------------------

create table public.production_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  content_brief_id uuid references public.content_briefs(id) on delete set null,
  -- Provider-neutral: a job requests a capability, never a named vendor.
  capability text not null,
  status text not null default 'pending',
  idempotency_key text not null,
  attempt_count integer not null default 0,
  maximum_attempts integer not null default 3,
  retryable boolean not null default false,
  lease_owner text,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  failure_code text,
  failure_message text,
  provider text,
  model text,
  cost_metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_jobs_capability_check
    check (length(capability) between 1 and 100),
  constraint production_jobs_status_check
    check (status in ('pending','running','retryable','failed','completed',
                      'cancelled')),
  constraint production_jobs_attempts_check
    check (attempt_count >= 0 and maximum_attempts >= 1
           and attempt_count <= maximum_attempts),
  constraint production_jobs_idempotency_check
    check (length(idempotency_key) between 1 and 160),
  constraint production_jobs_cost_check
    check (jsonb_typeof(cost_metadata) = 'object'),
  constraint production_jobs_failure_check
    check (status <> 'failed' or failure_code is not null),
  constraint production_jobs_completed_check
    check ((status = 'completed') = (completed_at is not null)),
  constraint production_jobs_idempotency_unique
    unique (client_id, idempotency_key)
);

create index production_jobs_client_status_idx
  on public.production_jobs (client_id, status);
create index production_jobs_lease_idx
  on public.production_jobs (status, lease_expires_at)
  where status = 'running';

-- ---------------------------------------------------------------------------
-- Content Performance  (owns analytics)
-- ---------------------------------------------------------------------------

create table public.content_performance (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  distribution_record_id uuid
    references public.client_distribution_records(id) on delete set null,
  measured_at timestamptz not null default now(),
  metric_source text not null,
  metrics jsonb not null default '{}'::jsonb,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_performance_source_check
    check (metric_source in ('manual','platform_api','derived')),
  constraint content_performance_metrics_check
    check (jsonb_typeof(metrics) = 'object')
);

create index content_performance_client_idx on public.content_performance (client_id);
create unique index content_performance_current_unique
  on public.content_performance (content_item_id)
  where is_current;

-- ---------------------------------------------------------------------------
-- Learning Proposal  (advisory only; never mutates authority)
-- ---------------------------------------------------------------------------

create table public.learning_proposals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  content_item_id uuid references public.content_items(id) on delete set null,
  content_performance_id uuid
    references public.content_performance(id) on delete set null,
  proposal_kind text not null,
  summary text not null,
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  context_version integer,
  execution_version integer,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_proposals_kind_check
    check (proposal_kind in ('context_update','execution_update',
                             'opportunity_seed')),
  constraint learning_proposals_summary_check
    check (length(summary) between 1 and 4000),
  constraint learning_proposals_status_check
    check (status in ('draft','needs_review','accepted','rejected')),
  constraint learning_proposals_detail_check
    check (jsonb_typeof(detail) = 'object'),
  constraint learning_proposals_review_check
    check (status not in ('accepted','rejected')
           or (reviewed_by is not null and reviewed_at is not null))
);

create index learning_proposals_client_status_idx
  on public.learning_proposals (client_id, status);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger content_sources_updated_at before update on public.content_sources
  for each row execute function public.set_updated_at();
create trigger manual_ideas_updated_at before update on public.manual_ideas
  for each row execute function public.set_updated_at();
create trigger proof_items_updated_at before update on public.proof_items
  for each row execute function public.set_updated_at();
create trigger content_opportunities_updated_at before update on public.content_opportunities
  for each row execute function public.set_updated_at();
create trigger content_requirements_updated_at before update on public.content_requirements
  for each row execute function public.set_updated_at();
create trigger calendar_slots_updated_at before update on public.calendar_slots
  for each row execute function public.set_updated_at();
create trigger content_items_updated_at before update on public.content_items
  for each row execute function public.set_updated_at();
create trigger content_briefs_updated_at before update on public.content_briefs
  for each row execute function public.set_updated_at();
create trigger production_jobs_updated_at before update on public.production_jobs
  for each row execute function public.set_updated_at();
create trigger content_performance_updated_at before update on public.content_performance
  for each row execute function public.set_updated_at();
create trigger learning_proposals_updated_at before update on public.learning_proposals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS, grants and client-isolation policies
-- ---------------------------------------------------------------------------

alter table public.content_sources enable row level security;
alter table public.manual_ideas enable row level security;
alter table public.proof_items enable row level security;
alter table public.content_opportunities enable row level security;
alter table public.content_opportunity_sources enable row level security;
alter table public.content_requirements enable row level security;
alter table public.calendar_slots enable row level security;
alter table public.content_items enable row level security;
alter table public.content_item_sources enable row level security;
alter table public.content_item_proof enable row level security;
alter table public.content_briefs enable row level security;
alter table public.production_jobs enable row level security;
alter table public.content_performance enable row level security;
alter table public.learning_proposals enable row level security;

revoke all on public.content_sources from public, anon, authenticated;
revoke all on public.manual_ideas from public, anon, authenticated;
revoke all on public.proof_items from public, anon, authenticated;
revoke all on public.content_opportunities from public, anon, authenticated;
revoke all on public.content_opportunity_sources from public, anon, authenticated;
revoke all on public.content_requirements from public, anon, authenticated;
revoke all on public.calendar_slots from public, anon, authenticated;
revoke all on public.content_items from public, anon, authenticated;
revoke all on public.content_item_sources from public, anon, authenticated;
revoke all on public.content_item_proof from public, anon, authenticated;
revoke all on public.content_briefs from public, anon, authenticated;
revoke all on public.production_jobs from public, anon, authenticated;
revoke all on public.content_performance from public, anon, authenticated;
revoke all on public.learning_proposals from public, anon, authenticated;

grant select on public.content_sources to authenticated;
grant select on public.manual_ideas to authenticated;
grant select on public.proof_items to authenticated;
grant select on public.content_opportunities to authenticated;
grant select on public.content_opportunity_sources to authenticated;
grant select on public.content_requirements to authenticated;
grant select on public.calendar_slots to authenticated;
grant select on public.content_items to authenticated;
grant select on public.content_item_sources to authenticated;
grant select on public.content_item_proof to authenticated;
grant select on public.content_briefs to authenticated;
grant select on public.production_jobs to authenticated;
grant select on public.content_performance to authenticated;
grant select on public.learning_proposals to authenticated;

grant all on public.content_sources to service_role;
grant all on public.manual_ideas to service_role;
grant all on public.proof_items to service_role;
grant all on public.content_opportunities to service_role;
grant all on public.content_opportunity_sources to service_role;
grant all on public.content_requirements to service_role;
grant all on public.calendar_slots to service_role;
grant all on public.content_items to service_role;
grant all on public.content_item_sources to service_role;
grant all on public.content_item_proof to service_role;
grant all on public.content_briefs to service_role;
grant all on public.production_jobs to service_role;
grant all on public.content_performance to service_role;
grant all on public.learning_proposals to service_role;

create policy content_sources_select on public.content_sources
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy manual_ideas_select on public.manual_ideas
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy proof_items_select on public.proof_items
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy content_opportunities_select on public.content_opportunities
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy content_opportunity_sources_select on public.content_opportunity_sources
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy content_requirements_select on public.content_requirements
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy calendar_slots_select on public.calendar_slots
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy content_items_select on public.content_items
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy content_item_sources_select on public.content_item_sources
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy content_item_proof_select on public.content_item_proof
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy content_briefs_select on public.content_briefs
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy production_jobs_select on public.production_jobs
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy content_performance_select on public.content_performance
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy learning_proposals_select on public.learning_proposals
  for select to authenticated using (client_id = any(public.auth_client_ids()));

-- ---------------------------------------------------------------------------
-- Table comments (data dictionary)
-- ---------------------------------------------------------------------------

comment on table public.content_sources is
  'Canonical spine entry for every upstream input. Typed detail lives in manual_ideas and proof_items.';
comment on table public.proof_items is
  'Proof claims fail closed: verification_status must be verified before a claim may be used in client-facing output.';
comment on table public.content_requirements is
  'Canonical owner of asset_format and channel. calendar_slots and content_items inherit format; they never declare it.';
comment on table public.calendar_slots is
  'Canonical owner of the scheduled date for the entire content spine.';
comment on table public.content_items is
  'Canonical owner of approval. Distribution stays in client_distribution_records and is referenced, never duplicated.';
comment on table public.production_jobs is
  'Canonical owner of production status. Provider-neutral: capability is requested, vendor is recorded as metadata only.';
comment on table public.content_performance is
  'Canonical owner of analytics. One is_current row per content item.';
comment on table public.learning_proposals is
  'Advisory only. A proposal never edits context, execution, content, calendar, asset or distribution data.';
