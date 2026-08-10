-- Programme Stage 1B-E: Facebook Analytics and Platform Experiments.
--
-- Extends the existing, already-live Gate B-G organic performance/iteration
-- loop to Facebook rather than duplicating it (matching Stage M's own
-- precedent for Ad Campaigns): Facebook already shares
-- client_distribution_records / client_metric_snapshots / client_
-- performance_scores / client_performance_insights / client_iteration_
-- candidates with Instagram via the existing `platform` column, so no new
-- performance-review table is needed for Facebook the way ad_campaigns
-- needed one (ads have no client_distribution_records row at all).
--
-- Three real, narrow gaps closed:
--   1. upsert_manual_metric_snapshot()'s allowed-metric whitelist was
--      hardcoded to Instagram's vocabulary regardless of platform. Widened
--      in place (same function, same signature, zero behaviour change for
--      Instagram rows) to branch on d.platform as well as story-vs-feed.
--   2. persist_instagram_insights_collection() hard-refused any row whose
--      platform was not 'instagram'. The real logic is extracted into a new
--      persist_platform_insights_collection(), and persist_instagram_
--      insights_collection() becomes a thin `language sql` delegate to it
--      with 'instagram' fixed -- byte-identical behaviour for the one
--      existing caller, verified live (same discipline as Stage 1B-D's
--      distribution_publication_supported delegation). A new sibling
--      persist_facebook_insights_collection() delegates the same way with
--      'facebook'.
--   3. No entity existed for a controlled Facebook-vs-Instagram experiment.
--      client_platform_experiments is new; its two arms are simply the real
--      client_distribution_records rows carrying its id in the new nullable
--      platform_experiment_id column, grouped by platform -- not a separate
--      assignment table, since "this publish is part of experiment X" is a
--      property of the publish itself, not a many-to-many relationship.

-- ── 1) Platform experiments ────────────────────────────────────────────────

create table if not exists public.client_platform_experiments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  hypothesis text not null,
  -- Avatar/segment are Client Context OS concepts (e.g. "02_Avatar_And_Buyer_
  -- Psychology.md"), not structured relational entities anywhere in this
  -- schema -- captured as operator-supplied labels, not fabricated FKs into
  -- tables that don't exist.
  avatar_label text,
  segment_label text,
  content_format text,
  -- Reuses calendar_slots.funnel_stage's existing, already-approved
  -- vocabulary rather than inventing a second "commercial objective" enum.
  commercial_objective text check (commercial_objective is null or commercial_objective in ('awareness','consideration','decision','retention')),
  platform_a text not null check (platform_a in ('instagram','facebook')),
  platform_b text not null check (platform_b in ('instagram','facebook')),
  status text not null default 'draft' check (status in ('draft','running','completed','abandoned')),
  outcome_summary text,
  outcome_confidence text check (outcome_confidence is null or outcome_confidence in ('low','medium','high')),
  iteration_candidate_id uuid references public.client_iteration_candidates(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_platform_experiments_distinct_platforms check (platform_a <> platform_b),
  constraint client_platform_experiments_completion check (
    (status = 'completed') = (completed_at is not null)
  )
);

create index if not exists client_platform_experiments_client_idx on public.client_platform_experiments(client_id);

alter table public.client_platform_experiments enable row level security;

-- Mirrors the exact visibility model already live on client_iteration_
-- candidates / client_metric_snapshots / client_performance_scores: staff-
-- role gated, not per-client team_members scoped. This is a deliberate,
-- pre-existing pattern for the whole Gate B-G subsystem, not a new decision
-- made here -- kept consistent rather than second-guessed.
create policy client_platform_experiments_staff_select on public.client_platform_experiments
  for select using (auth_role() = any (array['admin','account_manager','editor']));

-- ── 2) Experiment assignment on the real publish record ────────────────────

alter table public.client_distribution_records
  add column if not exists platform_experiment_id uuid references public.client_platform_experiments(id) on delete set null;

create index if not exists client_distribution_records_platform_experiment_idx
  on public.client_distribution_records(platform_experiment_id) where platform_experiment_id is not null;

-- ── 3) RPCs: experiment lifecycle (SECURITY DEFINER, same convention as every other Gate B-G write) ──

