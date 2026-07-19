-- Gate D follow-up: bind optional score snapshot references to the scored record.
-- This replaces only the existing RPC; no table data or publication evidence is changed.

create or replace function public.upsert_performance_score(
  p_distribution_record_id uuid,
  p_latest_metric_snapshot_id uuid,
  p_latest_business_signal_snapshot_id uuid,
  p_score_version text,
  p_attention numeric,
  p_engagement numeric,
  p_trust numeric,
  p_conversion numeric,
  p_overall numeric,
  p_sample_quality text,
  p_score_status text,
  p_score_reasons jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.client_distribution_records;
  v_id uuid;
begin
  if auth.role() <> 'service_role'
     and (auth.uid() is null or coalesce(public.auth_role(), '') not in ('admin', 'account_manager', 'editor')) then
    raise exception 'AUTH: staff role required';
  end if;

  select * into d
  from public.client_distribution_records
  where id = p_distribution_record_id
  for share;

  if not found or d.publish_status <> 'published' or d.external_post_id is null then
    raise exception 'REFUSED: published evidence required';
  end if;

  if p_latest_metric_snapshot_id is not null
     and not exists (
       select 1
       from public.client_metric_snapshots s
       where s.id = p_latest_metric_snapshot_id
         and s.client_id = d.client_id
         and s.distribution_record_id = d.id
     ) then
    raise exception 'VALIDATION: metric snapshot does not belong to this distribution record';
  end if;

  if p_latest_business_signal_snapshot_id is not null
     and not exists (
       select 1
       from public.client_business_signal_snapshots s
       where s.id = p_latest_business_signal_snapshot_id
         and s.client_id = d.client_id
         and s.distribution_record_id = d.id
     ) then
    raise exception 'VALIDATION: business signal snapshot does not belong to this distribution record';
  end if;

  if p_attention not between 0 and 100
     or p_engagement not between 0 and 100
     or p_trust not between 0 and 100
     or p_conversion not between 0 and 100
     or p_overall not between 0 and 100 then
    raise exception 'VALIDATION: scores must be 0-100';
  end if;

  insert into public.client_performance_scores (
    client_id, distribution_record_id, source_ref, content_format, platform,
    latest_metric_snapshot_id, latest_business_signal_snapshot_id, score_version,
    attention_score, engagement_score, trust_score, conversion_signal_score,
    overall_score, sample_quality, score_status, score_reasons, computed_at
  ) values (
    d.client_id, d.id, d.source_ref, d.asset_format, coalesce(d.platform, 'instagram'),
    p_latest_metric_snapshot_id, p_latest_business_signal_snapshot_id, p_score_version,
    p_attention, p_engagement, p_trust, p_conversion, p_overall,
    p_sample_quality, p_score_status, coalesce(p_score_reasons, '[]'::jsonb), now()
  )
  on conflict (distribution_record_id) do update set
    latest_metric_snapshot_id = excluded.latest_metric_snapshot_id,
    latest_business_signal_snapshot_id = excluded.latest_business_signal_snapshot_id,
    score_version = excluded.score_version,
    attention_score = excluded.attention_score,
    engagement_score = excluded.engagement_score,
    trust_score = excluded.trust_score,
    conversion_signal_score = excluded.conversion_signal_score,
    overall_score = excluded.overall_score,
    sample_quality = excluded.sample_quality,
    score_status = excluded.score_status,
    score_reasons = excluded.score_reasons,
    computed_at = now(),
    updated_at = now()
  returning id into v_id;

  return v_id;
end
$$;

revoke all on function public.upsert_performance_score(uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, numeric, text, text, jsonb) from public, anon;
grant execute on function public.upsert_performance_score(uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, numeric, text, text, jsonb) to authenticated, service_role;

comment on function public.upsert_performance_score(uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, numeric, text, text, jsonb)
  is 'Upserts a deterministic score for published evidence and validates optional snapshots belong to the same client and distribution record.';
