-- Phase 2A-A — reusable intelligence foundation and Market OS authority.
--
-- Additive migration. Existing client_research_runs and
-- client_research_sources remain the canonical execution/source tables. This
-- migration normalises the missing evidence, finding, release, approval,
-- provider-receipt, cost, and freshness layers around them.

-- ---------------------------------------------------------------------------
-- Existing research foundation: broaden execution semantics, preserve rows.
-- ---------------------------------------------------------------------------

alter table public.client_research_runs
  add column intelligence_domain text,
  add column started_at timestamptz,
  add column waiting_since timestamptz,
  add column cancelled_at timestamptz;

alter table public.client_research_runs
  drop constraint client_research_runs_status_check,
  drop constraint client_research_runs_completed_check;

-- Preserve the meaning of the legacy retryable state without keeping two
-- competing lifecycle representations.
update public.client_research_runs
set status = 'failed', retryable = true
where status = 'retryable';

alter table public.client_research_runs
  add constraint client_research_runs_status_check check (status in (
    'queued','running','waiting_provider','completed','completed_partial','failed','cancelled'
  )),
  add constraint client_research_runs_completed_check check (
    (status in ('completed','completed_partial')) = (completed_at is not null)
  ),
  add constraint client_research_runs_intelligence_domain_check check (
    intelligence_domain is null or intelligence_domain in (
      'market_os','avatar_os','competitor_os','association_os','brand_strategist'
    )
  ),
  add constraint client_research_runs_id_client_unique unique (id, client_id),
  add constraint client_research_runs_id_client_domain_unique unique (id, client_id, intelligence_domain);

alter table public.client_research_sources
  add column source_type text not null default 'web_page',
  add column canonical_url text,
  add column published_at timestamptz,
  add column source_quality text not null default 'unrated',
  add column inspectable boolean not null default true,
  add column raw_payload_hash text;

alter table public.client_research_sources
  add constraint client_research_sources_source_type_check check (source_type in (
    'web_page','report','dataset','first_party','regulatory','academic','news','other'
  )),
  add constraint client_research_sources_source_quality_check check (source_quality in (
    'authoritative','primary','secondary','unrated'
  )),
  add constraint client_research_sources_raw_hash_check check (
    raw_payload_hash is null or raw_payload_hash ~ '^[0-9a-f]{64}$'
  ),
  add constraint client_research_sources_id_client_unique unique (id, client_id),
  add constraint client_research_sources_run_client_fk
    foreign key (research_run_id, client_id)
    references public.client_research_runs(id, client_id) on delete cascade;

alter table public.client_context_files
  add constraint client_context_files_id_client_unique unique (id, client_id);

-- ---------------------------------------------------------------------------
-- Execution steps, provider receipts, and usage/cost events.
-- ---------------------------------------------------------------------------

create table public.client_research_steps (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  research_run_id uuid not null,
  step_key text not null,
  step_order integer not null,
  title text not null,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  maximum_attempts integer not null default 3,
  lease_owner text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  failure_message text,
  output_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_research_steps_run_client_fk foreign key (research_run_id, client_id)
    references public.client_research_runs(id, client_id) on delete cascade,
  constraint client_research_steps_key_check check (length(trim(step_key)) between 1 and 120),
  constraint client_research_steps_order_check check (step_order >= 1),
  constraint client_research_steps_status_check check (status in (
    'queued','running','waiting_provider','completed','failed','cancelled'
  )),
  constraint client_research_steps_attempts_check check (
    attempt_count >= 0 and maximum_attempts >= 1 and attempt_count <= maximum_attempts
  ),
  constraint client_research_steps_run_key_unique unique (research_run_id, step_key),
  constraint client_research_steps_run_order_unique unique (research_run_id, step_order),
  constraint client_research_steps_id_client_unique unique (id, client_id)
);

create index client_research_steps_run_idx
  on public.client_research_steps (research_run_id, step_order);

