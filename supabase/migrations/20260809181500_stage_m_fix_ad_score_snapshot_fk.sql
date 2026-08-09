-- Programme Stage M — corrective fix, found via live testing.
--
-- client_performance_scores.latest_metric_snapshot_id and
-- latest_business_signal_snapshot_id carry FK constraints into the ORGANIC
-- client_metric_snapshots / client_business_signal_snapshots tables (Gate D,
-- 2026-07-19). upsert_ad_performance_score was passing an
-- ad_campaign_metric_snapshots / ad_campaign_business_signal_snapshots id
-- into those same two columns for a paid row, which violates both FKs (a
-- paid snapshot id is never present in the organic tables) -- a real bug,
-- not a hypothetical one: caught by the live disposable-fixture test before
-- any real data was affected.
--
-- Postgres has no native way for one column to conditionally FK into either
-- of two different tables depending on the row's anchor. Rather than drop
-- FK integrity for the organic path too, a paid score simply never
-- populates these two columns -- traceability for a paid score's inputs is
-- one query away (the campaign's latest ad_campaign_metric_snapshots /
-- ad_campaign_business_signal_snapshots row) instead of a stored pointer,
-- exactly the same way the caller (runAdCampaignPerformanceAnalysis in
-- src/lib/api.ts) already fetches them before computing the score.

create or replace function public.upsert_ad_performance_score(
  p_ad_campaign_id uuid,p_latest_metric_snapshot_id uuid,p_latest_business_signal_snapshot_id uuid,p_score_version text,
  p_efficiency numeric,p_volume numeric,p_conversion numeric,p_overall numeric,p_sample_quality text,p_score_status text,p_score_reasons jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.ad_campaigns; v_id uuid;
begin
  if auth.role()<>'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
  select * into c from public.ad_campaigns where id=p_ad_campaign_id for share;
  if not found or c.status not in ('active','paused','completed') then raise exception 'REFUSED: a launched ad campaign is required'; end if;
  if p_efficiency not between 0 and 100 or p_volume not between 0 and 100 or p_conversion not between 0 and 100 or p_overall not between 0 and 100 then raise exception 'VALIDATION: scores must be 0-100'; end if;
  -- p_latest_metric_snapshot_id / p_latest_business_signal_snapshot_id are
  -- accepted for interface symmetry with upsert_performance_score but
  -- deliberately not persisted -- see migration comment above.
  insert into public.client_performance_scores(client_id,ad_campaign_id,source_ref,content_format,platform,latest_metric_snapshot_id,latest_business_signal_snapshot_id,score_version,attention_score,engagement_score,trust_score,conversion_signal_score,overall_score,sample_quality,score_status,score_reasons,computed_at)
  values(c.client_id,c.id,c.name,'ad_campaign','meta',null,null,p_score_version,p_efficiency,p_volume,null,p_conversion,p_overall,p_sample_quality,p_score_status,coalesce(p_score_reasons,'[]'::jsonb),now())
  on conflict(ad_campaign_id) where ad_campaign_id is not null do update set score_version=excluded.score_version,attention_score=excluded.attention_score,engagement_score=excluded.engagement_score,conversion_signal_score=excluded.conversion_signal_score,overall_score=excluded.overall_score,sample_quality=excluded.sample_quality,score_status=excluded.score_status,score_reasons=excluded.score_reasons,computed_at=now(),updated_at=now() returning id into v_id;
  return v_id;
end $$;

-- Second bug, also found via the same live-fixture test run:
-- promote_iteration_candidate_to_opportunity's ad_opportunity branch inserted
-- generated_by = 'system', but ad_opportunities_generated_by_check (Stage L)
-- only allows 'manual' or 'ai'. 'ai' is the correct fit for a system-derived
-- opportunity, matching the convention Ad Briefs already use for AI-origin rows.

create or replace function public.promote_iteration_candidate_to_opportunity(
  p_candidate_id uuid,
  p_target text, -- 'content_opportunity' | 'ad_opportunity'
  p_title text,
  p_offer_ref text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.client_iteration_candidates;
  v_id uuid;
  v_title text := trim(p_title);
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then
    raise exception 'AUTH: staff role required';
  end if;
  if p_target not in ('content_opportunity','ad_opportunity') then raise exception 'VALIDATION: target must be content_opportunity or ad_opportunity'; end if;
  if length(v_title) < 1 or length(v_title) > 400 then raise exception 'VALIDATION: title must be 1-400 characters'; end if;

  select * into c from public.client_iteration_candidates where id = p_candidate_id for update;
  if not found then raise exception 'NOT_FOUND: iteration candidate'; end if;
  if c.status <> 'approved' then raise exception 'VALIDATION: only an approved iteration candidate can be promoted'; end if;
  if c.created_content_opportunity_id is not null or c.created_ad_opportunity_id is not null then
    raise exception 'VALIDATION: this candidate has already been promoted to an opportunity';
  end if;

  if p_target = 'content_opportunity' then
    insert into public.content_opportunities (client_id, title, angle, rationale, origin, status, created_by)
    values (c.client_id, v_title, c.candidate_type, c.rationale, 'performance', 'draft',
      case when auth.role() = 'service_role' then null else auth.uid() end)
    returning id into v_id;
    update public.client_iteration_candidates set created_content_opportunity_id = v_id, updated_at = now() where id = c.id;
  else
    insert into public.ad_opportunities (client_id, title, origin, core_claim, offer_ref, notes, generated_by, created_by)
    values (c.client_id, v_title, 'performance_insight', c.recommendation, nullif(trim(p_offer_ref),''), c.rationale, 'ai',
      case when auth.role() = 'service_role' then null else auth.uid() end)
    returning id into v_id;
    update public.client_iteration_candidates set created_ad_opportunity_id = v_id, updated_at = now() where id = c.id;
  end if;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (c.client_id, 'iteration_candidate_promoted_to_opportunity',
    'Iteration candidate promoted to a new ' || replace(p_target,'_',' ') || '.',
    'client_iteration_candidate', c.id,
    jsonb_build_object('target', p_target, 'opportunity_id', v_id, 'candidate_type', c.candidate_type));

  return v_id;
end; $$;
