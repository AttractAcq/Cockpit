-- Workflow UI Increment 3: audited asset-group warning acknowledgements and
-- partial completeness acceptance. Held migration; do not apply until reviewed.

alter table public.client_asset_generation_jobs
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references auth.users(id),
  add column if not exists closure_reason text,
  add column if not exists closure_type text
    check (closure_type is null or closure_type in ('completed','cancelled','partial_accepted')),
  add column if not exists accepted_partial boolean not null default false,
  add column if not exists accepted_output_count integer check (accepted_output_count is null or accepted_output_count > 0),
  add column if not exists accepted_sequence_indexes integer[];

alter table public.client_asset_generation_items
  drop constraint if exists client_asset_generation_items_status_check;
alter table public.client_asset_generation_items
  add constraint client_asset_generation_items_status_check
  check (status in ('queued','processing','complete','failed','cancelled'));

create table if not exists public.client_asset_group_warning_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  asset_group_ref text not null,
  warning_code text not null check (length(trim(warning_code)) > 0),
  warning_fingerprint text not null check (length(trim(warning_fingerprint)) > 0),
  dismissed_by uuid not null references auth.users(id),
  dismissed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (client_id, asset_group_ref, warning_code, warning_fingerprint)
);

create index if not exists client_asset_group_warning_ack_client_idx
  on public.client_asset_group_warning_acknowledgements (client_id, asset_group_ref, warning_code);

create table if not exists public.client_asset_group_completeness_overrides (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  asset_group_ref text not null,
  generation_job_id uuid not null references public.client_asset_generation_jobs(id),
  production_brief_id uuid references public.client_production_briefs(id),
  original_expected_count integer not null check (original_expected_count > 0),
  actual_count_at_acceptance integer not null check (actual_count_at_acceptance > 0),
  accepted_output_count integer not null check (accepted_output_count > 0),
  accepted_sequence_indexes integer[] not null,
  missing_sequence_indexes integer[] not null default '{}',
  override_reason text not null check (length(trim(override_reason)) >= 8),
  overridden_by uuid not null references auth.users(id),
  overridden_at timestamptz not null default now(),
  source_job_status text not null,
  source_job_snapshot jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoked_reason text,
  created_at timestamptz not null default now(),
  constraint client_asset_group_completeness_override_seq_nonempty
    check (array_length(accepted_sequence_indexes, 1) is not null)
);

create unique index if not exists client_asset_group_one_active_completeness_override
  on public.client_asset_group_completeness_overrides (client_id, asset_group_ref)
  where is_active and revoked_at is null;

create index if not exists client_asset_group_completeness_override_client_idx
  on public.client_asset_group_completeness_overrides (client_id, asset_group_ref, created_at desc);

alter table public.client_asset_group_warning_acknowledgements enable row level security;
alter table public.client_asset_group_completeness_overrides enable row level security;

revoke all on public.client_asset_group_warning_acknowledgements from anon, authenticated;
revoke all on public.client_asset_group_completeness_overrides from anon, authenticated;
grant select on public.client_asset_group_warning_acknowledgements to authenticated;
grant select on public.client_asset_group_completeness_overrides to authenticated;

drop policy if exists client_asset_group_warning_ack_staff_select on public.client_asset_group_warning_acknowledgements;
create policy client_asset_group_warning_ack_staff_select
  on public.client_asset_group_warning_acknowledgements
  for select to authenticated
  using (public.auth_role() in ('admin','account_manager','editor'));

drop policy if exists client_asset_group_completeness_override_staff_select on public.client_asset_group_completeness_overrides;
create policy client_asset_group_completeness_override_staff_select
  on public.client_asset_group_completeness_overrides
  for select to authenticated
  using (public.auth_role() in ('admin','account_manager','editor'));

create or replace function public.acknowledge_asset_group_warning(
  p_asset_group_ref text,
  p_warning_code text,
  p_warning_fingerprint text
) returns public.client_asset_group_warning_acknowledgements
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_role text := public.auth_role();
  v_client_id uuid;
  v_ack public.client_asset_group_warning_acknowledgements;