create or replace function public.claim_client_research_step(
  p_research_run_id uuid,
  p_lease_owner text,
  p_lease_seconds integer default 180
) returns public.client_research_steps
language plpgsql security definer set search_path = '' as $$
declare
  v_step public.client_research_steps;
begin
  if auth.role() <> 'service_role' then raise exception 'AUTH: service role required'; end if;
  if nullif(trim(coalesce(p_lease_owner, '')), '') is null then raise exception 'VALIDATION: lease owner required'; end if;
  if p_lease_seconds not between 30 and 900 then raise exception 'VALIDATION: invalid lease duration'; end if;

  select * into v_step
  from public.client_research_steps
  where research_run_id = p_research_run_id
    and (
      status = 'queued' or
      (status = 'failed' and attempt_count < maximum_attempts) or
      (status = 'running' and lease_expires_at < now() and attempt_count < maximum_attempts)
    )
  order by step_order
  for update skip locked
  limit 1;

  if not found then return null; end if;

  update public.client_research_steps
  set status = 'running',
      attempt_count = attempt_count + 1,
      lease_owner = p_lease_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(started_at, now()),
      completed_at = null,
      failure_code = null,
      failure_message = null
  where id = v_step.id
  returning * into v_step;

  return v_step;
end; $$;

create table public.client_provider_operation_receipts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  research_run_id uuid not null,
  research_step_id uuid,
  capability text not null,
  provider text not null,
  model text,
  provider_request_id text,
  status text not null,
  result_reference text,
  retrieved_at timestamptz,
  usage jsonb not null default '{}'::jsonb,
  cost jsonb not null default '{}'::jsonb,
  retry_after timestamptz,
  error_class text,
  error_message text,
  raw_payload_hash text,
  created_at timestamptz not null default now(),
  constraint client_provider_receipts_run_client_fk foreign key (research_run_id, client_id)
    references public.client_research_runs(id, client_id) on delete cascade,
  constraint client_provider_receipts_step_client_fk foreign key (research_step_id, client_id)
    references public.client_research_steps(id, client_id) on delete cascade,
  constraint client_provider_receipts_status_check check (status in (
    'requested','running','completed','failed','cancelled'
  )),
  constraint client_provider_receipts_usage_check check (jsonb_typeof(usage) = 'object'),
  constraint client_provider_receipts_cost_check check (jsonb_typeof(cost) = 'object'),
  constraint client_provider_receipts_raw_hash_check check (
    raw_payload_hash is null or raw_payload_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint client_provider_receipts_id_client_unique unique (id, client_id)
);

create index client_provider_operation_receipts_run_idx
  on public.client_provider_operation_receipts (research_run_id, created_at);

create table public.client_research_cost_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  research_run_id uuid not null,
  provider_operation_id uuid,
  provider text not null,
  model text,
  input_units bigint not null default 0,
  output_units bigint not null default 0,
  tool_calls integer not null default 0,
  amount_microunits bigint,
  currency text,
  pricing_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint client_research_cost_events_run_client_fk foreign key (research_run_id, client_id)
    references public.client_research_runs(id, client_id) on delete cascade,
  constraint client_research_cost_events_receipt_client_fk foreign key (provider_operation_id, client_id)
    references public.client_provider_operation_receipts(id, client_id) on delete restrict,
  constraint client_research_cost_events_units_check check (
    input_units >= 0 and output_units >= 0 and tool_calls >= 0 and
    (amount_microunits is null or amount_microunits >= 0)
  ),
  constraint client_research_cost_events_currency_check check (
    (amount_microunits is null and currency is null) or
    (amount_microunits is not null and currency ~ '^[A-Z]{3}$')
  ),
  constraint client_research_cost_events_pricing_check check (jsonb_typeof(pricing_snapshot) = 'object')
);

create index client_research_cost_events_run_idx
  on public.client_research_cost_events (research_run_id, created_at);

-- ---------------------------------------------------------------------------
-- Evidence and atomic findings.
-- ---------------------------------------------------------------------------