create or replace function public.create_platform_experiment(
  p_client_id uuid, p_title text, p_hypothesis text,
  p_platform_a text, p_platform_b text,
  p_avatar_label text default null, p_segment_label text default null,
  p_content_format text default null, p_commercial_objective text default null
) returns public.client_platform_experiments
language plpgsql security definer set search_path = ''
as $$
declare v_row public.client_platform_experiments;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  if not exists (select 1 from public.clients where id = p_client_id) then raise exception 'NOT_FOUND: client %', p_client_id; end if;
  if nullif(trim(p_title), '') is null then raise exception 'VALIDATION: title is required'; end if;
  if nullif(trim(p_hypothesis), '') is null then raise exception 'VALIDATION: hypothesis is required'; end if;
  if p_platform_a not in ('instagram','facebook') or p_platform_b not in ('instagram','facebook') then raise exception 'VALIDATION: platforms must be instagram or facebook'; end if;
  if p_platform_a = p_platform_b then raise exception 'VALIDATION: platform_a and platform_b must differ'; end if;

  insert into public.client_platform_experiments (
    client_id, title, hypothesis, avatar_label, segment_label, content_format,
    commercial_objective, platform_a, platform_b, status, created_by
  ) values (
    p_client_id, trim(p_title), trim(p_hypothesis), nullif(trim(p_avatar_label),''), nullif(trim(p_segment_label),''),
    nullif(trim(p_content_format),''), p_commercial_objective, p_platform_a, p_platform_b, 'draft', auth.uid()
  ) returning * into v_row;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (p_client_id, 'platform_experiment_created', 'Platform experiment "'||v_row.title||'" created ('||p_platform_a||' vs '||p_platform_b||').',
    'client_platform_experiment', v_row.id, jsonb_build_object('platform_a', p_platform_a, 'platform_b', p_platform_b));

  return v_row;
end;
$$;

create or replace function public.assign_distribution_record_to_experiment(
  p_experiment_id uuid, p_distribution_record_id uuid
) returns public.client_distribution_records
language plpgsql security definer set search_path = ''
as $$
declare v_exp public.client_platform_experiments; v_rec public.client_distribution_records;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  select * into v_exp from public.client_platform_experiments where id = p_experiment_id;
  if not found then raise exception 'NOT_FOUND: experiment %', p_experiment_id; end if;
  if v_exp.status = 'completed' or v_exp.status = 'abandoned' then raise exception 'REFUSED: cannot assign content to a % experiment', v_exp.status; end if;
  select * into v_rec from public.client_distribution_records where id = p_distribution_record_id for update;
  if not found then raise exception 'NOT_FOUND: distribution record %', p_distribution_record_id; end if;
  if v_rec.client_id <> v_exp.client_id then raise exception 'REFUSED: distribution record belongs to a different client than the experiment'; end if;
  if coalesce(v_rec.platform,'instagram') not in (v_exp.platform_a, v_exp.platform_b) then
    raise exception 'REFUSED: record platform % is not one of this experiment''s two arms (% / %)', v_rec.platform, v_exp.platform_a, v_exp.platform_b;
  end if;

  update public.client_distribution_records set platform_experiment_id = p_experiment_id, updated_at = now()
  where id = p_distribution_record_id returning * into v_rec;

  if v_exp.status = 'draft' then
    update public.client_platform_experiments set status = 'running', started_at = coalesce(started_at, now()), updated_at = now() where id = p_experiment_id;
  end if;

  return v_rec;
end;
$$;

create or replace function public.complete_platform_experiment(
  p_experiment_id uuid, p_outcome_summary text, p_outcome_confidence text
) returns public.client_platform_experiments
language plpgsql security definer set search_path = ''
as $$
declare v_row public.client_platform_experiments;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  if nullif(trim(p_outcome_summary), '') is null then raise exception 'VALIDATION: outcome_summary is required to complete an experiment'; end if;
  if p_outcome_confidence not in ('low','medium','high') then raise exception 'VALIDATION: outcome_confidence must be low, medium or high'; end if;
  select * into v_row from public.client_platform_experiments where id = p_experiment_id for update;
  if not found then raise exception 'NOT_FOUND: experiment %', p_experiment_id; end if;
  if v_row.status = 'completed' then raise exception 'REFUSED: experiment is already completed'; end if;

  update public.client_platform_experiments
  set status = 'completed', outcome_summary = trim(p_outcome_summary), outcome_confidence = p_outcome_confidence,
      completed_at = now(), updated_at = now()
  where id = p_experiment_id returning * into v_row;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_row.client_id, 'platform_experiment_completed', 'Platform experiment "'||v_row.title||'" completed.',
    'client_platform_experiment', v_row.id, jsonb_build_object('outcome_confidence', p_outcome_confidence));

  return v_row;
