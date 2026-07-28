-- Reel Studio Phase 1: exact production-brief binding and atomic pending-shot
-- planning mutations. Historical migrations remain unchanged.

create or replace function public.create_bound_reel_video_project(
  p_client_id uuid,
  p_source_table text,
  p_source_row_id uuid,
  p_client_production_brief_id uuid,
  p_title text,
  p_archetype text,
  p_awareness_stage text,
  p_target_duration_sec integer,
  p_brand_prompt_block_id uuid,
  p_created_by uuid
)
returns public.video_projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brief public.client_production_briefs;
  v_brand public.brand_prompt_blocks;
  v_project public.video_projects;
  v_source_client_id uuid;
begin
  select *
    into v_brief
    from public.client_production_briefs
   where id = p_client_production_brief_id
   for share;

  if not found then
    raise exception 'REEL_BRIEF_NOT_FOUND: Production brief does not exist.';
  end if;
  if v_brief.client_id is distinct from p_client_id then
    raise exception 'REEL_BRIEF_CLIENT_MISMATCH: Production brief does not belong to client_id.';
  end if;
  if v_brief.status is distinct from 'approved'::public.review_state then
    raise exception 'REEL_BRIEF_NOT_APPROVED: Production brief must be approved.';
  end if;
  if v_brief.asset_format is distinct from 'reel_video' then
    raise exception 'REEL_BRIEF_FORMAT_MISMATCH: Production brief must have asset_format reel_video.';
  end if;
  if v_brief.source_table is distinct from p_source_table then
    raise exception 'REEL_BRIEF_SOURCE_TABLE_MISMATCH: Production brief source_table does not match.';
  end if;
  if v_brief.source_row_id is distinct from p_source_row_id then
    raise exception 'REEL_BRIEF_SOURCE_ROW_MISMATCH: Production brief source_row_id does not match.';
  end if;

  if p_source_table = 'organic_master' then
    select client_id into v_source_client_id from public.organic_master where id = p_source_row_id;
  elsif p_source_table = 'ads_master' then
    select client_id into v_source_client_id from public.ads_master where id = p_source_row_id;
  else
    raise exception 'REEL_SOURCE_TABLE_INVALID: source_table must be organic_master or ads_master.';
  end if;

  if v_source_client_id is null then
    raise exception 'REEL_SOURCE_NOT_FOUND: Source row does not exist.';
  end if;
  if v_source_client_id is distinct from p_client_id then
    raise exception 'REEL_SOURCE_CLIENT_MISMATCH: Source row does not belong to client_id.';
  end if;

  select *
    into v_brand
    from public.brand_prompt_blocks
   where id = p_brand_prompt_block_id;
  if not found then
    raise exception 'REEL_BRAND_NOT_FOUND: Brand prompt block does not exist.';
  end if;

  insert into public.video_projects (
    client_id,
    organic_master_id,
    ads_master_id,
    client_production_brief_id,
    archetype,
    awareness_stage,
    target_duration_sec,
    brand_prompt_block_id,
    brand_prompt_block_version,
    title,
    created_by
  )
  values (
    p_client_id,
    case when p_source_table = 'organic_master' then p_source_row_id else null end,
    case when p_source_table = 'ads_master' then p_source_row_id else null end,
    p_client_production_brief_id,
    p_archetype,
    p_awareness_stage,
    p_target_duration_sec,
    p_brand_prompt_block_id,
    v_brand.version,
    btrim(p_title),
    p_created_by
  )
  returning * into v_project;

  insert into public.activity_log (
    client_id,
    event_type,
    plain_english_message,
    object_type,
    object_id,
    metadata
  )
  values (
    p_client_id,
    'reel_studio_bound_project_created',
    'Reel Studio project created from approved production brief.',
    'video_project',
    v_project.id,
    jsonb_build_object(
      'video_project_id', v_project.id,
      'production_brief_id', p_client_production_brief_id,
      'source_table', p_source_table,
      'source_row_id', p_source_row_id
    )
  );

  return v_project;
end;
$$;