create table public.client_evidence_records (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  research_run_id uuid,
  source_type text not null,
  research_source_id uuid,
  context_file_id uuid,
  client_input_field text,
  evidence_kind text not null,
  evidence_text text not null,
  locator jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null,
  source_quality text not null default 'unrated',
  inspectable boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint client_evidence_records_run_client_fk foreign key (research_run_id, client_id)
    references public.client_research_runs(id, client_id) on delete cascade,
  constraint client_evidence_records_source_client_fk foreign key (research_source_id, client_id)
    references public.client_research_sources(id, client_id) on delete restrict,
  constraint client_evidence_records_context_client_fk foreign key (context_file_id, client_id)
    references public.client_context_files(id, client_id) on delete restrict,
  constraint client_evidence_records_source_type_check check (source_type in (
    'research_source','context_file','client_input','structured_observation'
  )),
  constraint client_evidence_records_kind_check check (evidence_kind in (
    'excerpt','paraphrase','structured_observation','calculation'
  )),
  constraint client_evidence_records_quality_check check (source_quality in (
    'authoritative','primary','secondary','unrated'
  )),
  constraint client_evidence_records_text_check check (length(trim(evidence_text)) between 1 and 30000),
  constraint client_evidence_records_locator_check check (jsonb_typeof(locator) = 'object'),
  constraint client_evidence_records_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint client_evidence_records_origin_check check (
    (source_type = 'research_source' and research_source_id is not null and context_file_id is null and client_input_field is null) or
    (source_type = 'context_file' and research_source_id is null and context_file_id is not null and client_input_field is null) or
    (source_type = 'client_input' and research_source_id is null and context_file_id is null and nullif(trim(client_input_field), '') is not null) or
    (source_type = 'structured_observation' and research_source_id is not null and context_file_id is null and client_input_field is null)
  ),
  constraint client_evidence_records_id_client_unique unique (id, client_id)
);

create index client_evidence_records_run_idx
  on public.client_evidence_records (research_run_id, created_at);
create index client_evidence_records_source_idx
  on public.client_evidence_records (research_source_id);

create table public.client_intelligence_findings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  intelligence_domain text not null,
  subject_key text,
  claim text not null,
  disposition text not null,
  confidence_level text,
  rationale text,
  contradiction_status text not null default 'none',
  metadata jsonb not null default '{}'::jsonb,
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_intelligence_findings_domain_check check (intelligence_domain in (
    'market_os','avatar_os','competitor_os','association_os','brand_strategist'
  )),
  constraint client_intelligence_findings_disposition_check check (disposition in (
    'asserted','unknown','not_relevant'
  )),
  constraint client_intelligence_findings_confidence_check check (
    confidence_level is null or confidence_level in (
      'verified','strongly_inferred','weakly_inferred','modelled'
    )
  ),
  constraint client_intelligence_findings_disposition_confidence_check check (
    (disposition = 'asserted' and confidence_level is not null) or
    (disposition in ('unknown','not_relevant') and confidence_level is null)
  ),
  constraint client_intelligence_findings_contradiction_check check (contradiction_status in (
    'none','unresolved','resolved'
  )),
  constraint client_intelligence_findings_claim_check check (length(trim(claim)) between 1 and 5000),
  constraint client_intelligence_findings_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint client_intelligence_findings_id_client_unique unique (id, client_id)
);

create index client_intelligence_findings_client_domain_idx
  on public.client_intelligence_findings (client_id, intelligence_domain, created_at desc);

create table public.client_intelligence_finding_evidence (
  client_id uuid not null references public.clients(id) on delete cascade,
  finding_id uuid not null,
  evidence_id uuid not null,
  relationship text not null default 'supports',
  created_at timestamptz not null default now(),
  primary key (finding_id, evidence_id),
  constraint client_intelligence_finding_evidence_finding_fk foreign key (finding_id, client_id)
    references public.client_intelligence_findings(id, client_id) on delete cascade,
  constraint client_intelligence_finding_evidence_evidence_fk foreign key (evidence_id, client_id)
    references public.client_evidence_records(id, client_id) on delete restrict,
  constraint client_intelligence_finding_evidence_relationship_check check (
    relationship in ('supports','contradicts','contextualises')
  )
);

