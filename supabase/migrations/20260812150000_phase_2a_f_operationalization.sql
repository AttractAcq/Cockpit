-- Phase 2A-F — Operationalization and Integration
--
-- Adds operational state around the five existing intelligence domains. This
-- migration does not create a sixth domain and never changes approved content.
-- It records dependencies, downstream consumption, refresh commands, and
-- reviewable change proposals so supersession and feedback remain explicit.

begin;

create table public.client_intelligence_release_dependencies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  dependent_release_id uuid not null,
  dependent_domain text not null,
  upstream_release_id uuid not null,
  upstream_domain text not null,
  dependency_kind text not null default 'authority',
  material boolean not null default true,
  created_at timestamptz not null default now(),
  constraint client_intelligence_dependencies_dependent_fk
    foreign key (dependent_release_id, client_id)
    references public.client_intelligence_releases(id, client_id) on delete cascade,
  constraint client_intelligence_dependencies_upstream_fk
    foreign key (upstream_release_id, client_id)
    references public.client_intelligence_releases(id, client_id) on delete restrict,
  constraint client_intelligence_dependencies_domains_check check (
    dependent_domain in ('market_os','avatar_os','competitor_os','association_os','brand_strategist')
    and upstream_domain in ('market_os','avatar_os','competitor_os','association_os','brand_strategist')
    and dependent_domain <> upstream_domain
  ),
  constraint client_intelligence_dependencies_kind_check
    check (dependency_kind in ('authority','refresh_history')),
  constraint client_intelligence_dependencies_distinct_check
    check (dependent_release_id <> upstream_release_id),
  constraint client_intelligence_dependencies_unique
    unique (dependent_release_id, upstream_release_id, dependency_kind)
);

create index client_intelligence_dependencies_upstream_idx
  on public.client_intelligence_release_dependencies (client_id, upstream_release_id, material);

create table public.client_intelligence_refresh_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  intelligence_domain text not null,
  request_type text not null,
  status text not null default 'requested',
  reason text not null,
  source_release_id uuid,
  requested_by uuid references public.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  failure_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_intelligence_refresh_requests_source_fk
    foreign key (source_release_id, client_id)
    references public.client_intelligence_releases(id, client_id) on delete restrict,
  constraint client_intelligence_refresh_requests_domain_check check (
    intelligence_domain in ('market_os','avatar_os','competitor_os','association_os','brand_strategist')
  ),
  constraint client_intelligence_refresh_requests_type_check
    check (request_type in ('manual','scheduled','dependency')),
  constraint client_intelligence_refresh_requests_status_check
    check (status in ('requested','claimed','completed','cancelled','failed')),
  constraint client_intelligence_refresh_requests_reason_check
    check (length(trim(reason)) between 3 and 2000),
  constraint client_intelligence_refresh_requests_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create unique index client_intelligence_refresh_requests_open_unique
  on public.client_intelligence_refresh_requests (client_id, intelligence_domain)
  where status in ('requested','claimed');
create index client_intelligence_refresh_requests_queue_idx
  on public.client_intelligence_refresh_requests (status, request_type, requested_at);

create table public.client_intelligence_consumptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  consumer_type text not null,
  consumer_key text not null,
  purpose text not null,
  authority_snapshot jsonb not null,
  consumed_by uuid references public.users(id) on delete set null,
  consumed_at timestamptz not null default now(),
  invalidated_at timestamptz,
  invalidation_reason text,
  created_at timestamptz not null default now(),
  constraint client_intelligence_consumptions_consumer_type_check
    check (length(trim(consumer_type)) between 2 and 100),
  constraint client_intelligence_consumptions_consumer_key_check
    check (length(trim(consumer_key)) between 1 and 300),
  constraint client_intelligence_consumptions_purpose_check
    check (length(trim(purpose)) between 2 and 160),
  constraint client_intelligence_consumptions_snapshot_check
    check (jsonb_typeof(authority_snapshot) = 'object'),
  constraint client_intelligence_consumptions_invalidation_check check (
    (invalidated_at is null and invalidation_reason is null)
    or (invalidated_at is not null and length(trim(invalidation_reason)) > 0)
  ),
  constraint client_intelligence_consumptions_unique
    unique (client_id, consumer_type, consumer_key, purpose)
);

create index client_intelligence_consumptions_client_idx
  on public.client_intelligence_consumptions (client_id, consumed_at desc);