begin
  if v_user is null then raise exception 'AUTH: login required'; end if;
  if coalesce(v_role, '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  if nullif(trim(p_asset_group_ref), '') is null then raise exception 'asset_group_ref is required'; end if;
  if nullif(trim(p_warning_code), '') is null then raise exception 'warning_code is required'; end if;
  if nullif(trim(p_warning_fingerprint), '') is null then raise exception 'warning_fingerprint is required'; end if;

  select a.client_id into v_client_id
  from public.client_assets a
  where a.asset_group_ref = p_asset_group_ref
  order by a.created_at desc
  limit 1;

  if v_client_id is null then
    select j.client_id into v_client_id
    from public.client_asset_generation_jobs j
    where j.asset_group_ref = p_asset_group_ref
    order by j.created_at desc
    limit 1;
  end if;

  if v_client_id is null then raise exception 'asset group not found'; end if;

  insert into public.client_asset_group_warning_acknowledgements
    (client_id, asset_group_ref, warning_code, warning_fingerprint, dismissed_by, dismissed_at)
  values
    (v_client_id, p_asset_group_ref, p_warning_code, p_warning_fingerprint, v_user, now())
  on conflict (client_id, asset_group_ref, warning_code, warning_fingerprint)
  do update set dismissed_by = excluded.dismissed_by, dismissed_at = excluded.dismissed_at
  returning * into v_ack;

  insert into public.activity_log (client_id, event_type, plain_english_message, metadata)
  values (
    v_client_id,
    'asset_group_warning_dismissed',
    p_asset_group_ref || ' warning dismissed: ' || p_warning_code || '.',
    jsonb_build_object(
      'client_id', v_client_id,
      'asset_group_ref', p_asset_group_ref,
      'warning_code', p_warning_code,
      'warning_fingerprint', p_warning_fingerprint,
      'operator_user_id', v_user,
      'operator_role', v_role,
      'target_type', 'asset_group',
      'target_id', p_asset_group_ref,
      'route_tab', 'assets'
    )
  );

  return v_ack;
end $$;

create or replace function public.accept_partial_asset_group(
  p_asset_group_ref text,
  p_generation_job_id uuid,
  p_reason text,
  p_accepted_sequence_indexes integer[] default null
) returns public.client_asset_group_completeness_overrides
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_role text := public.auth_role();
  v_job public.client_asset_generation_jobs;
  v_expected integer;
  v_actual integer;
  v_accepted integer[];
  v_missing integer[];
  v_duplicate_count integer;
  v_cancelled integer := 0;
  v_override public.client_asset_group_completeness_overrides;
  v_current_sequence integer[];
begin
  if v_user is null then raise exception 'AUTH: login required'; end if;
  if coalesce(v_role, '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  if nullif(trim(p_asset_group_ref), '') is null then raise exception 'asset_group_ref is required'; end if;
  if nullif(trim(p_reason), '') is null or length(trim(p_reason)) < 8 then raise exception 'A reason of at least 8 characters is required'; end if;

  select * into v_job
  from public.client_asset_generation_jobs
  where id = p_generation_job_id
  for update;

  if not found then raise exception 'generation job not found'; end if;
  if v_job.asset_group_ref <> p_asset_group_ref then raise exception 'job/group mismatch'; end if;
  if v_job.closed_at is not null or v_job.accepted_partial then raise exception 'generation job is already closed'; end if;
  if exists (
    select 1 from public.client_distribution_records d
    where d.client_id = v_job.client_id
      and d.asset_group_ref = p_asset_group_ref
      and d.publish_status in ('ready','scheduled','publishing','published','needs_reconciliation')
  ) then raise exception 'asset group has a publication conflict'; end if;

  perform 1
  from public.client_asset_generation_items i
  where i.generation_job_id = v_job.id
  for update;

  perform 1
  from public.client_assets a
  where a.client_id = v_job.client_id
    and a.production_brief_id = v_job.production_brief_id
    and a.asset_group_ref = p_asset_group_ref
    and coalesce(a.is_current, true)
  for update;

  perform 1
  from public.client_asset_group_completeness_overrides o
  where o.client_id = v_job.client_id and o.asset_group_ref = p_asset_group_ref and o.is_active and o.revoked_at is null
  for update;
  if found then raise exception 'an active partial acceptance already exists for this group'; end if;

  select count(*)::int into v_actual
  from public.client_assets a
  where a.client_id = v_job.client_id
    and a.production_brief_id = v_job.production_brief_id
    and a.asset_group_ref = p_asset_group_ref
    and coalesce(a.is_current, true)
    and a.status not in ('archived','rejected');

  if v_actual < 1 then raise exception 'cannot accept a partial group with no current assets'; end if;
  if v_actual >= v_job.expected_output_count then raise exception 'asset group is already complete'; end if;
  if exists (
    select 1 from public.client_assets a
    where a.client_id = v_job.client_id
      and a.production_brief_id = v_job.production_brief_id
      and a.asset_group_ref = p_asset_group_ref
      and coalesce(a.is_current, true)
      and a.status = 'approved'
  ) then raise exception 'approved group cannot be partially accepted'; end if;

  select count(*)::int into v_duplicate_count
  from (
    select a.sequence_index
    from public.client_assets a
    where a.client_id = v_job.client_id
      and a.production_brief_id = v_job.production_brief_id
      and a.asset_group_ref = p_asset_group_ref
      and coalesce(a.is_current, true)
      and a.status not in ('archived','rejected')
    group by a.sequence_index
    having count(*) > 1
  ) dup;
  if v_duplicate_count > 0 then raise exception 'duplicate current frame state blocks partial acceptance'; end if;

  select array_agg(a.sequence_index order by a.sequence_index) into v_current_sequence
  from public.client_assets a
  where a.client_id = v_job.client_id
    and a.production_brief_id = v_job.production_brief_id
    and a.asset_group_ref = p_asset_group_ref
    and coalesce(a.is_current, true)
    and a.status not in ('archived','rejected');

  select array_agg(seq order by seq) into v_accepted
  from unnest(coalesce(p_accepted_sequence_indexes, '{}')) seq;

  if array_length(v_accepted, 1) is null then raise exception 'accepted sequence cannot be empty'; end if;
  if array_length(v_accepted, 1) <> (select count(distinct seq)::int from unnest(v_accepted) seq) then
    raise exception 'accepted sequence contains duplicates or invalid indexes';
  end if;
  if v_accepted <> v_current_sequence then
    raise exception 'STALE_ASSET_GROUP: asset group changed while under review';
  end if;

  v_expected := v_job.expected_output_count;
  select coalesce(array_agg(n order by n), '{}') into v_missing
  from generate_series(1, v_expected) n
  where not (n = any(v_accepted));

  with cancelled as (
    update public.client_asset_generation_items
    set status = 'cancelled', last_error = null, updated_at = now()
    where generation_job_id = v_job.id and status in ('queued','processing')
    returning id
  )
  select count(*)::int into v_cancelled from cancelled;

  update public.client_asset_generation_jobs
  set status = 'partial',
      closed_at = now(),
      closed_by = v_user,
      closure_reason = trim(p_reason),
      closure_type = 'partial_accepted',
      accepted_partial = true,
      accepted_output_count = array_length(v_accepted, 1),
      accepted_sequence_indexes = v_accepted,
      completed_output_count = v_actual,
      updated_at = now()
  where id = v_job.id;

  insert into public.client_asset_group_completeness_overrides (
    client_id, asset_group_ref, generation_job_id, production_brief_id,
    original_expected_count, actual_count_at_acceptance, accepted_output_count,
    accepted_sequence_indexes, missing_sequence_indexes, override_reason,
    overridden_by, overridden_at, source_job_status, source_job_snapshot
  ) values (
    v_job.client_id, p_asset_group_ref, v_job.id, v_job.production_brief_id,
    v_expected, v_actual, array_length(v_accepted, 1),
    v_accepted, v_missing, trim(p_reason),
    v_user, now(), v_job.status,
    to_jsonb(v_job) || jsonb_build_object('cancelled_item_count', v_cancelled)
  )
  returning * into v_override;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (
    v_job.client_id,
    'asset_group_partial_accepted',
    p_asset_group_ref || ' accepted as partial: ' || array_length(v_accepted, 1)::text || ' of ' || v_expected::text || ' frames.',
    'client_asset_generation_job',
    v_job.id,
    jsonb_build_object(
      'client_id', v_job.client_id,
      'asset_group_ref', p_asset_group_ref,
      'generation_job_id', v_job.id,
      'production_brief_id', v_job.production_brief_id,
      'source_ref', v_job.source_ref,
      'original_expected_count', v_expected,
      'actual_count', v_actual,
      'accepted_output_count', array_length(v_accepted, 1),
      'accepted_sequence_indexes', v_accepted,
      'missing_sequence_indexes', v_missing,
      'operator_user_id', v_user,
      'operator_role', v_role,
      'reason', trim(p_reason),
      'cancelled_item_count', v_cancelled,
      'target_type', 'asset_group',
      'target_id', p_asset_group_ref,
      'route_tab', 'assets'
    )
  );

  if v_cancelled > 0 then
    insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
    values (
      v_job.client_id,
      'asset_generation_items_cancelled',
      v_cancelled::text || ' unfinished generation item' || case when v_cancelled = 1 then '' else 's' end || ' cancelled for ' || p_asset_group_ref || '.',
      'client_asset_generation_job',
      v_job.id,
      jsonb_build_object(
        'client_id', v_job.client_id,
        'asset_group_ref', p_asset_group_ref,
        'generation_job_id', v_job.id,
        'production_brief_id', v_job.production_brief_id,
        'source_ref', v_job.source_ref,
        'cancelled_item_count', v_cancelled,
        'target_type', 'asset_group',
        'target_id', p_asset_group_ref,
        'route_tab', 'assets'
      )
    );
  end if;

  return v_override;
end $$;

create or replace function public.review_asset_group(
  p_client_id uuid,
  p_asset_group_ref text,
  p_status public.review_state
) returns setof public.client_assets
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_role text := public.auth_role();
  v_job public.client_asset_generation_jobs;
  v_expected integer;
  v_actual integer;
  v_override public.client_asset_group_completeness_overrides;
  v_dup integer;
  v_mismatch integer;
  v_current_sequence integer[];
begin
  if v_user is null then raise exception 'AUTH: login required'; end if;
  if coalesce(v_role, '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  if p_status not in ('needs_review','approved','rejected','archived') then raise exception 'invalid review status'; end if;

  select * into v_job
  from public.client_asset_generation_jobs j
  where j.client_id = p_client_id and j.asset_group_ref = p_asset_group_ref
  order by j.created_at desc
  limit 1
  for update;

  perform 1
  from public.client_assets a
  where a.client_id = p_client_id and a.asset_group_ref = p_asset_group_ref and coalesce(a.is_current, true)
  for update;

  if p_status = 'approved' then
    select count(*)::int into v_actual
    from public.client_assets a
    where a.client_id = p_client_id and a.asset_group_ref = p_asset_group_ref and coalesce(a.is_current, true);
    if v_actual < 1 then raise exception 'asset group not found'; end if;

    select count(*)::int into v_dup
    from (
      select sequence_index from public.client_assets
      where client_id = p_client_id and asset_group_ref = p_asset_group_ref and coalesce(is_current, true)
      group by sequence_index having count(*) > 1
    ) d;
    if v_dup > 0 then raise exception 'duplicate current frame state blocks approval'; end if;

    select count(*)::int into v_mismatch
    from public.client_assets a
    where a.client_id = p_client_id
      and a.asset_group_ref = p_asset_group_ref
      and coalesce(a.is_current, true)
      and a.metadata->>'visual_mode' in ('uploaded_background','uploaded_insert')
      and a.metadata->>'image_input_used' = 'false';
    if v_mismatch > 0 then raise exception 'visual input mismatch blocks approval'; end if;

    v_expected := coalesce(v_job.expected_output_count, (
      select max((a.metadata->>'sequence_count')::integer)
      from public.client_assets a
      where a.client_id = p_client_id and a.asset_group_ref = p_asset_group_ref
        and jsonb_typeof(a.metadata->'sequence_count') = 'number'
    ), v_actual);

    select * into v_override
    from public.client_asset_group_completeness_overrides o
    where o.client_id = p_client_id and o.asset_group_ref = p_asset_group_ref and o.is_active and o.revoked_at is null
    order by o.created_at desc
    limit 1
    for update;

    if exists (
      select 1 from public.client_distribution_records d
      where d.client_id = p_client_id
        and d.asset_group_ref = p_asset_group_ref
        and d.publish_status in ('scheduled','publishing','published','needs_reconciliation')
    ) then raise exception 'asset group has a publication conflict'; end if;

    if v_job.id is not null and v_job.status in ('queued','processing') and coalesce(v_job.closure_type, '') <> 'partial_accepted' then
      raise exception 'generation is still in progress';
    end if;

    select array_agg(a.sequence_index order by a.sequence_index) into v_current_sequence
    from public.client_assets a
    where a.client_id = p_client_id and a.asset_group_ref = p_asset_group_ref and coalesce(a.is_current, true);

    if v_actual < v_expected then
      if v_override.id is null then raise exception 'incomplete group requires partial acceptance before approval'; end if;
      if v_override.accepted_output_count <> v_actual then raise exception 'partial acceptance no longer matches current frame count'; end if;
      if v_override.accepted_sequence_indexes <> v_current_sequence then raise exception 'partial acceptance sequence no longer matches current frames'; end if;
      if exists (
        select 1 from unnest(v_override.accepted_sequence_indexes) seq
        where not exists (
          select 1 from public.client_assets a
          where a.client_id = p_client_id and a.asset_group_ref = p_asset_group_ref and coalesce(a.is_current, true) and a.sequence_index = seq
        )
      ) then raise exception 'partial acceptance sequence no longer matches current frames'; end if;
      if exists (
        select 1 from public.client_assets a
        where a.client_id = p_client_id and a.asset_group_ref = p_asset_group_ref and coalesce(a.is_current, true)
          and not (a.sequence_index = any(v_override.accepted_sequence_indexes))
      ) then raise exception 'unexpected current frame invalidates partial acceptance'; end if;
    elsif v_override.id is not null and v_override.accepted_sequence_indexes <> v_current_sequence then
      raise exception 'partial acceptance sequence no longer matches current frames';
    end if;
  end if;

  return query
    update public.client_assets
    set status = p_status, updated_at = now(),
        metadata = case when p_status = 'approved' then
          metadata || jsonb_build_object(
            'partial_acceptance_override_id', v_override.id,
            'original_expected_count', v_override.original_expected_count,
            'accepted_output_count', v_override.accepted_output_count,
            'accepted_sequence_indexes', v_override.accepted_sequence_indexes
          )
        else metadata end
    where client_id = p_client_id
      and asset_group_ref = p_asset_group_ref
      and coalesce(is_current, true)
    returning *;
end $$;

create or replace function public.persist_asset_generation_result(
  p_generation_job_id uuid,
  p_generation_item_id uuid,
  p_storage_path text,
  p_mime_type text,
  p_width integer,
  p_height integer,
  p_generation_provider text,
  p_generation_model text,
  p_prompt_md text,
  p_metadata jsonb
) returns table(client_asset_id uuid, item_status text, completed_output_count integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.client_asset_generation_jobs;
  v_item public.client_asset_generation_items;
  v_asset_id uuid;
  v_completed integer;
  v_title text;
begin
  select * into v_job
  from public.client_asset_generation_jobs
  where id = p_generation_job_id
  for update;
  if not found then raise exception 'generation job not found'; end if;

  select * into v_item
  from public.client_asset_generation_items
  where id = p_generation_item_id
  for update;
  if not found then raise exception 'generation item not found'; end if;
  if v_item.generation_job_id <> v_job.id then raise exception 'item/job mismatch'; end if;
  if v_job.closed_at is not null
     or coalesce(v_job.accepted_partial, false)
     or coalesce(v_job.closure_type, '') in ('cancelled','partial_accepted') then
    raise exception 'GENERATION_CLOSED: generation job is closed';
  end if;
  if v_item.status <> 'processing' then raise exception 'GENERATION_ITEM_NOT_PROCESSING: item is not processing'; end if;
  if exists (
    select 1 from public.client_asset_group_completeness_overrides o
    where o.client_id = v_job.client_id and o.asset_group_ref = v_job.asset_group_ref and o.is_active and o.revoked_at is null
  ) then raise exception 'GENERATION_CLOSED: asset group has an active partial override'; end if;
  if exists (
    select 1 from public.client_assets a
    where a.client_id = v_job.client_id
      and a.asset_group_ref = v_job.asset_group_ref
      and coalesce(a.is_current, true)
      and a.status = 'approved'
  ) then raise exception 'asset group is already approved'; end if;
  if exists (
    select 1 from public.client_distribution_records d
    where d.client_id = v_job.client_id
      and d.asset_group_ref = v_job.asset_group_ref
      and d.publish_status in ('ready','scheduled','publishing','published','needs_reconciliation')
  ) then raise exception 'asset group has a publication conflict'; end if;

  v_title := case
    when v_job.expected_output_count = 1 then coalesce(v_job.generation_config->>'brief_title', v_job.source_ref)
    else coalesce(v_job.generation_config->>'brief_title', v_job.source_ref) || ' — ' ||
      case when v_job.asset_format = 'carousel' then 'Slide ' else 'Frame ' end || v_item.sequence_index::text
  end;

  insert into public.client_assets (
    client_id, production_brief_id, source_ref, asset_format, asset_group_ref,
    sequence_index, title, storage_bucket, storage_path, mime_type, width, height,
    status, generation_provider, generation_model, prompt_md, metadata
  ) values (
    v_job.client_id, v_job.production_brief_id, v_job.source_ref, v_job.asset_format, v_job.asset_group_ref,
    v_item.sequence_index, v_title, 'client-assets', p_storage_path, p_mime_type, p_width, p_height,
    'needs_review', p_generation_provider, p_generation_model, p_prompt_md, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_asset_id;

  update public.client_asset_generation_items
  set status = 'complete',
      storage_path = p_storage_path,
      client_asset_id = v_asset_id,
      last_error = null,
      updated_at = now()
  where id = v_item.id and status = 'processing';

  if not found then raise exception 'GENERATION_ITEM_NOT_PROCESSING: item completion refused'; end if;

  select count(*)::int into v_completed
  from public.client_asset_generation_items
  where generation_job_id = v_job.id and status = 'complete';

  update public.client_asset_generation_jobs
  set completed_output_count = v_completed, updated_at = now()
  where id = v_job.id;

  return query select v_asset_id, 'complete'::text, v_completed;
end $$;

create or replace function public.persist_regenerated_asset_frame(
  p_current_asset_id uuid,
  p_expected_new_version integer,
  p_storage_path text,
  p_mime_type text,
  p_width integer,
  p_height integer,
  p_generation_provider text,
  p_generation_model text,
  p_prompt_md text,
  p_metadata jsonb
) returns public.client_assets
language plpgsql security definer set search_path = '' as $$
declare
  v_current public.client_assets;
  v_job public.client_asset_generation_jobs;
  v_new_version integer;
  v_inserted public.client_assets;
begin
  select * into v_current
  from public.client_assets
  where id = p_current_asset_id
  for update;
  if not found then raise exception 'current asset not found'; end if;
  if not coalesce(v_current.is_current, true) then raise exception 'current version changed; reload before regenerating'; end if;

  if exists (
    select 1 from public.client_asset_group_completeness_overrides o
    where o.client_id = v_current.client_id and o.asset_group_ref = v_current.asset_group_ref and o.is_active and o.revoked_at is null
  ) then raise exception 'REGENERATION_CLOSED: asset group has an active partial override'; end if;

  select * into v_job
  from public.client_asset_generation_jobs j
  where j.client_id = v_current.client_id and j.asset_group_ref = v_current.asset_group_ref
  order by j.created_at desc
  limit 1
  for update;
  if found and (v_job.closed_at is not null or coalesce(v_job.accepted_partial, false) or coalesce(v_job.closure_type, '') in ('cancelled','partial_accepted')) then
    raise exception 'REGENERATION_CLOSED: generation job is closed';
  end if;

  if exists (
    select 1 from public.client_distribution_records d
    where d.client_id = v_current.client_id
      and d.asset_group_ref = v_current.asset_group_ref
      and d.publish_status in ('ready','scheduled','publishing','published','needs_reconciliation')
  ) then raise exception 'asset group has a publication conflict'; end if;

  select coalesce(max(version), 1) + 1 into v_new_version
  from public.client_assets
  where production_brief_id = v_current.production_brief_id
    and asset_group_ref = v_current.asset_group_ref
    and sequence_index = v_current.sequence_index;
  if v_new_version <> p_expected_new_version then raise exception 'current version changed; reload before regenerating'; end if;

  insert into public.client_assets (
    client_id, production_brief_id, source_ref, asset_format, asset_group_ref,
    sequence_index, version, is_current, title, storage_bucket, storage_path,
    mime_type, width, height, status, generation_provider, generation_model, prompt_md, metadata
  ) values (
    v_current.client_id, v_current.production_brief_id, v_current.source_ref, v_current.asset_format, v_current.asset_group_ref,
    v_current.sequence_index, v_new_version, false, v_current.title, 'client-assets', p_storage_path,
    p_mime_type, p_width, p_height, 'needs_review', p_generation_provider, p_generation_model, p_prompt_md, coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_inserted;

  update public.client_assets
  set is_current = false, regen_started_at = null, updated_at = now()
  where id = v_current.id;

  update public.client_assets
  set is_current = true, updated_at = now()
  where id = v_inserted.id
  returning * into v_inserted;

  return v_inserted;
end $$;

create or replace function public.claim_next_asset_generation_item(p_job_id uuid)
returns setof public.client_asset_generation_items
language sql
set search_path = ''
as $$
  update public.client_asset_generation_items i
  set status = 'processing', attempt_count = i.attempt_count + 1, updated_at = now()
  where i.id = (
    select c.id
    from public.client_asset_generation_items c
    join public.client_asset_generation_jobs j on j.id = c.generation_job_id
    where c.generation_job_id = p_job_id
      and c.status = 'queued'
      and j.closed_at is null
      and coalesce(j.accepted_partial, false) = false
      and coalesce(j.closure_type, '') not in ('cancelled','partial_accepted')
      and not exists (
        select 1 from public.client_asset_group_completeness_overrides o
        where o.client_id = j.client_id and o.asset_group_ref = j.asset_group_ref and o.is_active and o.revoked_at is null
      )
    order by c.sequence_index
    limit 1
    for update skip locked
  )
  returning i.*;
$$;

create or replace function public.requeue_stale_asset_generation_items(p_job_id uuid, p_older_than interval)
returns integer
language sql
set search_path = ''
as $$
  with updated as (
    update public.client_asset_generation_items i
    set status = 'queued', updated_at = now()
    from public.client_asset_generation_jobs j
    where i.generation_job_id = p_job_id
      and j.id = i.generation_job_id
      and j.closed_at is null
      and coalesce(j.accepted_partial, false) = false
      and i.status = 'processing'
      and i.updated_at < now() - p_older_than
    returning 1
  )
  select count(*)::int from updated;
$$;

revoke all on function public.acknowledge_asset_group_warning(text, text, text) from anon, public;
revoke all on function public.accept_partial_asset_group(text, uuid, text, integer[]) from anon, public;
revoke all on function public.review_asset_group(uuid, text, public.review_state) from anon, public;
revoke all on function public.persist_asset_generation_result(uuid, uuid, text, text, integer, integer, text, text, text, jsonb) from anon, authenticated, public;
revoke all on function public.persist_regenerated_asset_frame(uuid, integer, text, text, integer, integer, text, text, text, jsonb) from anon, authenticated, public;
grant execute on function public.acknowledge_asset_group_warning(text, text, text) to authenticated;
grant execute on function public.accept_partial_asset_group(text, uuid, text, integer[]) to authenticated;
grant execute on function public.review_asset_group(uuid, text, public.review_state) to authenticated;
grant execute on function public.persist_asset_generation_result(uuid, uuid, text, text, integer, integer, text, text, text, jsonb) to service_role;
grant execute on function public.persist_regenerated_asset_frame(uuid, integer, text, text, integer, integer, text, text, text, jsonb) to service_role;

revoke all on function public.claim_next_asset_generation_item(uuid) from anon, authenticated, public;
revoke all on function public.requeue_stale_asset_generation_items(uuid, interval) from anon, authenticated, public;
grant execute on function public.claim_next_asset_generation_item(uuid) to service_role;
grant execute on function public.requeue_stale_asset_generation_items(uuid, interval) to service_role;