create index client_intelligence_finding_evidence_evidence_idx
  on public.client_intelligence_finding_evidence (evidence_id);

-- A verified finding is a database-enforced transition, not a UI label.
create or replace function public.enforce_verified_intelligence_finding()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.disposition = 'asserted' and new.confidence_level = 'verified' then
    if new.contradiction_status = 'unresolved' then
      raise exception 'VALIDATION: verified finding has an unresolved contradiction';
    end if;
    if not exists (
      select 1
      from public.client_intelligence_finding_evidence link
      join public.client_evidence_records evidence
        on evidence.id = link.evidence_id and evidence.client_id = link.client_id
      where link.finding_id = new.id
        and link.client_id = new.client_id
        and link.relationship = 'supports'
        and evidence.inspectable = true
        and evidence.source_quality in ('authoritative','primary')
    ) then
      raise exception 'VALIDATION: verified finding requires inspectable primary or authoritative supporting evidence';
    end if;
  end if;
  return new;
end; $$;

create trigger client_intelligence_findings_verified_guard
  before insert or update on public.client_intelligence_findings
  for each row execute function public.enforce_verified_intelligence_finding();

-- Backfill the evidence embedded in legacy source rows. It remains review-only
-- and unrated; no legacy confidence value is promoted into verified authority.
insert into public.client_evidence_records (
  client_id, research_run_id, source_type, research_source_id, evidence_kind,
  evidence_text, locator, observed_at, source_quality, inspectable, metadata
)
select
  source.client_id,
  source.research_run_id,
  'research_source',
  source.id,
  case source.evidence_kind when 'quoted' then 'excerpt' else 'paraphrase' end,
  source.evidence_text,
  jsonb_build_object('url', source.url),
  source.retrieved_at,
  'unrated',
  true,
  jsonb_build_object('backfilled_from_legacy_source', true, 'legacy_confidence', source.confidence)
from public.client_research_sources source
where not exists (
  select 1 from public.client_evidence_records evidence
  where evidence.research_source_id = source.id
    and evidence.metadata ->> 'backfilled_from_legacy_source' = 'true'
);

-- ---------------------------------------------------------------------------
-- Versioned domain releases, structured records, approval, and activation.
-- ---------------------------------------------------------------------------

create table public.client_intelligence_releases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  intelligence_domain text not null,
  version integer not null,
  status text not null default 'draft',
  research_run_id uuid,
  title text not null,
  summary text not null default '',
  content jsonb not null default '{}'::jsonb,
  authority_snapshot jsonb not null default '{}'::jsonb,
  generated_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  superseded_at timestamptz,
  archived_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_intelligence_releases_run_client_fk foreign key (research_run_id, client_id)
    references public.client_research_runs(id, client_id) on delete restrict,
  constraint client_intelligence_releases_run_domain_fk foreign key (research_run_id, client_id, intelligence_domain)
    references public.client_research_runs(id, client_id, intelligence_domain) on delete restrict,
  constraint client_intelligence_releases_domain_check check (intelligence_domain in (
    'market_os','avatar_os','competitor_os','association_os','brand_strategist'
  )),
  constraint client_intelligence_releases_version_check check (version >= 1),
  constraint client_intelligence_releases_status_check check (status in (
    'draft','needs_review','approved','superseded','archived'
  )),
  constraint client_intelligence_releases_content_check check (jsonb_typeof(content) = 'object'),
  constraint client_intelligence_releases_authority_check check (jsonb_typeof(authority_snapshot) = 'object'),
  constraint client_intelligence_releases_client_domain_version_unique unique (client_id, intelligence_domain, version),
  constraint client_intelligence_releases_id_client_unique unique (id, client_id),
  constraint client_intelligence_releases_id_client_domain_unique unique (id, client_id, intelligence_domain)
);

