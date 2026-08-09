-- Programme Stage M — Analytics and Closed-Loop Iteration.
--
-- Additive only. Gates B-G (2026-07-19, already live) already built almost
-- the entire "Observed result -> Insight -> Recommendation -> Proposed patch
-- -> Human review -> Applied update" loop for organic content:
--   client_metric_snapshots / client_business_signal_snapshots  (Gate B)
--   client_insights_collection_runs / _attempts                 (Gate C)
--   client_performance_scores / client_performance_insights     (Gate D)
--   client_iteration_candidates / client_iteration_reviews      (Gate E)
--   client_context_update_proposals / _items / _reviews         (Gate F)
--   client_context_patch_drafts / _reviews / _applications      (Gate G)
-- None of that is touched, duplicated, or reimplemented here. This migration
-- does two things only: (1) gives Stage L's Ad Campaigns the same raw-metric
-- and business-signal foundation Gate B gave organic distribution records,
-- as separate tables so paid and organic metrics are never conflated, and
-- (2) extends the existing, shared insight/candidate review queue (Gate D/E)
-- to optionally anchor on an Ad Campaign instead of a distribution record,
-- so paid campaigns flow through the same reviewed pipeline rather than a
-- duplicated parallel one. It also adds the one genuinely missing piece from
-- the whole Gate B-G loop: an Opportunity adapter, so an approved iteration
-- candidate can produce a real new Content Opportunity or Ad Opportunity
-- with the originating evidence preserved, never fabricated.

-- ---------------------------------------------------------------------------
-- Paid metric/business-signal snapshots -- the Gate B pair, for Ad Campaigns.
-- ---------------------------------------------------------------------------

create table public.ad_campaign_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ad_campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  snapshot_at timestamptz not null,
  snapshot_label text not null default 'manual' check (snapshot_label in ('manual','t_plus_1h','t_plus_24h','t_plus_7d','t_plus_30d')),
  collection_method text not null default 'manual' check (collection_method in ('manual','api_later')),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  notes text,
  evidence_url text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ad_campaign_business_signal_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ad_campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  signal_at timestamptz not null default now(),
  leads integer check (leads is null or leads >= 0),
  qualified_leads integer check (qualified_leads is null or qualified_leads >= 0),
  appointments integer check (appointments is null or appointments >= 0),
  show_ups integer check (show_ups is null or show_ups >= 0),
  cash_collected numeric(14,2) check (cash_collected is null or cash_collected >= 0),
  cac numeric(14,2) check (cac is null or cac >= 0),
  roas numeric(10,4) check (roas is null or roas >= 0),
  operator_notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ad_campaign_metric_snapshots_campaign_idx on public.ad_campaign_metric_snapshots (ad_campaign_id, snapshot_at desc);
create index ad_campaign_metric_snapshots_client_idx on public.ad_campaign_metric_snapshots (client_id, snapshot_at desc);
create index ad_campaign_business_signal_snapshots_campaign_idx on public.ad_campaign_business_signal_snapshots (ad_campaign_id, signal_at desc);
create index ad_campaign_business_signal_snapshots_client_idx on public.ad_campaign_business_signal_snapshots (client_id, signal_at desc);

alter table public.ad_campaign_metric_snapshots enable row level security;
alter table public.ad_campaign_business_signal_snapshots enable row level security;
revoke all on public.ad_campaign_metric_snapshots, public.ad_campaign_business_signal_snapshots from public, anon, authenticated;
grant select on public.ad_campaign_metric_snapshots, public.ad_campaign_business_signal_snapshots to authenticated;
grant select, insert, update, delete on public.ad_campaign_metric_snapshots, public.ad_campaign_business_signal_snapshots to service_role;
create policy ad_campaign_metric_snapshots_staff_select on public.ad_campaign_metric_snapshots
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy ad_campaign_business_signal_snapshots_staff_select on public.ad_campaign_business_signal_snapshots
  for select to authenticated using (client_id = any(public.auth_client_ids()));