end;
$$;

-- Links a completed experiment to a real, human-reviewed iteration candidate
-- -- never writes an iteration candidate itself (that stays Gate E's own
-- create_iteration_candidate, called first by the operator); this only
-- records the back-link, exactly mirroring how Stage M's created_ad_
-- opportunity_id / created_content_opportunity_id link an already-created
-- row rather than creating one implicitly. This is what makes "platform
-- recommendations are proposals, not silent strategy mutations" true here:
-- an experiment can never itself create or approve an iteration candidate.
create or replace function public.link_platform_experiment_to_iteration_candidate(
  p_experiment_id uuid, p_iteration_candidate_id uuid
) returns public.client_platform_experiments
language plpgsql security definer set search_path = ''
as $$
declare v_row public.client_platform_experiments; v_cand public.client_iteration_candidates;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then raise exception 'AUTH: staff role required'; end if;
  select * into v_row from public.client_platform_experiments where id = p_experiment_id for update;
  if not found then raise exception 'NOT_FOUND: experiment %', p_experiment_id; end if;
  select * into v_cand from public.client_iteration_candidates where id = p_iteration_candidate_id;
  if not found then raise exception 'NOT_FOUND: iteration candidate %', p_iteration_candidate_id; end if;
  if v_cand.client_id <> v_row.client_id then raise exception 'REFUSED: iteration candidate belongs to a different client'; end if;

  update public.client_platform_experiments set iteration_candidate_id = p_iteration_candidate_id, updated_at = now()
  where id = p_experiment_id returning * into v_row;
  return v_row;
end;
$$;

-- ── 4) Gate B fix: platform-aware manual metric whitelist (same function, same signature) ──

create or replace function public.upsert_manual_metric_snapshot(
  p_distribution_record_id uuid, p_snapshot_id uuid default null, p_snapshot_at timestamptz default now(),
  p_snapshot_label text default 'manual', p_metrics jsonb default '{}'::jsonb, p_notes text default null, p_evidence_url text default null
) returns setof public.client_metric_snapshots
language plpgsql security definer set search_path = ''
as $$
declare d public.client_distribution_records; v_id uuid; v_allowed text[]; pair record; v_platform text;
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

  v_platform := lower(coalesce(d.platform, 'instagram'));
  -- Facebook has no Story surface today (Stage 1B-A/1B-D: CAROUSEL/STORIES
  -- remain blocked, never confirmed against Meta docs), so its vocabulary is
  -- always the feed set; Instagram keeps its existing Story/feed branch
  -- completely unchanged.
  if v_platform = 'facebook' then
    v_allowed := array['impressions','clicks','likes','comments','shares','video_views'];
  elsif upper(coalesce(d.publish_settings->>'content_type','')) = 'STORIES' or lower(d.asset_format) like '%story%' then
    v_allowed := array['impressions','reach','replies','shares','profile_visits','follows','taps_forward','taps_back','exits','completion_rate'];
  else
    v_allowed := array['impressions','reach','likes','comments','shares','saves','profile_visits','follows','website_clicks'];
  end if;

  for pair in select key, value from jsonb_each(coalesce(p_metrics, '{}'::jsonb)) loop
    if not (pair.key = any(v_allowed)) then raise exception 'VALIDATION: unsupported metric % for % (%)', pair.key, d.asset_format, v_platform; end if;
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
end;
$$;

-- ── 5) Gate C fix: generalize automatic insights persistence, preserve Instagram byte-identically ──