create index client_intelligence_consumptions_current_idx
  on public.client_intelligence_consumptions (client_id, invalidated_at)
  where invalidated_at is null;

create table public.client_intelligence_change_proposals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  target_kind text not null,
  target_domain text,
  target_release_id uuid,
  proposal_type text not null,
  title text not null,
  summary text not null,
  rationale text not null,
  evidence jsonb not null default '{}'::jsonb,
  priority text not null default 'normal',
  status text not null default 'needs_review',
  source_type text not null,
  source_key text,
  created_by uuid references public.users(id) on delete set null,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewer_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_intelligence_change_proposals_release_fk
    foreign key (target_release_id, client_id)
    references public.client_intelligence_releases(id, client_id) on delete restrict,
  constraint client_intelligence_change_proposals_target_check check (
    (target_kind = 'context' and target_domain is null)
    or (target_kind = 'intelligence' and target_domain in ('market_os','avatar_os','competitor_os','association_os','brand_strategist'))
  ),
  constraint client_intelligence_change_proposals_type_check
    check (proposal_type in ('correct','add','retire','investigate','refresh')),
  constraint client_intelligence_change_proposals_priority_check
    check (priority in ('low','normal','high','urgent')),
  constraint client_intelligence_change_proposals_status_check
    check (status in ('needs_review','approved','dismissed','converted_to_draft')),
  constraint client_intelligence_change_proposals_text_check check (
    length(trim(title)) between 3 and 300
    and length(trim(summary)) between 3 and 5000
    and length(trim(rationale)) between 3 and 5000
    and length(trim(source_type)) between 2 and 100
  ),
  constraint client_intelligence_change_proposals_evidence_check
    check (jsonb_typeof(evidence) = 'object'),
  constraint client_intelligence_change_proposals_review_check check (
    (status = 'needs_review' and reviewed_at is null and reviewed_by is null)
    or (status <> 'needs_review' and reviewed_at is not null and reviewed_by is not null)
  )
);

create index client_intelligence_change_proposals_queue_idx
  on public.client_intelligence_change_proposals (client_id, status, priority, created_at desc);