create or replace function public.bind_legacy_reel_project_brief(
  p_video_project_id uuid,
  p_client_production_brief_id uuid
)
returns public.video_projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.video_projects;
  v_brief public.client_production_briefs;
  v_source_table text;
  v_source_row_id uuid;
begin
  select *
    into v_project
    from public.video_projects
   where id = p_video_project_id
   for update;
  if not found then
    raise exception 'REEL_PROJECT_NOT_FOUND: Video project does not exist.';
  end if;

  if v_project.client_production_brief_id is not null then
    if v_project.client_production_brief_id is distinct from p_client_production_brief_id then
      raise exception 'REEL_BRIEF_ALREADY_BOUND: Video project is already bound to a different production brief.';
    end if;
    return v_project;
  end if;

  v_source_table := case
    when v_project.organic_master_id is not null then 'organic_master'
    when v_project.ads_master_id is not null then 'ads_master'
    else null
  end;
  v_source_row_id := coalesce(v_project.organic_master_id, v_project.ads_master_id);
  if v_source_table is null or v_source_row_id is null then
    raise exception 'REEL_PROJECT_SOURCE_MISSING: Standalone projects cannot bind a production brief implicitly.';
  end if;

  select *
    into v_brief
    from public.client_production_briefs
   where id = p_client_production_brief_id
   for share;
  if not found then
    raise exception 'REEL_BRIEF_NOT_FOUND: Production brief does not exist.';
  end if;
  if v_brief.client_id is distinct from v_project.client_id
     or v_brief.source_table is distinct from v_source_table
     or v_brief.source_row_id is distinct from v_source_row_id
     or v_brief.asset_format is distinct from 'reel_video'
     or v_brief.status is distinct from 'approved'::public.review_state then
    raise exception 'REEL_BRIEF_BINDING_INVALID: Production brief is not an approved reel_video brief for the project source.';
  end if;

  update public.video_projects
     set client_production_brief_id = p_client_production_brief_id,
         updated_at = now()
   where id = p_video_project_id
  returning * into v_project;

  return v_project;
end;
$$;

create or replace function public.insert_reel_storyboard_if_empty(
  p_video_project_id uuid,
  p_client_id uuid,
  p_client_production_brief_id uuid,
  p_shots jsonb
)
returns setof public.video_shots
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.video_projects;
  v_brief public.client_production_briefs;
  v_shot_count integer;
  v_distinct_numbers integer;
  v_min_number integer;
  v_max_number integer;
