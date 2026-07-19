-- Gate D: additive deterministic performance-intelligence foundation.
-- No metric, business-signal, analytics, content, or publication evidence is rewritten.

create table public.client_performance_analysis_runs (
  id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id) on delete cascade,
  run_mode text not null default 'manual' check (run_mode in ('manual','scheduled_later')),
  started_at timestamptz not null default now(), finished_at timestamptz,
  status text not null default 'running' check (status in ('running','completed','completed_with_errors','failed')),
  records_scored integer not null default 0 check (records_scored>=0), insights_created integer not null default 0 check (insights_created>=0),
  skipped_count integer not null default 0 check (skipped_count>=0), error_message text, created_at timestamptz not null default now()
);

create table public.client_performance_scores (
  id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id) on delete cascade,
  distribution_record_id uuid not null references public.client_distribution_records(id) on delete cascade,
  source_ref text not null, content_format text not null, platform text not null default 'instagram',
  latest_metric_snapshot_id uuid references public.client_metric_snapshots(id) on delete set null,
  latest_business_signal_snapshot_id uuid references public.client_business_signal_snapshots(id) on delete set null,
  score_version text not null, attention_score numeric(6,2) check (attention_score between 0 and 100),
  engagement_score numeric(6,2) check (engagement_score between 0 and 100), trust_score numeric(6,2) check (trust_score between 0 and 100),
  conversion_signal_score numeric(6,2) check (conversion_signal_score between 0 and 100), overall_score numeric(6,2) check (overall_score between 0 and 100),
  sample_quality text not null check (sample_quality in ('insufficient','early','usable','mature')),
  score_status text not null check (score_status in ('pending_metrics','scored','insufficient_data','stale')),
  score_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(score_reasons)='array'),
  computed_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(distribution_record_id)
);

create table public.client_performance_insights (
  id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id) on delete cascade,
  distribution_record_id uuid references public.client_distribution_records(id) on delete cascade, source_ref text,
  insight_type text not null check (insight_type in ('winner','underperformer','format_signal','hook_signal','proof_signal','cta_signal','audience_signal','conversion_signal','risk','recommendation')),
  severity text not null check (severity in ('low','medium','high')), confidence text not null check (confidence in ('low','medium','high')),
  title text not null, summary text not null, evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence)='object'),
  recommended_action text, status text not null default 'open' check (status in ('open','accepted','dismissed','converted_to_iteration')),
  created_by text not null default 'system', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create index client_performance_runs_client_idx on public.client_performance_analysis_runs(client_id,started_at desc);
create index client_performance_scores_client_idx on public.client_performance_scores(client_id,overall_score desc);
create index client_performance_scores_source_idx on public.client_performance_scores(client_id,source_ref);
create index client_performance_scores_status_idx on public.client_performance_scores(client_id,score_status,computed_at desc);
create index client_performance_insights_client_idx on public.client_performance_insights(client_id,created_at desc);
create index client_performance_insights_distribution_idx on public.client_performance_insights(distribution_record_id,created_at desc);
create index client_performance_insights_status_idx on public.client_performance_insights(client_id,status,created_at desc);
create unique index client_performance_insights_open_unique on public.client_performance_insights(distribution_record_id,insight_type,title) where status='open';

alter table public.client_performance_analysis_runs enable row level security;
alter table public.client_performance_scores enable row level security;
alter table public.client_performance_insights enable row level security;
revoke all on public.client_performance_analysis_runs,public.client_performance_scores,public.client_performance_insights from public,anon,authenticated;
grant select on public.client_performance_analysis_runs,public.client_performance_scores,public.client_performance_insights to authenticated;
grant select,insert,update,delete on public.client_performance_analysis_runs,public.client_performance_scores,public.client_performance_insights to service_role;
create policy client_performance_runs_staff_select on public.client_performance_analysis_runs for select to authenticated using (public.auth_role() in ('admin','account_manager','editor'));
create policy client_performance_scores_staff_select on public.client_performance_scores for select to authenticated using (public.auth_role() in ('admin','account_manager','editor'));
create policy client_performance_insights_staff_select on public.client_performance_insights for select to authenticated using (public.auth_role() in ('admin','account_manager','editor'));