create or replace function public.persist_platform_insights_collection(
  p_run_id uuid, p_distribution_record_id uuid, p_snapshot_label text,
  p_metrics_requested text[], p_metrics_collected jsonb, p_unsupported_metrics text[] default '{}'::text[],
  p_platform text default 'instagram'
) returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare d public.client_distribution_records; v_snapshot_id uuid;
begin
  if p_platform not in ('instagram','facebook') then raise exception 'VALIDATION: unsupported platform %', p_platform; end if;
  select * into d from public.client_distribution_records where id=p_distribution_record_id for share;
  if not found then raise exception 'NOT_FOUND: distribution record %',p_distribution_record_id; end if;
  if d.publish_status <> 'published' or d.external_post_id is null or d.published_at is null or lower(coalesce(d.platform,'')) <> p_platform then
    raise exception 'REFUSED: automatic insights require published % evidence', p_platform;
  end if;
  if p_snapshot_label not in ('t_plus_1h','t_plus_6h','t_plus_24h','t_plus_48h','t_plus_7d','story_t_plus_1h','story_t_plus_6h','story_t_plus_23h') then raise exception 'VALIDATION: invalid automatic snapshot label'; end if;
  if jsonb_typeof(coalesce(p_metrics_collected,'{}'::jsonb)) <> 'object' then raise exception 'VALIDATION: metrics must be an object'; end if;
  if not exists (select 1 from public.client_insights_collection_runs where id=p_run_id and status='running' and mode='live') then raise exception 'REFUSED: active live collection run required'; end if;
  insert into public.client_metric_snapshots (client_id,distribution_record_id,source_ref,platform,content_format,snapshot_at,snapshot_label,collection_method,metrics)
  values (d.client_id,d.id,d.source_ref,p_platform,d.asset_format,now(),p_snapshot_label,'api',coalesce(p_metrics_collected,'{}'::jsonb)) returning id into v_snapshot_id;
  insert into public.client_insights_collection_attempts (run_id,distribution_record_id,client_id,source_ref,external_post_id,snapshot_label,status,metrics_requested,metrics_collected,unsupported_metrics)
  values (p_run_id,d.id,d.client_id,d.source_ref,d.external_post_id,p_snapshot_label,'collected',coalesce(p_metrics_requested,'{}'),coalesce(p_metrics_collected,'{}'::jsonb),coalesce(p_unsupported_metrics,'{}'));
  insert into public.activity_log (client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values (d.client_id,p_platform||'_insights_collected',initcap(p_platform)||' insights collected for '||d.source_ref||'.','client_metric_snapshot',v_snapshot_id,
    jsonb_build_object('distribution_record_id',d.id,'source_ref',d.source_ref,'snapshot_label',p_snapshot_label,'collection_method','api'));
  return v_snapshot_id;
end; $function$;

-- Thin delegate, byte-identical to the pre-1B-E function body -- preserves
-- the exact signature every existing Gate C caller (collect-instagram-
-- insights) already uses, verified live via direct SQL comparison.
create or replace function public.persist_instagram_insights_collection(
  p_run_id uuid, p_distribution_record_id uuid, p_snapshot_label text,
  p_metrics_requested text[], p_metrics_collected jsonb, p_unsupported_metrics text[] default '{}'::text[]
) returns uuid
language sql security definer set search_path = ''
as $$
  select public.persist_platform_insights_collection(p_run_id, p_distribution_record_id, p_snapshot_label, p_metrics_requested, p_metrics_collected, p_unsupported_metrics, 'instagram');
$$;

create or replace function public.persist_facebook_insights_collection(
  p_run_id uuid, p_distribution_record_id uuid, p_snapshot_label text,
  p_metrics_requested text[], p_metrics_collected jsonb, p_unsupported_metrics text[] default '{}'::text[]
) returns uuid
language sql security definer set search_path = ''
as $$
  select public.persist_platform_insights_collection(p_run_id, p_distribution_record_id, p_snapshot_label, p_metrics_requested, p_metrics_collected, p_unsupported_metrics, 'facebook');
$$;

grant execute on function public.create_platform_experiment(uuid, text, text, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.assign_distribution_record_to_experiment(uuid, uuid) to authenticated, service_role;
grant execute on function public.complete_platform_experiment(uuid, text, text) to authenticated, service_role;
grant execute on function public.link_platform_experiment_to_iteration_candidate(uuid, uuid) to authenticated, service_role;