create index client_intelligence_releases_client_domain_idx
  on public.client_intelligence_releases (client_id, intelligence_domain, version desc);

create table public.client_intelligence_records (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  release_id uuid not null,
  record_type text not null,
  record_key text not null,
  title text not null,
  summary text not null default '',
  payload jsonb not null default '{}'::jsonb,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint client_intelligence_records_release_client_fk foreign key (release_id, client_id)
    references public.client_intelligence_releases(id, client_id) on delete cascade,
  constraint client_intelligence_records_key_check check (length(trim(record_key)) between 1 and 160),
  constraint client_intelligence_records_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint client_intelligence_records_release_key_unique unique (release_id, record_type, record_key),
  constraint client_intelligence_records_id_client_unique unique (id, client_id)
);

create index client_intelligence_records_release_idx
  on public.client_intelligence_records (release_id, display_order);

create table public.client_intelligence_release_findings (
  client_id uuid not null references public.clients(id) on delete cascade,
  release_id uuid not null,
  finding_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (release_id, finding_id),
  constraint client_intelligence_release_findings_release_fk foreign key (release_id, client_id)
    references public.client_intelligence_releases(id, client_id) on delete cascade,
  constraint client_intelligence_release_findings_finding_fk foreign key (finding_id, client_id)
    references public.client_intelligence_findings(id, client_id) on delete restrict
);

create table public.client_intelligence_approval_decisions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  release_id uuid not null,
  decision text not null,
  previous_status text not null,
  resulting_status text not null,
  note text,
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz not null default now(),
  constraint client_intelligence_approval_release_client_fk foreign key (release_id, client_id)
    references public.client_intelligence_releases(id, client_id) on delete restrict,
  constraint client_intelligence_approval_decision_check check (decision in (
    'approved','changes_requested','rejected'
  ))
);

create index client_intelligence_approval_decisions_release_idx
  on public.client_intelligence_approval_decisions (release_id, decided_at desc);

create table public.client_intelligence_active_releases (
  client_id uuid not null references public.clients(id) on delete cascade,
  intelligence_domain text not null,
  release_id uuid not null unique,
  activated_by uuid references public.users(id) on delete set null,
  activated_at timestamptz not null default now(),
  primary key (client_id, intelligence_domain),
  constraint client_intelligence_active_releases_release_fk foreign key (release_id, client_id)
    references public.client_intelligence_releases(id, client_id) on delete restrict,
  constraint client_intelligence_active_releases_release_domain_fk foreign key (release_id, client_id, intelligence_domain)
    references public.client_intelligence_releases(id, client_id, intelligence_domain) on delete restrict,
  constraint client_intelligence_active_releases_domain_check check (intelligence_domain in (
    'market_os','avatar_os','competitor_os','association_os','brand_strategist'
  ))
);

create table public.client_intelligence_refresh_policies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  intelligence_domain text not null,
  refresh_interval_days integer not null,
  due_warning_days integer not null default 14,
  scheduled_refresh_enabled boolean not null default false,
  policy_reason text,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_intelligence_refresh_policies_domain_check check (intelligence_domain in (
    'market_os','avatar_os','competitor_os','association_os','brand_strategist'
  )),
  constraint client_intelligence_refresh_policies_interval_check check (
    refresh_interval_days between 1 and 3650 and
    due_warning_days between 0 and refresh_interval_days
  ),
  constraint client_intelligence_refresh_policies_unique unique (client_id, intelligence_domain)
);