begin
  if jsonb_typeof(p_shots) is distinct from 'array' then
    raise exception 'REEL_STORYBOARD_INVALID: p_shots must be a JSON array.';
  end if;

  v_shot_count := jsonb_array_length(p_shots);
  if v_shot_count < 4 or v_shot_count > 12 then
    raise exception 'REEL_STORYBOARD_INVALID: Storyboard must contain 4-12 shots.';
  end if;

  select *
    into v_project
    from public.video_projects
   where id = p_video_project_id
     and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_PROJECT_NOT_FOUND: Video project does not belong to client_id.';
  end if;
  if v_project.client_production_brief_id is distinct from p_client_production_brief_id then
    raise exception 'REEL_BRIEF_BINDING_INVALID: Project is not bound to the supplied production brief.';
  end if;
  if v_project.status not in ('storyboarding', 'generating') then
    raise exception 'REEL_PROJECT_NOT_EDITABLE: Storyboard can only be generated before review.';
  end if;

  select *
    into v_brief
    from public.client_production_briefs
   where id = p_client_production_brief_id
   for share;
  if not found
     or v_brief.client_id is distinct from v_project.client_id
     or v_brief.asset_format is distinct from 'reel_video'
     or v_brief.status is distinct from 'approved'::public.review_state
     or v_brief.source_table is distinct from (
       case when v_project.organic_master_id is not null then 'organic_master' else 'ads_master' end
     )
     or v_brief.source_row_id is distinct from coalesce(v_project.organic_master_id, v_project.ads_master_id) then
    raise exception 'REEL_BRIEF_BINDING_INVALID: Bound production brief is no longer valid for this project.';
  end if;

  if exists (select 1 from public.video_shots where video_project_id = p_video_project_id) then
    raise exception 'REEL_STORYBOARD_NOT_EMPTY: Project already has shots.';
  end if;

  select
    count(distinct (item ->> 'shot_number')::integer),
    min((item ->> 'shot_number')::integer),
    max((item ->> 'shot_number')::integer)
    into v_distinct_numbers, v_min_number, v_max_number
    from jsonb_array_elements(p_shots) item;

  if v_distinct_numbers <> v_shot_count or v_min_number <> 1 or v_max_number <> v_shot_count then
    raise exception 'REEL_STORYBOARD_INVALID: Shot numbers must be unique and contiguous from 1 through N.';
  end if;

  insert into public.video_shots (
    video_project_id,
    shot_number,
    beat_description,
    compiled_prompt,
    shot_class,
    human_presence,
    render_tier,
    motion_type,
    motion_strength,
    status
  )
  select
    p_video_project_id,
    (item ->> 'shot_number')::integer,
    btrim(item ->> 'beat_description'),
    btrim(item ->> 'compiled_prompt'),
    btrim(item ->> 'shot_class'),
    btrim(item ->> 'human_presence'),
    btrim(item ->> 'render_tier'),
    null,
    null,
    'pending'
  from jsonb_array_elements(p_shots) item
  order by (item ->> 'shot_number')::integer;

  insert into public.activity_log (
    client_id,
    event_type,
    plain_english_message,
    object_type,
    object_id,
    metadata
  )
  values (
    p_client_id,
    'reel_studio_storyboard_generated',
    'AI generated a validated Reel Studio storyboard.',
    'video_project',
    p_video_project_id,
    jsonb_build_object(
      'video_project_id', p_video_project_id,
      'production_brief_id', p_client_production_brief_id,
      'shot_count', v_shot_count
    )
  );

  return query
    select *
      from public.video_shots
     where video_project_id = p_video_project_id
     order by shot_number;
end;
$$;

create or replace function public.regenerate_pending_reel_shot(
  p_client_id uuid,
  p_video_project_id uuid,
  p_shot_id uuid,
  p_expected_updated_at timestamptz,
  p_planning jsonb
)
returns public.video_shots
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.video_projects;
  v_brief public.client_production_briefs;
  v_shot public.video_shots;
  v_updated public.video_shots;
begin
  select *
    into v_project
    from public.video_projects
   where id = p_video_project_id
     and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_PROJECT_NOT_FOUND: Video project does not belong to client_id.';
  end if;
  if v_project.status not in ('storyboarding', 'generating') then
    raise exception 'REEL_PROJECT_NOT_EDITABLE: Shot regeneration is unavailable after review starts.';
  end if;
  if v_project.client_production_brief_id is null then
    raise exception 'REEL_BRIEF_NOT_BOUND: Project must have a bound production brief.';
  end if;

  select *
    into v_brief
    from public.client_production_briefs
   where id = v_project.client_production_brief_id
   for share;
  if not found
     or v_brief.client_id is distinct from v_project.client_id
     or v_brief.asset_format is distinct from 'reel_video'
     or v_brief.status is distinct from 'approved'::public.review_state
     or v_brief.source_table is distinct from (
       case when v_project.organic_master_id is not null then 'organic_master' else 'ads_master' end
     )
     or v_brief.source_row_id is distinct from coalesce(v_project.organic_master_id, v_project.ads_master_id) then
    raise exception 'REEL_BRIEF_BINDING_INVALID: Bound production brief is no longer valid for this project.';
  end if;

  select *
    into v_shot
    from public.video_shots
   where id = p_shot_id
     and video_project_id = p_video_project_id
   for update;
  if not found then
    raise exception 'REEL_SHOT_NOT_FOUND: Shot does not belong to the supplied project.';
  end if;
  if v_shot.updated_at is distinct from p_expected_updated_at then
    raise exception 'REEL_SHOT_STALE: Shot changed after regeneration started; reload before trying again.';
  end if;
  if v_shot.status is distinct from 'pending'
     or v_shot.still_image_job_id is not null
     or v_shot.still_image_url is not null
     or v_shot.higgsfield_job_id is not null
     or v_shot.clip_url is not null then
    raise exception 'REEL_SHOT_NOT_PENDING: Shot image or video generation has already started.';
  end if;

  update public.video_shots
     set beat_description = btrim(p_planning ->> 'beat_description'),
         compiled_prompt = btrim(p_planning ->> 'compiled_prompt'),
         shot_class = btrim(p_planning ->> 'shot_class'),
         human_presence = btrim(p_planning ->> 'human_presence'),
         render_tier = btrim(p_planning ->> 'render_tier'),
         error = null,
         updated_at = now()
   where id = p_shot_id
  returning * into v_updated;

  insert into public.activity_log (
    client_id,
    event_type,
    plain_english_message,
    object_type,
    object_id,
    metadata
  )
  values (
    p_client_id,
    'reel_studio_shot_regenerated',
    'One pending Reel Studio shot was regenerated.',
    'video_shot',
    p_shot_id,
    jsonb_build_object(
      'video_project_id', p_video_project_id,
      'production_brief_id', v_project.client_production_brief_id,
      'shot_id', p_shot_id,
      'shot_number', v_shot.shot_number
    )
  );

  return v_updated;
