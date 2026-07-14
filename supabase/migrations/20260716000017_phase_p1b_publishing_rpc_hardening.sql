-- P1b Scheduled Publishing — security remediation. Moves every privileged
-- distribution transition behind scoped SECURITY DEFINER RPCs and locks down
-- direct table privileges so authenticated (staff) callers can no longer forge
-- publish_status / evidence / claim / retry fields via generic table writes.
-- Additive; no RLS policy is weakened. HELD — do not apply until re-reviewed.
--
-- Authorization model note: distribution records are STAFF-WIDE in this app (the
-- existing RLS SELECT/UPDATE policies gate on auth_role() IN
-- ('admin','account_manager','editor'), NOT on auth_client_ids()). auth_client_ids()
-- also returns '{}' for the 'editor' role, so per-client scoping here would break
-- editors and be stricter than the existing SELECT policy. These RPCs therefore
-- gate on the SAME staff-role vocabulary as the existing distribution policies.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Audit helper — never rolls back a valid transition if the log write fails.
create or replace function public._log_distribution_transition(
  p_client_id uuid, p_source_ref text, p_record_id uuid, p_action text,
  p_prev text, p_new text, p_detail text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.activity_log (client_id, event_type, plain_english_message, metadata)
    values (
      p_client_id, 'distribution_' || p_action,
      coalesce(p_source_ref, '?') || ': ' || p_action || ' (' || coalesce(p_prev, '?') || ' → ' || coalesce(p_new, '?') || ')',
      jsonb_build_object(
        'record_id', p_record_id, 'action', p_action,
        'previous_status', p_prev, 'new_status', p_new,
        'operator_user_id', auth.uid(), 'operator_role', public.auth_role(),
        'detail', p_detail, 'at', now()
      )
    );
  exception when others then null; -- audit failure must not undo a valid transition
  end;
end; $$;
revoke all on function public._log_distribution_transition(uuid, text, uuid, text, text, text, text) from public, anon, authenticated;

-- Common return shape for operator transition RPCs.
-- (Postgres composite via RETURNS TABLE on each function.)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1a. schedule_distribution_record — schedule / reschedule.
create or replace function public.schedule_distribution_record(
  p_record_id uuid, p_scheduled_at timestamptz, p_timezone text default null, p_planned_date date default null
) returns table(success boolean, record_id uuid, previous_status text, new_status text, message text)
language plpgsql security definer set search_path = '' as $$
declare rec public.client_distribution_records; v_prev text; v_settings jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  select * into rec from public.client_distribution_records where id = p_record_id for update;
  if not found then raise exception 'NOT_FOUND: distribution record %', p_record_id; end if;
  v_prev := rec.publish_status;
  if rec.publish_status = 'published' or rec.external_post_id is not null or rec.published_at is not null or rec.published_url is not null then
    raise exception 'REFUSED: published or evidence-bearing record cannot be scheduled';
  end if;
  if rec.publish_status not in ('ready','failed','cancelled','scheduled') then
    raise exception 'REFUSED: cannot schedule from status %', rec.publish_status;
  end if;
  if p_scheduled_at is null or p_scheduled_at < now() - interval '60 seconds' then
    raise exception 'REFUSED: scheduled time must be in the future';
  end if;
  v_settings := coalesce(rec.publish_settings, '{}'::jsonb);
  if p_timezone is not null then
    v_settings := jsonb_set(v_settings, '{meta}', coalesce(v_settings->'meta','{}'::jsonb) || jsonb_build_object('timezone', p_timezone), true);
  end if;
  update public.client_distribution_records
  set publish_status='scheduled', publish_mode='scheduled', scheduled_publish_at=p_scheduled_at,
      planned_publish_date=coalesce(p_planned_date, planned_publish_date), publish_settings=v_settings,
      claimed_at=null, claimed_by=null, permanent_failure=false, next_attempt_at=null, last_error=null, updated_at=now()
  where id=p_record_id;
  perform public._log_distribution_transition(rec.client_id, rec.source_ref, p_record_id, 'schedule', v_prev, 'scheduled', null);
  return query select true, p_record_id, v_prev, 'scheduled'::text, 'Scheduled.'::text;
end; $$;

-- 1b. cancel_distribution_record.
create or replace function public.cancel_distribution_record(p_record_id uuid)
returns table(success boolean, record_id uuid, previous_status text, new_status text, message text)
language plpgsql security definer set search_path = '' as $$
declare rec public.client_distribution_records; v_prev text;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  select * into rec from public.client_distribution_records where id = p_record_id for update;
  if not found then raise exception 'NOT_FOUND: distribution record %', p_record_id; end if;
  v_prev := rec.publish_status;
  if rec.publish_status = 'published' or rec.external_post_id is not null or rec.published_at is not null or rec.published_url is not null then
    raise exception 'REFUSED: published or evidence-bearing record cannot be cancelled';
  end if;
  if rec.publish_status not in ('ready','scheduled','failed','needs_reconciliation') then
    raise exception 'REFUSED: cannot cancel from status %', rec.publish_status;
  end if;
  update public.client_distribution_records
  set publish_status='cancelled', claimed_at=null, claimed_by=null, next_attempt_at=null, updated_at=now()
  where id=p_record_id; -- attempt_count + last_error retained as history
  perform public._log_distribution_transition(rec.client_id, rec.source_ref, p_record_id, 'cancel', v_prev, 'cancelled', null);
  return query select true, p_record_id, v_prev, 'cancelled'::text, 'Cancelled.'::text;
end; $$;

-- 1c. retry_distribution_record — only from 'failed'.
create or replace function public.retry_distribution_record(
  p_record_id uuid, p_override_permanent boolean default false, p_retry_at timestamptz default null
) returns table(success boolean, record_id uuid, previous_status text, new_status text, message text)
language plpgsql security definer set search_path = '' as $$
declare rec public.client_distribution_records; v_prev text; v_next timestamptz;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  select * into rec from public.client_distribution_records where id = p_record_id for update;
  if not found then raise exception 'NOT_FOUND: distribution record %', p_record_id; end if;
  v_prev := rec.publish_status;
  if rec.external_post_id is not null or rec.published_at is not null or rec.published_url is not null then
    raise exception 'REFUSED: evidence-bearing record cannot be retried';
  end if;
  if rec.publish_status <> 'failed' then
    raise exception 'REFUSED: retry is only allowed from failed (got %)', rec.publish_status;
  end if;
  if rec.permanent_failure and not p_override_permanent then
    raise exception 'REFUSED: permanent failure — an explicit override is required to retry';
  end if;
  v_next := coalesce(p_retry_at, now());
  if v_next < now() - interval '60 seconds' then raise exception 'REFUSED: retry time must not be in the past'; end if;
  update public.client_distribution_records
  set publish_status='scheduled', next_attempt_at=v_next, claimed_at=null, claimed_by=null,
      permanent_failure = case when p_override_permanent then false else permanent_failure end,
      last_error = 'Operator retry requested.', updated_at=now() -- prior last_error is preserved in client_publish_attempts
  where id=p_record_id; -- attempt_count retained (fresh attempts continue counting)
  perform public._log_distribution_transition(rec.client_id, rec.source_ref, p_record_id, 'retry', v_prev, 'scheduled',
    case when p_override_permanent then 'override_permanent_failure' else null end);
  return query select true, p_record_id, v_prev, 'scheduled'::text, 'Re-queued for retry.'::text;
end; $$;

-- 1d. reconcile_distribution_record — resolve needs_reconciliation only.
create or replace function public.reconcile_distribution_record(
  p_record_id uuid, p_action text, p_external_id text default null, p_confirm boolean default false
) returns table(success boolean, record_id uuid, previous_status text, new_status text, message text)
language plpgsql security definer set search_path = '' as $$
declare rec public.client_distribution_records; v_prev text; v_has_evidence boolean; v_ext text;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  if p_action not in ('confirm_published','reset_scheduled','cancel') then raise exception 'REFUSED: unknown reconcile action %', p_action; end if;
  select * into rec from public.client_distribution_records where id = p_record_id for update;
  if not found then raise exception 'NOT_FOUND: distribution record %', p_record_id; end if;
  v_prev := rec.publish_status;
  if rec.publish_status <> 'needs_reconciliation' then
    raise exception 'REFUSED: reconcile only applies to needs_reconciliation (got %)', rec.publish_status;
  end if;
  v_has_evidence := rec.external_post_id is not null or rec.published_at is not null or rec.published_url is not null;

  if p_action = 'confirm_published' then
    if not p_confirm then raise exception 'REFUSED: confirm_published requires explicit operator confirmation'; end if;
    if not v_has_evidence then
      if p_external_id is null or p_external_id !~ '^\d+$' then
        raise exception 'REFUSED: confirm_published needs existing evidence or a valid numeric external media id';
      end if;
      v_ext := p_external_id;
    else
      v_ext := rec.external_post_id;
    end if;
    update public.client_distribution_records
    set publish_status='published', external_post_id=coalesce(external_post_id, v_ext),
        published_at=coalesce(published_at, now()), claimed_at=null, claimed_by=null, last_error=null, updated_at=now()
    where id=p_record_id;
    perform public._log_distribution_transition(rec.client_id, rec.source_ref, p_record_id, 'reconcile_confirm_published', v_prev, 'published', v_ext);
    return query select true, p_record_id, v_prev, 'published'::text, 'Confirmed published.'::text;

  elsif p_action = 'reset_scheduled' then
    if v_has_evidence then raise exception 'REFUSED: evidence exists — cannot reset to scheduled (use confirm_published)'; end if;
    update public.client_distribution_records
    set publish_status='scheduled', next_attempt_at=now(), claimed_at=null, claimed_by=null, permanent_failure=false, last_error=null, updated_at=now()
    where id=p_record_id;
    perform public._log_distribution_transition(rec.client_id, rec.source_ref, p_record_id, 'reconcile_reset_scheduled', v_prev, 'scheduled', null);
    return query select true, p_record_id, v_prev, 'scheduled'::text, 'Re-queued after reconciliation.'::text;

  else -- cancel
    update public.client_distribution_records
    set publish_status='cancelled', claimed_at=null, claimed_by=null, updated_at=now()
    where id=p_record_id;
    perform public._log_distribution_transition(rec.client_id, rec.source_ref, p_record_id, 'reconcile_cancel', v_prev, 'cancelled', null);
    return query select true, p_record_id, v_prev, 'cancelled'::text, 'Cancelled after reconciliation.'::text;
  end if;
end; $$;

-- 1e. upsert_distribution_draft — the only INSERT/UPSERT path. Forces a safe
-- 'ready' draft with NO evidence/claim/retry fields settable by the caller.
create or replace function public.upsert_distribution_draft(
  p_client_id uuid, p_execution_month text, p_source_ref text, p_asset_group_ref text,
  p_sequence_index integer, p_sequence_count integer, p_production_brief_id uuid,
  p_asset_format text, p_title text, p_planned_date date,
  p_publish_payload jsonb, p_publish_settings jsonb
) returns public.client_distribution_records
language plpgsql security definer set search_path = '' as $$
declare rec public.client_distribution_records; existing public.client_distribution_records;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  select * into existing from public.client_distribution_records
    where client_id=p_client_id and asset_group_ref=p_asset_group_ref and sequence_index=coalesce(p_sequence_index,1) for update;
  if found then
    -- Never clobber a record that has moved past 'ready'.
    if existing.publish_status <> 'ready' then return existing; end if;
    update public.client_distribution_records
    set production_brief_id=p_production_brief_id, asset_format=p_asset_format, title=p_title,
        sequence_count=p_sequence_count, planned_publish_date=p_planned_date,
        publish_payload=coalesce(p_publish_payload,'{}'::jsonb), publish_settings=coalesce(p_publish_settings,'{}'::jsonb),
        execution_month=p_execution_month, updated_at=now()
    where id=existing.id returning * into rec;
    return rec;
  end if;
  insert into public.client_distribution_records (
    client_id, execution_month, source_ref, asset_group_ref, sequence_index, sequence_count,
    production_brief_id, asset_format, title, publish_status, platform, planned_publish_date,
    publish_payload, publish_settings
  ) values (
    p_client_id, p_execution_month, p_source_ref, p_asset_group_ref, coalesce(p_sequence_index,1), p_sequence_count,
    p_production_brief_id, p_asset_format, p_title, 'ready', 'instagram', p_planned_date,
    coalesce(p_publish_payload,'{}'::jsonb), coalesce(p_publish_settings,'{}'::jsonb)
  ) returning * into rec;
  return rec;
end; $$;

-- Operator RPCs: EXECUTE to authenticated (they self-gate on staff role).
revoke all on function public.schedule_distribution_record(uuid, timestamptz, text, date) from public, anon;
revoke all on function public.cancel_distribution_record(uuid) from public, anon;
revoke all on function public.retry_distribution_record(uuid, boolean, timestamptz) from public, anon;
revoke all on function public.reconcile_distribution_record(uuid, text, text, boolean) from public, anon;
revoke all on function public.upsert_distribution_draft(uuid, text, text, text, integer, integer, uuid, text, text, date, jsonb, jsonb) from public, anon;
grant execute on function public.schedule_distribution_record(uuid, timestamptz, text, date) to authenticated;
grant execute on function public.cancel_distribution_record(uuid) to authenticated;
grant execute on function public.retry_distribution_record(uuid, boolean, timestamptz) to authenticated;
grant execute on function public.reconcile_distribution_record(uuid, text, text, boolean) to authenticated;
grant execute on function public.upsert_distribution_draft(uuid, text, text, text, integer, integer, uuid, text, text, date, jsonb, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Lock down direct table privileges. Strip Supabase's broad defaults; leave
--    authenticated only SELECT (RLS-gated) + UPDATE on the 4 editor columns.
revoke insert, update, delete, truncate, trigger, references on public.client_distribution_records from authenticated;
grant update (publish_payload, publish_settings, destination, planned_publish_date, updated_at)
  on public.client_distribution_records to authenticated;

-- Same lockdown for the attempt log: authenticated keeps SELECT only (staff-select
-- policy); the Supabase-default write privileges are stripped. service_role (used
-- by the worker) keeps its write access; anon/public have none.
revoke insert, update, delete, truncate, trigger, references
  on public.client_publish_attempts from authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Harden claim_due_distribution_records: clamp limit, reject empty worker,
--    exclude evidence-bearing + permanent-failure rows. Story gate + SKIP LOCKED kept.
create or replace function public.claim_due_distribution_records(p_worker_id text, p_limit integer)
returns setof public.client_distribution_records language plpgsql security definer set search_path = '' as $$
declare v_limit integer := least(greatest(coalesce(p_limit, 1), 1), 10);
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then raise exception 'REFUSED: worker id required'; end if;
  return query
  update public.client_distribution_records d
  set publish_status='publishing', claimed_at=now(), claimed_by=p_worker_id, attempt_count=d.attempt_count+1, last_error=null, updated_at=now()
  where d.id in (
    select c.id from public.client_distribution_records c
    where c.publish_status='scheduled'
      and c.scheduled_publish_at is not null and c.scheduled_publish_at <= now()
      and (c.next_attempt_at is null or c.next_attempt_at <= now())
      and c.external_post_id is null and c.published_at is null and c.published_url is null
      and c.permanent_failure = false
      and not exists (
        select 1 from public.client_distribution_records e
        where e.client_id=c.client_id and e.asset_group_ref=c.asset_group_ref
          and e.sequence_index < c.sequence_index and e.publish_status <> 'published'
      )
    order by c.scheduled_publish_at
    limit v_limit
    for update skip locked
  )
  returning d.*;
end; $$;
revoke all on function public.claim_due_distribution_records(text, integer) from public, anon, authenticated;
grant execute on function public.claim_due_distribution_records(text, integer) to service_role;
