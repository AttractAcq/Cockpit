-- Gate B: additive manual analytics foundation for genuinely published content.
-- No publishing evidence or lifecycle history is rewritten by these tables/RPCs.

create table if not exists public.client_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  distribution_record_id uuid not null references public.client_distribution_records(id) on delete cascade,
  source_ref text not null,
  platform text not null default 'instagram',
  content_format text not null,
  snapshot_at timestamptz not null,
  snapshot_label text not null default 'manual'
    check (snapshot_label in ('manual','t_plus_1h','t_plus_6h','t_plus_24h','t_plus_48h','t_plus_7d')),
  collection_method text not null default 'manual'
    check (collection_method in ('manual','api_later')),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  notes text,
  evidence_url text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_business_signal_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  distribution_record_id uuid not null references public.client_distribution_records(id) on delete cascade,
  source_ref text not null,
  signal_at timestamptz not null default now(),
  profile_visits integer check (profile_visits is null or profile_visits >= 0),
  follows integer check (follows is null or follows >= 0),
  inbound_dms integer check (inbound_dms is null or inbound_dms >= 0),
  qualified_dms integer check (qualified_dms is null or qualified_dms >= 0),
  conversations integer check (conversations is null or conversations >= 0),
  qualified_conversations integer check (qualified_conversations is null or qualified_conversations >= 0),
  appointments integer check (appointments is null or appointments >= 0),
  qualified_appointments integer check (qualified_appointments is null or qualified_appointments >= 0),
  show_ups integer check (show_ups is null or show_ups >= 0),
  cash_collected numeric(14,2) check (cash_collected is null or cash_collected >= 0),
  operator_notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_metric_snapshots_client_idx on public.client_metric_snapshots (client_id, snapshot_at desc);
create index if not exists client_metric_snapshots_distribution_idx on public.client_metric_snapshots (distribution_record_id, snapshot_at desc);
create index if not exists client_metric_snapshots_source_idx on public.client_metric_snapshots (client_id, source_ref, snapshot_at desc);
create index if not exists client_metric_snapshots_created_idx on public.client_metric_snapshots (created_at desc);
create index if not exists client_business_signal_snapshots_client_idx on public.client_business_signal_snapshots (client_id, signal_at desc);
create index if not exists client_business_signal_snapshots_distribution_idx on public.client_business_signal_snapshots (distribution_record_id, signal_at desc);
create index if not exists client_business_signal_snapshots_source_idx on public.client_business_signal_snapshots (client_id, source_ref, signal_at desc);
create index if not exists client_business_signal_snapshots_created_idx on public.client_business_signal_snapshots (created_at desc);

alter table public.client_metric_snapshots enable row level security;
alter table public.client_business_signal_snapshots enable row level security;

revoke all on public.client_metric_snapshots from public, anon, authenticated;
revoke all on public.client_business_signal_snapshots from public, anon, authenticated;
grant select on public.client_metric_snapshots to authenticated;
grant select on public.client_business_signal_snapshots to authenticated;
grant select, insert, update, delete on public.client_metric_snapshots to service_role;
grant select, insert, update, delete on public.client_business_signal_snapshots to service_role;

create policy client_metric_snapshots_staff_select on public.client_metric_snapshots
  for select to authenticated using (public.auth_role() in ('admin','account_manager','editor'));
create policy client_business_signal_snapshots_staff_select on public.client_business_signal_snapshots
  for select to authenticated using (public.auth_role() in ('admin','account_manager','editor'));

comment on table public.client_metric_snapshots is 'Point-in-time manual/API-later platform metrics for published distribution records.';
comment on table public.client_business_signal_snapshots is 'Manual commercial outcomes attributed to published distribution records.';