end;
$$;

create or replace function public.delete_pending_reel_shot(
  p_client_id uuid,
  p_video_project_id uuid,
  p_shot_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.video_projects;
  v_shot public.video_shots;
begin
  select *
    into v_project
    from public.video_projects
   where id = p_video_project_id
     and client_id = p_client_id
   for update;
  if not found then
    raise exception 'REEL_PROJECT_NOT_FOUND: Video project does not belong to client_id.';
  end if;

  select *
    into v_shot
    from public.video_shots
   where id = p_shot_id
     and video_project_id = p_video_project_id
   for update;
  if not found then
    raise exception 'REEL_SHOT_NOT_FOUND: Shot does not belong to the supplied project.';
  end if;
  if v_shot.status is distinct from 'pending'
     or v_shot.still_image_job_id is not null
     or v_shot.still_image_url is not null
     or v_shot.higgsfield_job_id is not null
     or v_shot.clip_url is not null then
    raise exception 'REEL_SHOT_NOT_PENDING: Only a pending shot with no media job or object can be deleted.';
  end if;

  delete from public.video_shots where id = p_shot_id;

  insert into public.activity_log (
    client_id,
    event_type,
    plain_english_message,
    object_type,
    object_id,
    metadata
  )
  values (
    p_client_id,
    'reel_studio_shot_deleted',
    'One pending Reel Studio shot was deleted.',
    'video_shot',
    p_shot_id,
    jsonb_build_object(
      'video_project_id', p_video_project_id,
      'production_brief_id', v_project.client_production_brief_id,
      'shot_id', p_shot_id,
      'shot_number', v_shot.shot_number
    )
  );

  return p_shot_id;
end;
$$;

revoke all on function public.create_bound_reel_video_project(uuid, text, uuid, uuid, text, text, text, integer, uuid, uuid) from public, anon, authenticated;
revoke all on function public.bind_legacy_reel_project_brief(uuid, uuid) from public, anon, authenticated;
revoke all on function public.insert_reel_storyboard_if_empty(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.regenerate_pending_reel_shot(uuid, uuid, uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.delete_pending_reel_shot(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.create_bound_reel_video_project(uuid, text, uuid, uuid, text, text, text, integer, uuid, uuid) to service_role;
grant execute on function public.bind_legacy_reel_project_brief(uuid, uuid) to service_role;
grant execute on function public.insert_reel_storyboard_if_empty(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.regenerate_pending_reel_shot(uuid, uuid, uuid, timestamptz, jsonb) to service_role;
grant execute on function public.delete_pending_reel_shot(uuid, uuid, uuid) to service_role;
