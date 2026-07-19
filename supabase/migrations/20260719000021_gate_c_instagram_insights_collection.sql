-- Gate C: additive Instagram Insights collection audit foundation.
-- Implementation only: this migration is not applied by this branch.

alter table public.client_metric_snapshots drop constraint if exists client_metric_snapshots_snapshot_label_check;
alter table public.client_metric_snapshots add constraint client_metric_snapshots_snapshot_label_check
  check (snapshot_label in ('manual','t_plus_1h','t_plus_6h','t_plus_24h','t_plus_48h','t_plus_7d','story_t_plus_1h','story_t_plus_6h','story_t_plus_23h'));
alter table public.client_metric_snapshots drop constraint if exists client_metric_snapshots_collection_method_check;
alter table public.client_metric_snapshots add constraint client_metric_snapshots_collection_method_check
  check (collection_method in ('manual','api_later','api'));

create unique index if not exists client_metric_snapshots_api_label_unique
  on public.client_metric_snapshots (distribution_record_id, snapshot_label)
  where collection_method = 'api';

create table if not exists public.client_insights_collection_runs (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','completed','completed_with_errors','failed')),
  mode text not null check (mode in ('dry_run','live')),
  due_count integer not null default 0 check (due_count >= 0),
  collected_count integer not null default 0 check (collected_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.client_insights_collection_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.client_insights_collection_runs(id) on delete cascade,
  distribution_record_id uuid not null references public.client_distribution_records(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  source_ref text not null,
  external_post_id text not null,
  snapshot_label text not null,
  status text not null check (status in ('collected','skipped','failed')),
  reason text,
  metrics_requested text[] not null default '{}',
  metrics_collected jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics_collected) = 'object'),
  unsupported_metrics text[] not null default '{}',
  error_category text check (error_category is null or error_category in ('meta_authentication','meta_permission','meta_rate_limit','meta_unsupported_metric','meta_media_unavailable','meta_network','validation','unknown')),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists client_insights_runs_started_idx on public.client_insights_collection_runs (started_at desc);
create index if not exists client_insights_runs_status_idx on public.client_insights_collection_runs (status, started_at desc);
create index if not exists client_insights_attempts_run_idx on public.client_insights_collection_attempts (run_id, created_at desc);
create index if not exists client_insights_attempts_client_idx on public.client_insights_collection_attempts (client_id, created_at desc);
create index if not exists client_insights_attempts_distribution_idx on public.client_insights_collection_attempts (distribution_record_id, created_at desc);
create index if not exists client_insights_attempts_source_idx on public.client_insights_collection_attempts (client_id, source_ref, created_at desc);

alter table public.client_insights_collection_runs enable row level security;
alter table public.client_insights_collection_attempts enable row level security;
revoke all on public.client_insights_collection_runs from public, anon, authenticated;
revoke all on public.client_insights_collection_attempts from public, anon, authenticated;
grant select on public.client_insights_collection_runs to authenticated;
grant select on public.client_insights_collection_attempts to authenticated;
grant select,insert,update,delete on public.client_insights_collection_runs to service_role;
grant select,insert,update,delete on public.client_insights_collection_attempts to service_role;

create policy client_insights_runs_staff_select on public.client_insights_collection_runs
  for select to authenticated using (public.auth_role() in ('admin','account_manager','editor'));
create policy client_insights_attempts_staff_select on public.client_insights_collection_attempts
  for select to authenticated using (public.auth_role() in ('admin','account_manager','editor'));

create or replace function public.persist_instagram_insights_collection(
  p_run_id uuid,
  p_distribution_record_id uuid,
  p_snapshot_label text,
  p_metrics_requested text[],
  p_metrics_collected jsonb,
  p_unsupported_metrics text[] default '{}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d public.client_distribution_records; v_snapshot_id uuid;
begin
  select * into d from public.client_distribution_records where id=p_distribution_record_id for share;
  if not found then raise exception 'NOT_FOUND: distribution record %',p_distribution_record_id; end if;
  if d.publish_status <> 'published' or d.external_post_id is null or d.published_at is null or lower(coalesce(d.platform,'')) <> 'instagram' then
    raise exception 'REFUSED: automatic insights require published Instagram evidence';
  end if;
  if p_snapshot_label not in ('t_plus_1h','t_plus_6h','t_plus_24h','t_plus_48h','t_plus_7d','story_t_plus_1h','story_t_plus_6h','story_t_plus_23h') then raise exception 'VALIDATION: invalid automatic snapshot label'; end if;
  if jsonb_typeof(coalesce(p_metrics_collected,'{}'::jsonb)) <> 'object' then raise exception 'VALIDATION: metrics must be an object'; end if;
  if not exists (select 1 from public.client_insights_collection_runs where id=p_run_id and status='running' and mode='live') then raise exception 'REFUSED: active live collection run required'; end if;
  insert into public.client_metric_snapshots (client_id,distribution_record_id,source_ref,platform,content_format,snapshot_at,snapshot_label,collection_method,metrics)
  values (d.client_id,d.id,d.source_ref,'instagram',d.asset_format,now(),p_snapshot_label,'api',coalesce(p_metrics_collected,'{}'::jsonb)) returning id into v_snapshot_id;
  insert into public.client_insights_collection_attempts (run_id,distribution_record_id,client_id,source_ref,external_post_id,snapshot_label,status,metrics_requested,metrics_collected,unsupported_metrics)
  values (p_run_id,d.id,d.client_id,d.source_ref,d.external_post_id,p_snapshot_label,'collected',coalesce(p_metrics_requested,'{}'),coalesce(p_metrics_collected,'{}'::jsonb),coalesce(p_unsupported_metrics,'{}'));
  insert into public.activity_log (client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values (d.client_id,'instagram_insights_collected','Instagram insights collected for '||d.source_ref||'.','client_metric_snapshot',v_snapshot_id,
    jsonb_build_object('distribution_record_id',d.id,'source_ref',d.source_ref,'snapshot_label',p_snapshot_label,'collection_method','api'));
  return v_snapshot_id;
end; $$;

revoke all on function public.persist_instagram_insights_collection(uuid,uuid,text,text[],jsonb,text[]) from public,anon,authenticated;
grant execute on function public.persist_instagram_insights_collection(uuid,uuid,text,text[],jsonb,text[]) to service_role;

comment on table public.client_insights_collection_runs is 'Invocation-level audit for the unscheduled Instagram Insights worker.';
comment on table public.client_insights_collection_attempts is 'Per-distribution-record outcomes from Instagram Insights collection.';