create or replace function public.run_performance_analysis_for_client(p_client_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if auth.role()<>'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
  if not exists(select 1 from public.clients where id=p_client_id) then raise exception 'NOT_FOUND: client'; end if;
  insert into public.client_performance_analysis_runs(client_id,run_mode,status) values(p_client_id,'manual','running') returning id into v_id;
  return v_id;
end $$;

create or replace function public.upsert_performance_score(p_distribution_record_id uuid,p_latest_metric_snapshot_id uuid,p_latest_business_signal_snapshot_id uuid,p_score_version text,p_attention numeric,p_engagement numeric,p_trust numeric,p_conversion numeric,p_overall numeric,p_sample_quality text,p_score_status text,p_score_reasons jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare d public.client_distribution_records; v_id uuid;
begin
  if auth.role()<>'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
  select * into d from public.client_distribution_records where id=p_distribution_record_id for share;
  if not found or d.publish_status<>'published' or d.external_post_id is null then raise exception 'REFUSED: published evidence required'; end if;
  if p_attention not between 0 and 100 or p_engagement not between 0 and 100 or p_trust not between 0 and 100 or p_conversion not between 0 and 100 or p_overall not between 0 and 100 then raise exception 'VALIDATION: scores must be 0-100'; end if;
  insert into public.client_performance_scores(client_id,distribution_record_id,source_ref,content_format,platform,latest_metric_snapshot_id,latest_business_signal_snapshot_id,score_version,attention_score,engagement_score,trust_score,conversion_signal_score,overall_score,sample_quality,score_status,score_reasons,computed_at)
  values(d.client_id,d.id,d.source_ref,d.asset_format,coalesce(d.platform,'instagram'),p_latest_metric_snapshot_id,p_latest_business_signal_snapshot_id,p_score_version,p_attention,p_engagement,p_trust,p_conversion,p_overall,p_sample_quality,p_score_status,coalesce(p_score_reasons,'[]'::jsonb),now())
  on conflict(distribution_record_id) do update set latest_metric_snapshot_id=excluded.latest_metric_snapshot_id,latest_business_signal_snapshot_id=excluded.latest_business_signal_snapshot_id,score_version=excluded.score_version,attention_score=excluded.attention_score,engagement_score=excluded.engagement_score,trust_score=excluded.trust_score,conversion_signal_score=excluded.conversion_signal_score,overall_score=excluded.overall_score,sample_quality=excluded.sample_quality,score_status=excluded.score_status,score_reasons=excluded.score_reasons,computed_at=now(),updated_at=now() returning id into v_id;
  return v_id;
end $$;

create or replace function public.create_performance_insight(p_distribution_record_id uuid,p_insight_type text,p_severity text,p_confidence text,p_title text,p_summary text,p_evidence jsonb,p_recommended_action text) returns uuid language plpgsql security definer set search_path='' as $$
declare d public.client_distribution_records; v_id uuid;
begin
  if auth.role()<>'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
  select * into d from public.client_distribution_records where id=p_distribution_record_id and publish_status='published'; if not found then raise exception 'REFUSED: published record required'; end if;
  select id into v_id from public.client_performance_insights where distribution_record_id=d.id and insight_type=p_insight_type and title=trim(p_title) and status='open';
  if v_id is not null then return v_id; end if;
  insert into public.client_performance_insights(client_id,distribution_record_id,source_ref,insight_type,severity,confidence,title,summary,evidence,recommended_action,created_by)
  values(d.client_id,d.id,d.source_ref,p_insight_type,p_severity,p_confidence,trim(p_title),trim(p_summary),coalesce(p_evidence,'{}'::jsonb),nullif(trim(p_recommended_action),''),case when auth.role()='service_role' then 'system' else auth.uid()::text end) returning id into v_id;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata) values(d.client_id,'performance_signal_detected','Performance signal detected for '||d.source_ref||'.','client_performance_insight',v_id,jsonb_build_object('source_ref',d.source_ref,'insight_type',p_insight_type));
  return v_id;
end $$;

create or replace function public.complete_performance_analysis_run(p_run_id uuid,p_records_scored integer,p_insights_created integer,p_skipped_count integer) returns void language plpgsql security definer set search_path='' as $$
declare r public.client_performance_analysis_runs; c text;
begin
  if auth.role()<>'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
  update public.client_performance_analysis_runs set status='completed',finished_at=now(),records_scored=p_records_scored,insights_created=p_insights_created,skipped_count=p_skipped_count where id=p_run_id and status='running' returning * into r;
  if not found then raise exception 'NOT_FOUND: active analysis run'; end if;
  select name into c from public.clients where id=r.client_id;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata) values(r.client_id,'performance_analysis_completed','Performance analysis completed for '||coalesce(c,'client')||'.','client_performance_analysis_run',r.id,jsonb_build_object('records_scored',p_records_scored,'insights_created',p_insights_created));
end $$;

create or replace function public.update_performance_insight_status(p_insight_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  if p_status not in ('open','accepted','dismissed','converted_to_iteration') then raise exception 'VALIDATION: invalid status'; end if;
  update public.client_performance_insights set status=p_status,updated_at=now() where id=p_insight_id; if not found then raise exception 'NOT_FOUND: insight'; end if;
end $$;

revoke all on function public.run_performance_analysis_for_client(uuid) from public,anon;
revoke all on function public.upsert_performance_score(uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,text,text,jsonb) from public,anon;
revoke all on function public.create_performance_insight(uuid,text,text,text,text,text,jsonb,text) from public,anon;
revoke all on function public.complete_performance_analysis_run(uuid,integer,integer,integer) from public,anon;
revoke all on function public.update_performance_insight_status(uuid,text) from public,anon;
grant execute on function public.run_performance_analysis_for_client(uuid),public.upsert_performance_score(uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,text,text,jsonb),public.create_performance_insight(uuid,text,text,text,text,text,jsonb,text),public.complete_performance_analysis_run(uuid,integer,integer,integer),public.update_performance_insight_status(uuid,text) to authenticated,service_role;

comment on table public.client_performance_scores is 'Current deterministic scorecard per published distribution record.';
comment on table public.client_performance_insights is 'Structured explainable performance signals; no AI or iteration mutation.';
comment on table public.client_performance_analysis_runs is 'Audit of deterministic performance-analysis runs.';