-- Approved content is immutable. Lifecycle-only transitions remain possible so
-- an approved release can later become superseded or archived without changing
-- the authority that was originally approved.
create or replace function public.protect_approved_intelligence_release()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status in ('approved','superseded','archived') and (
    new.client_id is distinct from old.client_id or
    new.intelligence_domain is distinct from old.intelligence_domain or
    new.version is distinct from old.version or
    new.research_run_id is distinct from old.research_run_id or
    new.title is distinct from old.title or
    new.summary is distinct from old.summary or
    new.content is distinct from old.content or
    new.authority_snapshot is distinct from old.authority_snapshot or
    new.generated_at is distinct from old.generated_at or
    new.submitted_at is distinct from old.submitted_at or
    new.approved_at is distinct from old.approved_at
  ) then
    raise exception 'VALIDATION: approved intelligence releases are immutable';
  end if;
  if old.status = 'approved' and new.status not in ('approved','superseded','archived') then
    raise exception 'VALIDATION: approved release cannot return to a draft lifecycle';
  end if;
  if old.status = 'superseded' and new.status not in ('superseded','archived') then
    raise exception 'VALIDATION: superseded release cannot be reactivated';
  end if;
  if old.status = 'archived' and new.status <> 'archived' then
    raise exception 'VALIDATION: archived release is terminal';
  end if;
  return new;
end; $$;

create trigger client_intelligence_releases_immutable_guard
  before update on public.client_intelligence_releases
  for each row execute function public.protect_approved_intelligence_release();

create or replace function public.protect_intelligence_release_child()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_release_id uuid := case when tg_op = 'DELETE' then old.release_id else new.release_id end;
begin
  if exists (
    select 1 from public.client_intelligence_releases release
    where release.id = v_release_id and release.status in ('approved','superseded','archived')
  ) then
    raise exception 'VALIDATION: approved intelligence release records are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end; $$;

create trigger client_intelligence_records_release_guard
  before insert or update or delete on public.client_intelligence_records
  for each row execute function public.protect_intelligence_release_child();
create trigger client_intelligence_release_findings_release_guard
  before insert or update or delete on public.client_intelligence_release_findings
  for each row execute function public.protect_intelligence_release_child();

create or replace function public.protect_released_intelligence_finding()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_finding_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
begin
  if exists (
    select 1
    from public.client_intelligence_release_findings link
    join public.client_intelligence_releases release on release.id = link.release_id
    where link.finding_id = v_finding_id and release.status in ('approved','superseded','archived')
  ) then
    raise exception 'VALIDATION: findings in approved intelligence releases are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end; $$;

create trigger client_intelligence_findings_release_guard
  before update or delete on public.client_intelligence_findings
  for each row execute function public.protect_released_intelligence_finding();

create or replace function public.protect_released_finding_evidence_link()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_finding_id uuid := case when tg_op = 'DELETE' then old.finding_id else new.finding_id end;
begin
  if exists (
    select 1
    from public.client_intelligence_release_findings link
    join public.client_intelligence_releases release on release.id = link.release_id
    where link.finding_id = v_finding_id and release.status in ('approved','superseded','archived')
  ) then
    raise exception 'VALIDATION: evidence links in approved intelligence releases are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end; $$;

create trigger client_intelligence_finding_evidence_release_guard
  before insert or update or delete on public.client_intelligence_finding_evidence
  for each row execute function public.protect_released_finding_evidence_link();

create or replace function public.protect_released_intelligence_evidence()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_evidence_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
begin
  if exists (
    select 1
    from public.client_intelligence_finding_evidence evidence_link
    join public.client_intelligence_release_findings release_link on release_link.finding_id = evidence_link.finding_id
    join public.client_intelligence_releases release on release.id = release_link.release_id
    where evidence_link.evidence_id = v_evidence_id and release.status in ('approved','superseded','archived')
  ) then
    raise exception 'VALIDATION: evidence in approved intelligence releases is immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end; $$;

create trigger client_evidence_records_release_guard
  before update or delete on public.client_evidence_records
  for each row execute function public.protect_released_intelligence_evidence();

create or replace function public.prevent_intelligence_approval_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'VALIDATION: intelligence approval decisions are append-only';
end; $$;

create trigger client_intelligence_approval_decisions_append_only
  before update or delete on public.client_intelligence_approval_decisions
  for each row execute function public.prevent_intelligence_approval_mutation();