create or replace function public.sync_intelligence_release_dependencies(p_release_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_release public.client_intelligence_releases;
  v_domain text;
  v_upstream_id uuid;
  v_count integer := 0;
begin
  select * into v_release from public.client_intelligence_releases where id = p_release_id;
  if not found then raise exception 'NOT_FOUND: intelligence release'; end if;

  delete from public.client_intelligence_release_dependencies
  where dependent_release_id = v_release.id;

  foreach v_domain in array array['market_os','avatar_os','competitor_os','association_os','brand_strategist'] loop
    if v_domain = v_release.intelligence_domain then continue; end if;
    begin
      v_upstream_id := nullif(v_release.authority_snapshot -> v_domain ->> 'release_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'VALIDATION: invalid intelligence dependency identity';
    end;
    if v_upstream_id is null then continue; end if;
    insert into public.client_intelligence_release_dependencies (
      client_id, dependent_release_id, dependent_domain,
      upstream_release_id, upstream_domain, dependency_kind, material
    )
    select v_release.client_id, v_release.id, v_release.intelligence_domain,
      upstream.id, upstream.intelligence_domain, 'authority', true
    from public.client_intelligence_releases upstream
    where upstream.id = v_upstream_id
      and upstream.client_id = v_release.client_id
      and upstream.intelligence_domain = v_domain;
    if not found then raise exception 'VALIDATION: intelligence dependency must reference the same client and domain'; end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;

do $$
declare v_release record;
begin
  for v_release in
    select id from public.client_intelligence_releases
    where status in ('approved','superseded','archived')
  loop
    perform public.sync_intelligence_release_dependencies(v_release.id);
  end loop;
end $$;

create or replace function public.prevent_intelligence_consumption_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'VALIDATION: intelligence consumption records are append-only';
  end if;
  if new.client_id is distinct from old.client_id
    or new.consumer_type is distinct from old.consumer_type
    or new.consumer_key is distinct from old.consumer_key
    or new.purpose is distinct from old.purpose
    or new.authority_snapshot is distinct from old.authority_snapshot
    or new.consumed_by is distinct from old.consumed_by
    or new.consumed_at is distinct from old.consumed_at
  then
    raise exception 'VALIDATION: consumed intelligence authority is immutable';
  end if;
  if old.invalidated_at is not null and (
    new.invalidated_at is distinct from old.invalidated_at
    or new.invalidation_reason is distinct from old.invalidation_reason
  ) then
    raise exception 'VALIDATION: intelligence invalidation is immutable';
  end if;
  return new;
end; $$;

create trigger client_intelligence_consumptions_append_only
  before update or delete on public.client_intelligence_consumptions
  for each row execute function public.prevent_intelligence_consumption_mutation();

create or replace function public.invalidate_superseded_intelligence_consumers()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.release_id <> old.release_id then
    update public.client_intelligence_consumptions consumption
    set invalidated_at = now(),
        invalidation_reason = new.intelligence_domain || ' authority was superseded by release ' || new.release_id::text
    where consumption.client_id = new.client_id
      and consumption.invalidated_at is null
      and consumption.authority_snapshot -> new.intelligence_domain ->> 'release_id' = old.release_id::text;

    insert into public.client_intelligence_refresh_requests (
      client_id, intelligence_domain, request_type, reason,
      source_release_id, requested_by, metadata
    )
    select distinct dependency.client_id, dependency.dependent_domain, 'dependency',
      dependency.dependent_domain || ' depends on superseded ' || new.intelligence_domain || ' authority.',
      new.release_id, new.activated_by,
      jsonb_build_object(
        'superseded_upstream_release_id', old.release_id,
        'active_upstream_release_id', new.release_id,
        'upstream_domain', new.intelligence_domain,
        'dependent_release_id', dependency.dependent_release_id
      )
    from public.client_intelligence_release_dependencies dependency
    join public.client_intelligence_active_releases dependent_active
      on dependent_active.client_id = dependency.client_id
      and dependent_active.intelligence_domain = dependency.dependent_domain
      and dependent_active.release_id = dependency.dependent_release_id
    where dependency.client_id = new.client_id
      and dependency.upstream_release_id = old.release_id
      and dependency.material
    on conflict (client_id, intelligence_domain) where status in ('requested','claimed') do nothing;
  end if;
  return new;
end; $$;

create trigger client_intelligence_active_releases_invalidation
  after update on public.client_intelligence_active_releases
  for each row execute function public.invalidate_superseded_intelligence_consumers();

create or replace function public.record_intelligence_consumption(
  p_client_id uuid,
  p_consumer_type text,
  p_consumer_key text,
  p_purpose text,
  p_required_domains text[],
  p_expected_authority jsonb
) returns public.client_intelligence_consumptions
language plpgsql security definer set search_path = '' as $$
declare
  v_snapshot jsonb;
  v_existing public.client_intelligence_consumptions;
  v_domain text;
  v_expected_id text;
  v_expected_version integer;
begin
  if p_required_domains is null or cardinality(p_required_domains) = 0 then
    raise exception 'VALIDATION: at least one intelligence domain is required';
  end if;
  if not p_required_domains <@ array['market_os','avatar_os','competitor_os','association_os','brand_strategist']::text[] then
    raise exception 'VALIDATION: invalid intelligence domain';
  end if;
  if jsonb_typeof(p_expected_authority) <> 'object' then
    raise exception 'VALIDATION: expected intelligence authority must be an object';
  end if;

  if exists (
    select 1
    from unnest(p_required_domains) requested(domain)
    left join public.client_intelligence_active_releases active
      on active.client_id = p_client_id and active.intelligence_domain = requested.domain
    left join public.client_intelligence_releases release
      on release.id = active.release_id and release.client_id = p_client_id and release.status = 'approved'
    left join public.client_intelligence_refresh_policies policy
      on policy.client_id = p_client_id and policy.intelligence_domain = requested.domain
    where active.release_id is null or release.id is null or policy.id is null
      or now() >= release.approved_at + make_interval(days => policy.refresh_interval_days)
  ) then
    raise exception 'AUTHORITY: required active approved intelligence is missing or stale';
  end if;

  if exists (
    select 1
    from public.client_intelligence_active_releases dependent_active
    join public.client_intelligence_release_dependencies dependency
      on dependency.client_id = dependent_active.client_id
      and dependency.dependent_release_id = dependent_active.release_id
      and dependency.material
    left join public.client_intelligence_active_releases upstream_active
      on upstream_active.client_id = dependency.client_id
      and upstream_active.intelligence_domain = dependency.upstream_domain
    where dependent_active.client_id = p_client_id
      and dependent_active.intelligence_domain = any(p_required_domains)
      and upstream_active.release_id is distinct from dependency.upstream_release_id
  ) then
    raise exception 'AUTHORITY: intelligence dependency drift requires refresh';
  end if;

  select jsonb_object_agg(active.intelligence_domain, jsonb_build_object(
    'release_id', release.id,
    'version', release.version,
    'approved_at', release.approved_at
  ) order by active.intelligence_domain)
  into v_snapshot
  from public.client_intelligence_active_releases active
  join public.client_intelligence_releases release
    on release.id = active.release_id and release.client_id = active.client_id and release.status = 'approved'
  where active.client_id = p_client_id
    and active.intelligence_domain = any(p_required_domains);

  foreach v_domain in array p_required_domains loop
    v_expected_id := p_expected_authority -> v_domain ->> 'release_id';
    begin
      v_expected_version := (p_expected_authority -> v_domain ->> 'version')::integer;
    exception when invalid_text_representation then
      raise exception 'VALIDATION: expected intelligence version is invalid';
    end;
    if v_expected_id is null or v_expected_version is null
      or v_snapshot -> v_domain ->> 'release_id' is distinct from v_expected_id
      or (v_snapshot -> v_domain ->> 'version')::integer is distinct from v_expected_version
    then
      raise exception 'AUTHORITY: intelligence changed before downstream consumption was recorded';
    end if;
  end loop;

  select * into v_existing
  from public.client_intelligence_consumptions
  where client_id = p_client_id
    and consumer_type = trim(p_consumer_type)
    and consumer_key = trim(p_consumer_key)
    and purpose = trim(p_purpose);
  if found then
    if v_existing.authority_snapshot <> v_snapshot then
      raise exception 'AUTHORITY: downstream consumer identity was already bound to different intelligence';
    end if;
    return v_existing;
  end if;

  insert into public.client_intelligence_consumptions (
    client_id, consumer_type, consumer_key, purpose, authority_snapshot, consumed_by
  ) values (
    p_client_id, trim(p_consumer_type), trim(p_consumer_key), trim(p_purpose), v_snapshot, auth.uid()
  ) returning * into v_existing;
  return v_existing;
end; $$;

create or replace function public.request_intelligence_refresh(
  p_client_id uuid,
  p_intelligence_domain text,
  p_reason text
) returns public.client_intelligence_refresh_requests
language plpgsql security definer set search_path = '' as $$
declare v_request public.client_intelligence_refresh_requests;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then
    raise exception 'AUTH: staff role required';
  end if;
  if not (p_client_id = any(public.auth_client_ids())) then raise exception 'AUTH: client access required'; end if;
  if p_intelligence_domain not in ('market_os','avatar_os','competitor_os','association_os','brand_strategist') then
    raise exception 'VALIDATION: invalid intelligence domain';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'VALIDATION: refresh reason required'; end if;

  select * into v_request from public.client_intelligence_refresh_requests
  where client_id = p_client_id and intelligence_domain = p_intelligence_domain
    and status in ('requested','claimed')
  order by requested_at desc limit 1;
  if found then return v_request; end if;

  insert into public.client_intelligence_refresh_requests (
    client_id, intelligence_domain, request_type, reason, requested_by
  ) values (
    p_client_id, p_intelligence_domain, 'manual', trim(p_reason), auth.uid()
  ) returning * into v_request;

  insert into public.activity_log (
    client_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    p_client_id, 'intelligence_refresh_requested',
    replace(p_intelligence_domain, '_', ' ') || ' refresh requested.',
    'client_intelligence_refresh_request', v_request.id,
    jsonb_build_object('intelligence_domain', p_intelligence_domain, 'request_type', 'manual')
  );
  return v_request;
end; $$;

create or replace function public.enqueue_due_intelligence_refreshes()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  insert into public.client_intelligence_refresh_requests (
    client_id, intelligence_domain, request_type, reason, source_release_id, metadata
  )
  select active.client_id, active.intelligence_domain, 'scheduled',
    'The domain-specific refresh policy reached its due window.', release.id,
    jsonb_build_object(
      'approved_at', release.approved_at,
      'refresh_interval_days', policy.refresh_interval_days,
      'due_warning_days', policy.due_warning_days
    )
  from public.client_intelligence_active_releases active
  join public.client_intelligence_releases release on release.id = active.release_id and release.status = 'approved'
  join public.client_intelligence_refresh_policies policy
    on policy.client_id = active.client_id and policy.intelligence_domain = active.intelligence_domain
  where policy.scheduled_refresh_enabled
    and now() >= release.approved_at + make_interval(days => policy.refresh_interval_days - policy.due_warning_days)
  on conflict (client_id, intelligence_domain) where status in ('requested','claimed') do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

create or replace function public.create_intelligence_change_proposal(
  p_client_id uuid,
  p_target_kind text,
  p_target_domain text,
  p_target_release_id uuid,
  p_proposal_type text,
  p_title text,
  p_summary text,
  p_rationale text,
  p_evidence jsonb,
  p_priority text,
  p_source_type text,
  p_source_key text default null
) returns public.client_intelligence_change_proposals
language plpgsql security definer set search_path = '' as $$
declare
  v_proposal public.client_intelligence_change_proposals;
  v_is_service boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  if not v_is_service then
    if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
    if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
    if not (p_client_id = any(public.auth_client_ids())) then raise exception 'AUTH: client access required'; end if;
  end if;
  insert into public.client_intelligence_change_proposals (
    client_id, target_kind, target_domain, target_release_id, proposal_type,
    title, summary, rationale, evidence, priority, source_type, source_key, created_by
  ) values (
    p_client_id, p_target_kind, p_target_domain, p_target_release_id, p_proposal_type,
    trim(p_title), trim(p_summary), trim(p_rationale), coalesce(p_evidence, '{}'::jsonb),
    coalesce(p_priority, 'normal'), trim(p_source_type), nullif(trim(coalesce(p_source_key, '')), ''), auth.uid()
  ) returning * into v_proposal;
  return v_proposal;
end; $$;

create or replace function public.review_intelligence_change_proposal(
  p_proposal_id uuid,
  p_decision text,
  p_note text default null
) returns public.client_intelligence_change_proposals
language plpgsql security definer set search_path = '' as $$
declare v_proposal public.client_intelligence_change_proposals;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  if p_decision not in ('approved','dismissed','converted_to_draft') then raise exception 'VALIDATION: invalid proposal decision'; end if;
  select * into v_proposal from public.client_intelligence_change_proposals where id = p_proposal_id for update;
  if not found then raise exception 'NOT_FOUND: intelligence change proposal'; end if;
  if not (v_proposal.client_id = any(public.auth_client_ids())) then raise exception 'AUTH: client access required'; end if;
  if v_proposal.status not in ('needs_review','approved') then raise exception 'VALIDATION: proposal is already terminal'; end if;
  if p_decision = 'converted_to_draft' and v_proposal.status <> 'approved' then raise exception 'VALIDATION: approve the proposal before converting it to a draft'; end if;

  update public.client_intelligence_change_proposals set
    status = p_decision,
    reviewed_by = auth.uid(),
    reviewer_note = nullif(trim(coalesce(p_note, '')), ''),
    reviewed_at = now()
  where id = p_proposal_id returning * into v_proposal;

  insert into public.activity_log (
    client_id, event_type, plain_english_message, object_type, object_id, metadata
  ) values (
    v_proposal.client_id, 'intelligence_change_proposal_' || p_decision,
    v_proposal.title || ' proposal marked ' || replace(p_decision, '_', ' ') || '.',
    'client_intelligence_change_proposal', v_proposal.id,
    jsonb_build_object('target_kind', v_proposal.target_kind, 'target_domain', v_proposal.target_domain, 'decision', p_decision)
  );
  return v_proposal;
end; $$;

-- Approval still owns activation. The only 2A-F additions are dependency
-- materialisation and the existing pointer update's operational trigger.
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
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  if p_decision not in ('approved','changes_requested','rejected') then raise exception 'VALIDATION: invalid approval decision'; end if;

  select * into v_release from public.client_intelligence_releases where id = p_release_id for update;
  if not found then raise exception 'NOT_FOUND: intelligence release'; end if;
  if not (v_release.client_id = any(public.auth_client_ids())) then raise exception 'AUTH: client access required'; end if;
  if v_release.status <> 'needs_review' then raise exception 'VALIDATION: release must be awaiting review'; end if;

  if p_decision = 'approved' then
    if not exists (select 1 from public.client_intelligence_records record where record.release_id = v_release.id and record.client_id = v_release.client_id) then
      raise exception 'VALIDATION: release has no structured domain records';
    end if;
    perform public.sync_intelligence_release_dependencies(v_release.id);
    v_resulting_status := 'approved';
    update public.client_intelligence_releases set status = 'approved', approved_at = now()
    where id = v_release.id returning * into v_release;

    select release.* into v_previous
    from public.client_intelligence_active_releases active
    join public.client_intelligence_releases release on release.id = active.release_id
    where active.client_id = v_release.client_id
      and active.intelligence_domain = v_release.intelligence_domain
      and active.release_id <> v_release.id
    for update of release;
    if found then
      update public.client_intelligence_releases set status = 'superseded', superseded_at = now() where id = v_previous.id;
    end if;
    insert into public.client_intelligence_active_releases (
      client_id, intelligence_domain, release_id, activated_by, activated_at
    ) values (
      v_release.client_id, v_release.intelligence_domain, v_release.id, auth.uid(), now()
    ) on conflict (client_id, intelligence_domain) do update set
      release_id = excluded.release_id, activated_by = excluded.activated_by, activated_at = excluded.activated_at;

    update public.client_intelligence_refresh_requests
    set status = 'completed', completed_at = now(), updated_at = now()
    where client_id = v_release.client_id
      and intelligence_domain = v_release.intelligence_domain
      and status in ('requested', 'claimed');
  elsif p_decision = 'changes_requested' then
    v_resulting_status := 'draft';
    update public.client_intelligence_releases set status = 'draft', submitted_at = null
    where id = v_release.id returning * into v_release;
  else
    v_resulting_status := 'archived';
    update public.client_intelligence_releases set status = 'archived', archived_at = now()
    where id = v_release.id returning * into v_release;
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
    v_release.client_id, 'intelligence_release_' || p_decision,
    v_release.title || ' review decision: ' || replace(p_decision, '_', ' ') || '.',
    'client_intelligence_release', v_release.id,
    jsonb_build_object('intelligence_domain', v_release.intelligence_domain, 'version', v_release.version, 'decision', p_decision)
  );
  return v_release;
end; $$;

create view public.client_intelligence_operational_status
with (security_invoker = true) as
select
  client.id as client_id,
  client.name as client_name,
  domain.intelligence_domain,
  active.release_id as active_release_id,
  active_release.version as active_version,
  active_release.approved_at,
  latest_release.id as latest_release_id,
  latest_release.version as latest_version,
  latest_release.status as latest_release_status,
  latest_run.status as latest_run_status,
  latest_run.failure_code,
  latest_run.failure_message,
  policy.refresh_interval_days,
  policy.due_warning_days,
  policy.scheduled_refresh_enabled,
  case
    when active_release.id is null or policy.id is null then 'not_available'
    when now() >= active_release.approved_at + make_interval(days => policy.refresh_interval_days) then 'stale'
    when now() >= active_release.approved_at + make_interval(days => policy.refresh_interval_days - policy.due_warning_days) then 'due'
    else 'fresh'
  end as freshness,
  case
    when active_release.id is null then 'missing'
    when exists (
      select 1 from public.client_intelligence_release_dependencies dependency
      left join public.client_intelligence_active_releases upstream
        on upstream.client_id = dependency.client_id and upstream.intelligence_domain = dependency.upstream_domain
      where dependency.dependent_release_id = active_release.id
        and dependency.material and upstream.release_id is distinct from dependency.upstream_release_id
    ) then 'drifted'
    else 'current'
  end as dependency_status,
  exists (
    select 1 from public.client_intelligence_refresh_requests request
    where request.client_id = client.id and request.intelligence_domain = domain.intelligence_domain
      and request.status in ('requested','claimed')
  ) as refresh_pending,
  (
    select count(*)::integer from public.client_intelligence_change_proposals proposal
    where proposal.client_id = client.id
      and proposal.status = 'needs_review'
      and (proposal.target_domain = domain.intelligence_domain or (proposal.target_kind = 'context' and domain.intelligence_domain = 'market_os'))
  ) as pending_proposal_count
from public.clients client
cross join (values
  ('market_os'::text), ('avatar_os'::text), ('competitor_os'::text),
  ('association_os'::text), ('brand_strategist'::text)
) domain(intelligence_domain)
left join public.client_intelligence_active_releases active
  on active.client_id = client.id and active.intelligence_domain = domain.intelligence_domain
left join public.client_intelligence_releases active_release on active_release.id = active.release_id
left join public.client_intelligence_refresh_policies policy
  on policy.client_id = client.id and policy.intelligence_domain = domain.intelligence_domain
left join lateral (
  select release.id, release.version, release.status
  from public.client_intelligence_releases release
  where release.client_id = client.id and release.intelligence_domain = domain.intelligence_domain
  order by release.version desc limit 1
) latest_release on true
left join lateral (
  select run.status, run.failure_code, run.failure_message
  from public.client_research_runs run
  where run.client_id = client.id and run.intelligence_domain = domain.intelligence_domain
  order by run.created_at desc limit 1
) latest_run on true;

create trigger client_intelligence_refresh_requests_updated_at
  before update on public.client_intelligence_refresh_requests
  for each row execute function public.set_updated_at();
create trigger client_intelligence_change_proposals_updated_at
  before update on public.client_intelligence_change_proposals
  for each row execute function public.set_updated_at();

alter table public.client_intelligence_release_dependencies enable row level security;
alter table public.client_intelligence_refresh_requests enable row level security;
alter table public.client_intelligence_consumptions enable row level security;
alter table public.client_intelligence_change_proposals enable row level security;

revoke all on public.client_intelligence_release_dependencies, public.client_intelligence_refresh_requests,
  public.client_intelligence_consumptions, public.client_intelligence_change_proposals from public, anon, authenticated;
grant select on public.client_intelligence_release_dependencies, public.client_intelligence_refresh_requests,
  public.client_intelligence_consumptions, public.client_intelligence_change_proposals to authenticated;
grant all on public.client_intelligence_release_dependencies, public.client_intelligence_refresh_requests,
  public.client_intelligence_consumptions, public.client_intelligence_change_proposals to service_role;

create policy client_intelligence_dependencies_select on public.client_intelligence_release_dependencies
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_intelligence_refresh_requests_select on public.client_intelligence_refresh_requests
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_intelligence_consumptions_select on public.client_intelligence_consumptions
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_intelligence_change_proposals_select on public.client_intelligence_change_proposals
  for select to authenticated using (client_id = any(public.auth_client_ids()));

revoke all on public.client_intelligence_operational_status from public, anon;
grant select on public.client_intelligence_operational_status to authenticated, service_role;

revoke all on function public.sync_intelligence_release_dependencies(uuid) from public, anon, authenticated;
grant execute on function public.sync_intelligence_release_dependencies(uuid) to service_role;
revoke all on function public.record_intelligence_consumption(uuid,text,text,text,text[],jsonb) from public, anon, authenticated;
grant execute on function public.record_intelligence_consumption(uuid,text,text,text,text[],jsonb) to service_role;
revoke all on function public.request_intelligence_refresh(uuid,text,text) from public, anon;
grant execute on function public.request_intelligence_refresh(uuid,text,text) to authenticated, service_role;
revoke all on function public.enqueue_due_intelligence_refreshes() from public, anon, authenticated;
grant execute on function public.enqueue_due_intelligence_refreshes() to service_role;
revoke all on function public.create_intelligence_change_proposal(uuid,text,text,uuid,text,text,text,text,jsonb,text,text,text) from public, anon;
grant execute on function public.create_intelligence_change_proposal(uuid,text,text,uuid,text,text,text,text,jsonb,text,text,text) to authenticated, service_role;
revoke all on function public.review_intelligence_change_proposal(uuid,text,text) from public, anon;
grant execute on function public.review_intelligence_change_proposal(uuid,text,text) to authenticated, service_role;

comment on table public.client_intelligence_release_dependencies is
  'Derived dependency graph between immutable intelligence releases. Drift affects readiness, never approved content.';
comment on table public.client_intelligence_consumptions is
  'Append-only ledger of the exact active approved intelligence versions a downstream output consumed.';
comment on table public.client_intelligence_refresh_requests is
  'Recoverable manual, scheduled, and dependency-driven refresh command queue. A request never auto-approves a release.';
comment on table public.client_intelligence_change_proposals is
  'Review queue for feedback-driven Context or intelligence changes. Approval never mutates existing authority.';
comment on view public.client_intelligence_operational_status is
  'Client/domain portfolio status across active authority, freshness, dependency drift, runs, refresh requests, and proposals.';

commit;