comment on table public.ad_campaign_metric_snapshots is 'Point-in-time paid platform metrics for Ad Campaigns. Deliberately separate from client_metric_snapshots so paid and organic metrics are never conflated.';
comment on table public.ad_campaign_business_signal_snapshots is 'Manual commercial outcomes attributed to Ad Campaigns. Deliberately separate from client_business_signal_snapshots.';

create or replace function public.upsert_ad_campaign_metric_snapshot(
  p_ad_campaign_id uuid,
  p_snapshot_id uuid default null,
  p_snapshot_at timestamptz default now(),
  p_snapshot_label text default 'manual',
  p_metrics jsonb default '{}'::jsonb,
  p_notes text default null,
  p_evidence_url text default null
) returns setof public.ad_campaign_metric_snapshots
language plpgsql security definer set search_path = '' as $$
declare
  c public.ad_campaigns;
  v_id uuid;
  v_allowed text[] := array['spend','impressions','cpm','hook_rate','ctr','cpc','landing_page_views'];
  pair record;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  select * into c from public.ad_campaigns where id = p_ad_campaign_id for share;
  if not found then raise exception 'NOT_FOUND: ad campaign %', p_ad_campaign_id; end if;
  if c.status not in ('active','paused','completed') then
    raise exception 'REFUSED: paid metrics require a launched campaign (active, paused, or completed), not "%"', c.status;
  end if;
  if p_snapshot_at is null then raise exception 'VALIDATION: snapshot_at is required'; end if;
  if p_snapshot_label not in ('manual','t_plus_1h','t_plus_24h','t_plus_7d','t_plus_30d') then raise exception 'VALIDATION: unsupported snapshot label'; end if;
  if jsonb_typeof(coalesce(p_metrics, '{}'::jsonb)) <> 'object' then raise exception 'VALIDATION: metrics must be an object'; end if;
  for pair in select key, value from jsonb_each(coalesce(p_metrics, '{}'::jsonb)) loop
    if not (pair.key = any(v_allowed)) then raise exception 'VALIDATION: unsupported metric % for ad campaigns', pair.key; end if;
    if jsonb_typeof(pair.value) <> 'number' or (pair.value #>> '{}')::numeric < 0 then raise exception 'VALIDATION: metric % must be non-negative', pair.key; end if;
  end loop;
  if p_snapshot_id is null then
    insert into public.ad_campaign_metric_snapshots (client_id, ad_campaign_id, snapshot_at, snapshot_label, collection_method, metrics, notes, evidence_url, created_by)
    values (c.client_id, c.id, p_snapshot_at, p_snapshot_label, 'manual', coalesce(p_metrics,'{}'::jsonb), nullif(trim(p_notes),''), nullif(trim(p_evidence_url),''), auth.uid()) returning id into v_id;
  else
    update public.ad_campaign_metric_snapshots set snapshot_at=p_snapshot_at, snapshot_label=p_snapshot_label, metrics=coalesce(p_metrics,'{}'::jsonb), notes=nullif(trim(p_notes),''), evidence_url=nullif(trim(p_evidence_url),''), updated_at=now()
    where id=p_snapshot_id and client_id=c.client_id and ad_campaign_id=c.id and collection_method='manual' returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND: editable ad campaign metric snapshot %', p_snapshot_id; end if;
  end if;
  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (c.client_id, 'ad_campaign_metrics_recorded', 'Paid metrics recorded for ' || c.name || '.', 'ad_campaign_metric_snapshot', v_id,
    jsonb_build_object('ad_campaign_id', c.id, 'snapshot_label', p_snapshot_label, 'operator_user_id', auth.uid()));
  return query select * from public.ad_campaign_metric_snapshots where id=v_id;
end; $$;

create or replace function public.upsert_ad_campaign_business_signal_snapshot(
  p_ad_campaign_id uuid,
  p_snapshot_id uuid default null,
  p_signal_at timestamptz default now(),
  p_leads integer default null,
  p_qualified_leads integer default null,
  p_appointments integer default null,
  p_show_ups integer default null,
  p_cash_collected numeric default null,
  p_cac numeric default null,
  p_roas numeric default null,
  p_operator_notes text default null
) returns setof public.ad_campaign_business_signal_snapshots
language plpgsql security definer set search_path = '' as $$
declare c public.ad_campaigns; v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  select * into c from public.ad_campaigns where id=p_ad_campaign_id for share;
  if not found then raise exception 'NOT_FOUND: ad campaign %', p_ad_campaign_id; end if;
  if c.status not in ('active','paused','completed') then raise exception 'REFUSED: business signals require a launched campaign, not "%"', c.status; end if;
  if p_signal_at is null then raise exception 'VALIDATION: signal_at is required'; end if;
  if p_leads < 0 or p_qualified_leads < 0 or p_appointments < 0 or p_show_ups < 0 or p_cash_collected < 0 or p_cac < 0 or p_roas < 0 then
    raise exception 'VALIDATION: business signals must be non-negative';
  end if;
  if p_snapshot_id is null then
    insert into public.ad_campaign_business_signal_snapshots (client_id,ad_campaign_id,signal_at,leads,qualified_leads,appointments,show_ups,cash_collected,cac,roas,operator_notes,created_by)
    values (c.client_id,c.id,p_signal_at,p_leads,p_qualified_leads,p_appointments,p_show_ups,p_cash_collected,p_cac,p_roas,nullif(trim(p_operator_notes),''),auth.uid()) returning id into v_id;
  else
    update public.ad_campaign_business_signal_snapshots set signal_at=p_signal_at,leads=p_leads,qualified_leads=p_qualified_leads,appointments=p_appointments,show_ups=p_show_ups,cash_collected=p_cash_collected,cac=p_cac,roas=p_roas,operator_notes=nullif(trim(p_operator_notes),''),updated_at=now()
    where id=p_snapshot_id and client_id=c.client_id and ad_campaign_id=c.id returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND: ad campaign business signal snapshot %', p_snapshot_id; end if;
  end if;
  insert into public.activity_log (client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values (c.client_id,'ad_campaign_business_signals_recorded','Business signals recorded for '||c.name||'.','ad_campaign_business_signal_snapshot',v_id,
    jsonb_build_object('ad_campaign_id',c.id,'operator_user_id',auth.uid()));
  return query select * from public.ad_campaign_business_signal_snapshots where id=v_id;
end; $$;

revoke all on function public.upsert_ad_campaign_metric_snapshot(uuid,uuid,timestamptz,text,jsonb,text,text) from public, anon;
revoke all on function public.upsert_ad_campaign_business_signal_snapshot(uuid,uuid,timestamptz,integer,integer,integer,integer,numeric,numeric,numeric,text) from public, anon;
grant execute on function public.upsert_ad_campaign_metric_snapshot(uuid,uuid,timestamptz,text,jsonb,text,text) to authenticated, service_role;
grant execute on function public.upsert_ad_campaign_business_signal_snapshot(uuid,uuid,timestamptz,integer,integer,integer,integer,numeric,numeric,numeric,text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Extend the existing, shared Gate D/E review queue to optionally anchor on
-- an Ad Campaign instead of a distribution record -- paid and organic share
-- one reviewed insight/candidate pipeline rather than two parallel ones.
-- ---------------------------------------------------------------------------

alter table public.client_performance_scores
  add column ad_campaign_id uuid references public.ad_campaigns(id) on delete cascade,
  alter column distribution_record_id drop not null;
alter table public.client_performance_scores
  add constraint client_performance_scores_one_anchor_check check (
    (distribution_record_id is not null and ad_campaign_id is null) or
    (distribution_record_id is null and ad_campaign_id is not null)
  );
alter table public.client_performance_scores drop constraint if exists client_performance_scores_distribution_record_id_key;
create unique index client_performance_scores_ad_campaign_unique on public.client_performance_scores (ad_campaign_id) where ad_campaign_id is not null;
create unique index client_performance_scores_distribution_unique on public.client_performance_scores (distribution_record_id) where distribution_record_id is not null;
create index client_performance_scores_ad_campaign_idx on public.client_performance_scores (ad_campaign_id) where ad_campaign_id is not null;

alter table public.client_performance_insights
  add column ad_campaign_id uuid references public.ad_campaigns(id) on delete cascade;
alter table public.client_performance_insights
  add constraint client_performance_insights_one_anchor_check check (
    (distribution_record_id is not null and ad_campaign_id is null) or
    (distribution_record_id is null and ad_campaign_id is not null)
  );
create index client_performance_insights_ad_campaign_idx on public.client_performance_insights (ad_campaign_id, created_at desc) where ad_campaign_id is not null;
drop index if exists public.client_performance_insights_open_unique;
create unique index client_performance_insights_open_unique on public.client_performance_insights (coalesce(distribution_record_id,ad_campaign_id),insight_type,title) where status='open';

alter table public.client_iteration_candidates
  add column ad_campaign_id uuid references public.ad_campaigns(id) on delete cascade,
  add column created_content_opportunity_id uuid references public.content_opportunities(id) on delete set null,
  add column created_ad_opportunity_id uuid references public.ad_opportunities(id) on delete set null;
alter table public.client_iteration_candidates drop constraint client_iteration_candidates_candidate_type_check;
alter table public.client_iteration_candidates add constraint client_iteration_candidates_candidate_type_check check (candidate_type in (
  'hook','proof_angle','cta','format','story_sequence','content_angle','offer','audience','distribution','asset','calendar','paid_promotion','other'
));
create index client_iteration_candidates_ad_campaign_idx on public.client_iteration_candidates (ad_campaign_id, created_at desc) where ad_campaign_id is not null;

comment on column public.client_performance_scores.ad_campaign_id is 'Paid anchor, mutually exclusive with distribution_record_id (client_performance_scores_one_anchor_check).';
comment on column public.client_performance_insights.ad_campaign_id is 'Paid anchor, mutually exclusive with distribution_record_id (client_performance_insights_one_anchor_check). Both may be null for a client-level insight.';
comment on column public.client_iteration_candidates.created_content_opportunity_id is 'Set by promote_iteration_candidate_to_opportunity when this candidate produced a new organic Content Opportunity. Preserves the originating asset link.';
comment on column public.client_iteration_candidates.created_ad_opportunity_id is 'Set by promote_iteration_candidate_to_opportunity when this candidate produced a new Ad Opportunity. Preserves the originating asset link.';

-- Paid-anchored siblings of upsert_performance_score / create_performance_insight
-- (Gate D). Kept as separate functions rather than widening the existing,
-- already-live organic signatures, so no already-tested organic call site is
-- touched by this stage.

-- Reuses client_performance_scores' existing attention/engagement/conversion
-- columns for paid semantics (efficiency/volume/conversion) rather than
-- adding paid-only columns to a live, already-tested table. trust_score is
-- left null (not zero) -- "not applicable to paid", not "scored zero trust".
-- The TS layer names these fields correctly for callers/readers.
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
  insert into public.client_performance_scores(client_id,ad_campaign_id,source_ref,content_format,platform,latest_metric_snapshot_id,latest_business_signal_snapshot_id,score_version,attention_score,engagement_score,trust_score,conversion_signal_score,overall_score,sample_quality,score_status,score_reasons,computed_at)
  values(c.client_id,c.id,c.name,'ad_campaign','meta',p_latest_metric_snapshot_id,p_latest_business_signal_snapshot_id,p_score_version,p_efficiency,p_volume,null,p_conversion,p_overall,p_sample_quality,p_score_status,coalesce(p_score_reasons,'[]'::jsonb),now())
  on conflict(ad_campaign_id) where ad_campaign_id is not null do update set latest_metric_snapshot_id=excluded.latest_metric_snapshot_id,latest_business_signal_snapshot_id=excluded.latest_business_signal_snapshot_id,score_version=excluded.score_version,attention_score=excluded.attention_score,engagement_score=excluded.engagement_score,conversion_signal_score=excluded.conversion_signal_score,overall_score=excluded.overall_score,sample_quality=excluded.sample_quality,score_status=excluded.score_status,score_reasons=excluded.score_reasons,computed_at=now(),updated_at=now() returning id into v_id;
  return v_id;
end $$;

create or replace function public.create_ad_performance_insight(
  p_ad_campaign_id uuid,p_insight_type text,p_severity text,p_confidence text,p_title text,p_summary text,p_evidence jsonb,p_recommended_action text
) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.ad_campaigns; v_id uuid;
begin
  if auth.role()<>'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
  select * into c from public.ad_campaigns where id=p_ad_campaign_id and status in ('active','paused','completed'); if not found then raise exception 'REFUSED: a launched ad campaign is required'; end if;
  select id into v_id from public.client_performance_insights where ad_campaign_id=c.id and insight_type=p_insight_type and title=trim(p_title) and status='open';
  if v_id is not null then return v_id; end if;
  insert into public.client_performance_insights(client_id,ad_campaign_id,source_ref,insight_type,severity,confidence,title,summary,evidence,recommended_action,created_by)
  values(c.client_id,c.id,c.name,p_insight_type,p_severity,p_confidence,trim(p_title),trim(p_summary),coalesce(p_evidence,'{}'::jsonb),nullif(trim(p_recommended_action),''),case when auth.role()='service_role' then 'system' else auth.uid()::text end) returning id into v_id;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata) values(c.client_id,'performance_signal_detected','Paid performance signal detected for '||c.name||'.','client_performance_insight',v_id,jsonb_build_object('ad_campaign_id',c.id,'insight_type',p_insight_type));
  return v_id;
end $$;

revoke all on function public.upsert_ad_performance_score(uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,jsonb) from public,anon;
revoke all on function public.create_ad_performance_insight(uuid,text,text,text,text,text,jsonb,text) from public,anon;
grant execute on function public.upsert_ad_performance_score(uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,jsonb),public.create_ad_performance_insight(uuid,text,text,text,text,text,jsonb,text) to authenticated,service_role;

-- create_iteration_candidate (Gate E) gains an optional paid anchor. The
-- default keeps every existing organic call site working unchanged.

create or replace function public.create_iteration_candidate(
  p_client_id uuid,p_source_ref text,p_distribution_record_id uuid,p_performance_score_id uuid,p_performance_insight_id uuid,
  p_candidate_type text,p_recommendation text,p_rationale text,p_evidence jsonb,p_confidence text,p_priority text,p_created_from text,
  p_ad_campaign_id uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; d public.client_distribution_records; a public.ad_campaigns; s public.client_performance_scores; i public.client_performance_insights; v_source text:=nullif(trim(p_source_ref),''); v_distribution uuid:=p_distribution_record_id; v_ad_campaign uuid:=p_ad_campaign_id;
begin
  if auth.role()<>'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
  if not exists(select 1 from public.clients where id=p_client_id) then raise exception 'NOT_FOUND: client'; end if;
  if v_distribution is not null and v_ad_campaign is not null then raise exception 'VALIDATION: a candidate cannot anchor on both a distribution record and an ad campaign'; end if;
  if p_created_from='performance_score' and p_performance_score_id is null then raise exception 'VALIDATION: performance score required'; end if;
  if p_created_from='performance_insight' and p_performance_insight_id is null then raise exception 'VALIDATION: performance insight required'; end if;
  if v_distribution is not null then select * into d from public.client_distribution_records where id=v_distribution and client_id=p_client_id; if not found then raise exception 'VALIDATION: distribution record does not belong to client'; end if; v_source:=coalesce(v_source,d.source_ref); end if;
  if v_ad_campaign is not null then select * into a from public.ad_campaigns where id=v_ad_campaign and client_id=p_client_id; if not found then raise exception 'VALIDATION: ad campaign does not belong to client'; end if; v_source:=coalesce(v_source,a.name); end if;
  if p_performance_score_id is not null then
    select * into s from public.client_performance_scores where id=p_performance_score_id and client_id=p_client_id; if not found then raise exception 'VALIDATION: performance score does not belong to client'; end if;
    if v_distribution is not null and s.distribution_record_id<>v_distribution then raise exception 'VALIDATION: performance score does not belong to distribution record'; end if;
    if v_ad_campaign is not null and s.ad_campaign_id<>v_ad_campaign then raise exception 'VALIDATION: performance score does not belong to ad campaign'; end if;
    v_distribution:=coalesce(v_distribution,s.distribution_record_id); v_ad_campaign:=coalesce(v_ad_campaign,s.ad_campaign_id); v_source:=coalesce(v_source,s.source_ref);
  end if;
  if p_performance_insight_id is not null then
    select * into i from public.client_performance_insights where id=p_performance_insight_id and client_id=p_client_id; if not found then raise exception 'VALIDATION: performance insight does not belong to client'; end if;
    if v_distribution is not null and i.distribution_record_id is distinct from v_distribution then raise exception 'VALIDATION: performance insight does not belong to distribution record'; end if;
    if v_ad_campaign is not null and i.ad_campaign_id is distinct from v_ad_campaign then raise exception 'VALIDATION: performance insight does not belong to ad campaign'; end if;
    v_distribution:=coalesce(v_distribution,i.distribution_record_id); v_ad_campaign:=coalesce(v_ad_campaign,i.ad_campaign_id); v_source:=coalesce(v_source,i.source_ref);
  end if;
  insert into public.client_iteration_candidates(client_id,source_ref,distribution_record_id,ad_campaign_id,performance_score_id,performance_insight_id,candidate_type,recommendation,rationale,evidence,confidence,priority,created_by,created_from)
  values(p_client_id,v_source,v_distribution,v_ad_campaign,p_performance_score_id,p_performance_insight_id,p_candidate_type,trim(p_recommendation),trim(p_rationale),coalesce(p_evidence,'{}'::jsonb),p_confidence,p_priority,case when auth.role()='service_role' then 'system' else 'operator' end,p_created_from)
  returning id into v_id;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata) values(p_client_id,'iteration_candidate_created','Iteration candidate created'||case when v_source is null then '.' else ' for '||v_source||'.' end,'client_iteration_candidate',v_id,jsonb_build_object('source_ref',v_source,'candidate_type',p_candidate_type));
  return v_id;
end $$;

revoke all on function public.create_iteration_candidate(uuid,text,uuid,uuid,uuid,text,text,text,jsonb,text,text,text,uuid) from public,anon;
grant execute on function public.create_iteration_candidate(uuid,text,uuid,uuid,uuid,text,text,text,jsonb,text,text,text,uuid) to authenticated,service_role;

-- ---------------------------------------------------------------------------
-- The Opportunity adapter -- the one genuinely missing piece of the whole
-- Gate B-G loop. Turns an APPROVED iteration candidate into a new, real
-- Content Opportunity (origin='performance', already a valid enum value
-- since Stage B) or a new Ad Opportunity (origin='performance_insight',
-- already a valid Stage L enum value) -- never both, never silently, and
-- always recording the link back onto the candidate that produced it.
-- ---------------------------------------------------------------------------

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
    -- Always 'performance_insight' here, not 'organic_winner': promoting an
    -- already-identified organic winner to paid with an explicit source link
    -- is the separate, existing operator-directed path in create-ad-opportunity
    -- (Stage L). This adapter's own output is never itself the thing being
    -- promoted as an organic winner in the same call.
    insert into public.ad_opportunities (client_id, title, origin, core_claim, offer_ref, notes, generated_by, created_by)
    values (c.client_id, v_title, 'performance_insight', c.recommendation, nullif(trim(p_offer_ref),''), c.rationale, 'system',
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

revoke all on function public.promote_iteration_candidate_to_opportunity(uuid,text,text,text) from public, anon;
grant execute on function public.promote_iteration_candidate_to_opportunity(uuid,text,text,text) to authenticated, service_role;

comment on function public.promote_iteration_candidate_to_opportunity(uuid,text,text,text) is 'The Opportunity adapter: an approved iteration candidate produces exactly one new Content or Ad Opportunity, with the link preserved back onto the candidate. Never runs twice for the same candidate.';