-- ---------------------------------------------------------------------------
-- Human review and activation RPC.
-- ---------------------------------------------------------------------------

create or replace function public.review_intelligence_release(
  p_release_id uuid,
  p_decision text,
  p_note text default null
) returns public.client_intelligence_releases
language plpgsql security definer set search_path = '' as $$
declare
  v_release public.client_intelligence_releases;
  v_previous public.client_intelligence_releases;
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
  from public.client_intelligence_releases
  where id = p_release_id
  for update;

  if not found then raise exception 'NOT_FOUND: intelligence release'; end if;
  if not (v_release.client_id = any(public.auth_client_ids())) then
    raise exception 'AUTH: client access required';
  end if;
  if v_release.status <> 'needs_review' then
    raise exception 'VALIDATION: release must be awaiting review';
  end if;

  if p_decision = 'approved' then
    if not exists (
      select 1 from public.client_intelligence_records record
      where record.release_id = v_release.id and record.client_id = v_release.client_id
    ) then
      raise exception 'VALIDATION: release has no structured domain records';
    end if;
    v_resulting_status := 'approved';
    update public.client_intelligence_releases
    set status = 'approved', approved_at = now()
    where id = v_release.id
    returning * into v_release;

    select release.* into v_previous
    from public.client_intelligence_active_releases active
    join public.client_intelligence_releases release on release.id = active.release_id
    where active.client_id = v_release.client_id
      and active.intelligence_domain = v_release.intelligence_domain
      and active.release_id <> v_release.id
    for update of release;

    if found then
      update public.client_intelligence_releases
      set status = 'superseded', superseded_at = now()
      where id = v_previous.id;
    end if;

    insert into public.client_intelligence_active_releases (
      client_id, intelligence_domain, release_id, activated_by, activated_at
    ) values (
      v_release.client_id, v_release.intelligence_domain, v_release.id, auth.uid(), now()
    ) on conflict (client_id, intelligence_domain) do update set
      release_id = excluded.release_id,
      activated_by = excluded.activated_by,
      activated_at = excluded.activated_at;
  elsif p_decision = 'changes_requested' then
    v_resulting_status := 'draft';
    update public.client_intelligence_releases
    set status = 'draft', submitted_at = null
    where id = v_release.id
    returning * into v_release;
  else
    v_resulting_status := 'archived';
    update public.client_intelligence_releases
    set status = 'archived', archived_at = now()
    where id = v_release.id
    returning * into v_release;
  end if;

  insert into public.client_intelligence_approval_decisions (
    client_id, release_id, decision, previous_status, resulting_status, note, decided_by
  ) values (
    v_release.client_id, v_release.id, p_decision, 'needs_review', v_resulting_status,
    nullif(trim(coalesce(p_note, '')), ''), auth.uid()
  );

  insert into public.activity_log (
    client_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    v_release.client_id,
    'intelligence_release_' || p_decision,
    v_release.title || ' review decision: ' || replace(p_decision, '_', ' ') || '.',
    'client_intelligence_release',
    v_release.id,
    jsonb_build_object(
      'intelligence_domain', v_release.intelligence_domain,
      'version', v_release.version,
      'decision', p_decision
    )
  );

  return v_release;
end; $$;

-- ---------------------------------------------------------------------------
-- Updated-at triggers, RLS, grants, and comments.
-- ---------------------------------------------------------------------------

create trigger client_research_steps_updated_at before update on public.client_research_steps
  for each row execute function public.set_updated_at();
create trigger client_intelligence_findings_updated_at before update on public.client_intelligence_findings
  for each row execute function public.set_updated_at();
create trigger client_intelligence_releases_updated_at before update on public.client_intelligence_releases
  for each row execute function public.set_updated_at();
create trigger client_intelligence_refresh_policies_updated_at before update on public.client_intelligence_refresh_policies
  for each row execute function public.set_updated_at();