create or replace function public.upsert_manual_metric_snapshot(
  p_distribution_record_id uuid,
  p_snapshot_id uuid default null,
  p_snapshot_at timestamptz default now(),
  p_snapshot_label text default 'manual',
  p_metrics jsonb default '{}'::jsonb,
  p_notes text default null,
  p_evidence_url text default null
) returns setof public.client_metric_snapshots
language plpgsql security definer set search_path = '' as $$
declare
  d public.client_distribution_records;
  v_id uuid;
  v_allowed text[];
  pair record;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  select * into d from public.client_distribution_records where id = p_distribution_record_id for share;
  if not found then raise exception 'NOT_FOUND: distribution record %', p_distribution_record_id; end if;
  if d.publish_status <> 'published' and d.external_post_id is null and d.published_at is null and d.published_url is null then
    raise exception 'REFUSED: analytics requires a published or evidence-bearing distribution record';
  end if;
  if p_snapshot_at is null then raise exception 'VALIDATION: snapshot_at is required'; end if;
  if p_snapshot_label not in ('manual','t_plus_1h','t_plus_6h','t_plus_24h','t_plus_48h','t_plus_7d') then raise exception 'VALIDATION: unsupported snapshot label'; end if;
  if jsonb_typeof(coalesce(p_metrics, '{}'::jsonb)) <> 'object' then raise exception 'VALIDATION: metrics must be an object'; end if;
  v_allowed := case when upper(coalesce(d.publish_settings->>'content_type','')) = 'STORIES' or lower(d.asset_format) like '%story%'
    then array['impressions','reach','replies','shares','profile_visits','follows','taps_forward','taps_back','exits','completion_rate']
    else array['impressions','reach','likes','comments','shares','saves','profile_visits','follows','website_clicks'] end;
  for pair in select key, value from jsonb_each(coalesce(p_metrics, '{}'::jsonb)) loop
    if not (pair.key = any(v_allowed)) then raise exception 'VALIDATION: unsupported metric % for %', pair.key, d.asset_format; end if;
    if jsonb_typeof(pair.value) <> 'number' or (pair.value #>> '{}')::numeric < 0 then raise exception 'VALIDATION: metric % must be non-negative', pair.key; end if;
    if pair.key = 'completion_rate' and (pair.value #>> '{}')::numeric > 100 then raise exception 'VALIDATION: completion_rate must be 0-100'; end if;
  end loop;
  if p_snapshot_id is null then
    insert into public.client_metric_snapshots (client_id, distribution_record_id, source_ref, platform, content_format, snapshot_at, snapshot_label, collection_method, metrics, notes, evidence_url, created_by)
    values (d.client_id, d.id, d.source_ref, coalesce(d.platform,'instagram'), d.asset_format, p_snapshot_at, p_snapshot_label, 'manual', coalesce(p_metrics,'{}'::jsonb), nullif(trim(p_notes),''), nullif(trim(p_evidence_url),''), auth.uid()) returning id into v_id;
  else
    update public.client_metric_snapshots set snapshot_at=p_snapshot_at, snapshot_label=p_snapshot_label, metrics=coalesce(p_metrics,'{}'::jsonb), notes=nullif(trim(p_notes),''), evidence_url=nullif(trim(p_evidence_url),''), updated_at=now()
    where id=p_snapshot_id and client_id=d.client_id and distribution_record_id=d.id and collection_method='manual' returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND: editable manual metric snapshot %', p_snapshot_id; end if;
  end if;
  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (d.client_id, 'manual_metrics_recorded', 'Manual metrics recorded for ' || d.source_ref || '.', 'client_metric_snapshot', v_id,
    jsonb_build_object('distribution_record_id',d.id,'source_ref',d.source_ref,'snapshot_label',p_snapshot_label,'operator_user_id',auth.uid()));
  return query select * from public.client_metric_snapshots where id=v_id;
end; $$;

create or replace function public.upsert_business_signal_snapshot(
  p_distribution_record_id uuid,
  p_snapshot_id uuid default null,
  p_signal_at timestamptz default now(),
  p_profile_visits integer default null,
  p_follows integer default null,
  p_inbound_dms integer default null,
  p_qualified_dms integer default null,
  p_conversations integer default null,
  p_qualified_conversations integer default null,
  p_appointments integer default null,
  p_qualified_appointments integer default null,
  p_show_ups integer default null,
  p_cash_collected numeric default null,
  p_operator_notes text default null
) returns setof public.client_business_signal_snapshots
language plpgsql security definer set search_path = '' as $$
declare d public.client_distribution_records; v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  select * into d from public.client_distribution_records where id=p_distribution_record_id for share;
  if not found then raise exception 'NOT_FOUND: distribution record %', p_distribution_record_id; end if;
  if d.publish_status <> 'published' and d.external_post_id is null and d.published_at is null and d.published_url is null then raise exception 'REFUSED: business signals require published evidence'; end if;
  if p_signal_at is null then raise exception 'VALIDATION: signal_at is required'; end if;
  if p_profile_visits < 0 or p_follows < 0 or p_inbound_dms < 0 or p_qualified_dms < 0 or p_conversations < 0 or p_qualified_conversations < 0 or p_appointments < 0 or p_qualified_appointments < 0 or p_show_ups < 0 or p_cash_collected < 0 then raise exception 'VALIDATION: business signals must be non-negative'; end if;
  if p_snapshot_id is null then
    insert into public.client_business_signal_snapshots (client_id,distribution_record_id,source_ref,signal_at,profile_visits,follows,inbound_dms,qualified_dms,conversations,qualified_conversations,appointments,qualified_appointments,show_ups,cash_collected,operator_notes,created_by)
    values (d.client_id,d.id,d.source_ref,p_signal_at,p_profile_visits,p_follows,p_inbound_dms,p_qualified_dms,p_conversations,p_qualified_conversations,p_appointments,p_qualified_appointments,p_show_ups,p_cash_collected,nullif(trim(p_operator_notes),''),auth.uid()) returning id into v_id;
  else
    update public.client_business_signal_snapshots set signal_at=p_signal_at,profile_visits=p_profile_visits,follows=p_follows,inbound_dms=p_inbound_dms,qualified_dms=p_qualified_dms,conversations=p_conversations,qualified_conversations=p_qualified_conversations,appointments=p_appointments,qualified_appointments=p_qualified_appointments,show_ups=p_show_ups,cash_collected=p_cash_collected,operator_notes=nullif(trim(p_operator_notes),''),updated_at=now()
    where id=p_snapshot_id and client_id=d.client_id and distribution_record_id=d.id returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND: business signal snapshot %', p_snapshot_id; end if;
  end if;
  insert into public.activity_log (client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values (d.client_id,'business_signals_recorded','Business signals recorded for ' || d.source_ref || '.','client_business_signal_snapshot',v_id,
    jsonb_build_object('distribution_record_id',d.id,'source_ref',d.source_ref,'operator_user_id',auth.uid()));
  return query select * from public.client_business_signal_snapshots where id=v_id;
end; $$;

revoke all on function public.upsert_manual_metric_snapshot(uuid,uuid,timestamptz,text,jsonb,text,text) from public, anon;
revoke all on function public.upsert_business_signal_snapshot(uuid,uuid,timestamptz,integer,integer,integer,integer,integer,integer,integer,integer,integer,numeric,text) from public, anon;
grant execute on function public.upsert_manual_metric_snapshot(uuid,uuid,timestamptz,text,jsonb,text,text) to authenticated;
grant execute on function public.upsert_business_signal_snapshot(uuid,uuid,timestamptz,integer,integer,integer,integer,integer,integer,integer,integer,integer,numeric,text) to authenticated;
grant execute on function public.upsert_manual_metric_snapshot(uuid,uuid,timestamptz,text,jsonb,text,text) to service_role;
grant execute on function public.upsert_business_signal_snapshot(uuid,uuid,timestamptz,integer,integer,integer,integer,integer,integer,integer,integer,integer,numeric,text) to service_role;