alter table public.client_research_steps enable row level security;
alter table public.client_provider_operation_receipts enable row level security;
alter table public.client_research_cost_events enable row level security;
alter table public.client_evidence_records enable row level security;
alter table public.client_intelligence_findings enable row level security;
alter table public.client_intelligence_finding_evidence enable row level security;
alter table public.client_intelligence_releases enable row level security;
alter table public.client_intelligence_records enable row level security;
alter table public.client_intelligence_release_findings enable row level security;
alter table public.client_intelligence_approval_decisions enable row level security;
alter table public.client_intelligence_active_releases enable row level security;
alter table public.client_intelligence_refresh_policies enable row level security;

revoke all on
  public.client_research_steps,
  public.client_provider_operation_receipts,
  public.client_research_cost_events,
  public.client_evidence_records,
  public.client_intelligence_findings,
  public.client_intelligence_finding_evidence,
  public.client_intelligence_releases,
  public.client_intelligence_records,
  public.client_intelligence_release_findings,
  public.client_intelligence_approval_decisions,
  public.client_intelligence_active_releases,
  public.client_intelligence_refresh_policies
from public, anon, authenticated;

grant select on
  public.client_research_steps,
  public.client_provider_operation_receipts,
  public.client_research_cost_events,
  public.client_evidence_records,
  public.client_intelligence_findings,
  public.client_intelligence_finding_evidence,
  public.client_intelligence_releases,
  public.client_intelligence_records,
  public.client_intelligence_release_findings,
  public.client_intelligence_approval_decisions,
  public.client_intelligence_active_releases,
  public.client_intelligence_refresh_policies
to authenticated;

grant all on
  public.client_research_steps,
  public.client_provider_operation_receipts,
  public.client_research_cost_events,
  public.client_evidence_records,
  public.client_intelligence_findings,
  public.client_intelligence_finding_evidence,
  public.client_intelligence_releases,
  public.client_intelligence_records,
  public.client_intelligence_release_findings,
  public.client_intelligence_approval_decisions,
  public.client_intelligence_active_releases,
  public.client_intelligence_refresh_policies
to service_role;

create policy client_research_steps_select on public.client_research_steps
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_provider_operation_receipts_select on public.client_provider_operation_receipts
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_research_cost_events_select on public.client_research_cost_events
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_evidence_records_select on public.client_evidence_records
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_intelligence_findings_select on public.client_intelligence_findings
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_intelligence_finding_evidence_select on public.client_intelligence_finding_evidence
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_intelligence_releases_select on public.client_intelligence_releases
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_intelligence_records_select on public.client_intelligence_records
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_intelligence_release_findings_select on public.client_intelligence_release_findings
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_intelligence_approval_decisions_select on public.client_intelligence_approval_decisions
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_intelligence_active_releases_select on public.client_intelligence_active_releases
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_intelligence_refresh_policies_select on public.client_intelligence_refresh_policies
  for select to authenticated using (client_id = any(public.auth_client_ids()));

revoke all on function public.review_intelligence_release(uuid,text,text) from public, anon;
grant execute on function public.review_intelligence_release(uuid,text,text) to authenticated, service_role;
revoke all on function public.claim_client_research_step(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.claim_client_research_step(uuid,text,integer) to service_role;

comment on table public.client_evidence_records is 'Normalised evidence excerpts and structured observations. Sources, evidence, findings, domain records, and releases remain separate.';
comment on table public.client_intelligence_findings is 'Atomic intelligence claims with independent disposition, confidence, and contradiction state.';
comment on table public.client_intelligence_releases is 'Versioned domain snapshots. Approved content is immutable and downstream systems use only the active approved pointer.';
comment on function public.review_intelligence_release(uuid,text,text) is 'Records a human review decision and atomically activates an approved release while superseding the prior active release.';
comment on function public.claim_client_research_step(uuid,text,integer) is 'Service-only, lease-safe claim of the next queued or recoverable intelligence research step.';
