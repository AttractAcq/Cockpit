-- Reel Studio: sequence-first storyboard generation.
--
-- Additive only. Every new column is nullable so storyboards generated before
-- this migration remain readable and editable exactly as they are; nothing is
-- backfilled and no existing project is regenerated.
--
-- What this adds:
--   * video_projects  — the persisted story spine, continuity plan, and the
--                       provenance/version record answering "which approved
--                       information produced this storyboard?"
--   * video_shots     — the per-shot narrative fields that make flow objectively
--                       checkable and let the UI label the sequence.
--   * two RPC updates — the storyboard insert now persists the project-level
--                       plan in the same transaction as the shots, and shot
--                       regeneration preserves the narrative role.

-- ---------------------------------------------------------------------------
-- Project-level story authority
-- ---------------------------------------------------------------------------

alter table public.video_projects
  add column if not exists story_strategy jsonb,
  add column if not exists continuity_plan jsonb,
  add column if not exists storyboard_provenance jsonb,
  add column if not exists storyboard_prompt_version text,
  add column if not exists storyboard_model text,
  add column if not exists storyboard_generated_at timestamptz;

comment on column public.video_projects.story_strategy is
  'Structured story spine generated before any shot exists. Null for storyboards created before the sequence-first generator.';
comment on column public.video_projects.continuity_plan is
  'Project-level visual continuity plan every shot prompt compiles from.';
comment on column public.video_projects.storyboard_provenance is
  'Which approved authority produced this storyboard: brief id, source row, approved context/execution file ids, brand block id+version, budget outcomes.';
comment on column public.video_projects.storyboard_prompt_version is
  'Prompt contract version used, so a future quality regression is traceable to a prompt change.';

-- ---------------------------------------------------------------------------
-- Shot-level narrative fields
-- ---------------------------------------------------------------------------

alter table public.video_shots
  add column if not exists story_role text,
  add column if not exists narrative_beat text,
  add column if not exists message_supported text,
  add column if not exists transition_from_previous text,
  add column if not exists transition_to_next text,
  add column if not exists visual_continuity jsonb,
  add column if not exists emotional_intent text;

comment on column public.video_shots.story_role is
  'Narrative job this shot performs in the sequence. Null for shots created before the sequence-first generator.';
comment on column public.video_shots.visual_continuity is
  'JSON array of continuity anchors this frame must carry, repeated into the compiled prompt.';

-- Null stays legal so legacy rows are untouched; a written value must be a
-- recognised role.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'video_shots_story_role_check'
  ) then
    alter table public.video_shots
      add constraint video_shots_story_role_check
      check (
        story_role is null
        or story_role in ('hook','problem','escalation','insight','proof','transformation','payoff','cta')
      );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storyboard insert: shots + project-level plan in one transaction
-- ---------------------------------------------------------------------------

-- Recreated with four trailing DEFAULT NULL parameters, so any existing 4-arg
-- caller keeps resolving to this function unchanged.
drop function if exists public.insert_reel_storyboard_if_empty(uuid, uuid, uuid, jsonb);

create function public.insert_reel_storyboard_if_empty(
  p_video_project_id uuid,
  p_client_id uuid,
  p_client_production_brief_id uuid,
  p_shots jsonb,
  p_story_strategy jsonb default null,
  p_continuity_plan jsonb default null,
  p_provenance jsonb default null,
  p_prompt_version text default null,
  p_model text default null
)
returns setof video_shots
language plpgsql
security definer
set search_path to ''
as $function$
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
    status,
    story_role,
    narrative_beat,
    message_supported,
    transition_from_previous,
    transition_to_next,
    visual_continuity,
    emotional_intent
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
    'pending',
    nullif(btrim(coalesce(item ->> 'story_role', '')), ''),
    nullif(btrim(coalesce(item ->> 'narrative_beat', '')), ''),
    nullif(btrim(coalesce(item ->> 'message_supported', '')), ''),
    nullif(btrim(coalesce(item ->> 'transition_from_previous', '')), ''),
    nullif(btrim(coalesce(item ->> 'transition_to_next', '')), ''),
    case when item ? 'visual_continuity' then item -> 'visual_continuity' else null end,
    nullif(btrim(coalesce(item ->> 'emotional_intent', '')), '')
  from jsonb_array_elements(p_shots) item
  order by (item ->> 'shot_number')::integer;

  -- The story spine is written in the same transaction as the shots it
  -- produced, so a project can never hold shots whose plan is missing.
  update public.video_projects
     set story_strategy = coalesce(p_story_strategy, story_strategy),
         continuity_plan = coalesce(p_continuity_plan, continuity_plan),
         storyboard_provenance = coalesce(p_provenance, storyboard_provenance),
         storyboard_prompt_version = coalesce(p_prompt_version, storyboard_prompt_version),
         storyboard_model = coalesce(p_model, storyboard_model),
         storyboard_generated_at = case when p_story_strategy is not null then now() else storyboard_generated_at end,
         updated_at = now()
   where id = p_video_project_id;

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
      'shot_count', v_shot_count,
      'storyboard_prompt_version', p_prompt_version
    )
  );

  return query
    select *
      from public.video_shots
     where video_project_id = p_video_project_id
     order by shot_number;
end;
$function$;

revoke all on function public.insert_reel_storyboard_if_empty(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, text, text) from public;
grant execute on function public.insert_reel_storyboard_if_empty(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Shot regeneration: replace planning fields, preserve sequence position
-- ---------------------------------------------------------------------------

create or replace function public.regenerate_pending_reel_shot(
  p_client_id uuid,
  p_video_project_id uuid,
  p_shot_id uuid,
  p_expected_updated_at timestamp with time zone,
  p_planning jsonb
)
returns video_shots
language plpgsql
security definer
set search_path to ''
as $function$
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

  -- A regenerated shot keeps its number and its narrative role: regeneration
  -- replaces how a beat is expressed, never what job it does in the sequence.
  if p_planning ? 'story_role'
     and v_shot.story_role is not null
     and btrim(p_planning ->> 'story_role') is distinct from v_shot.story_role then
    raise exception 'REEL_SHOT_ROLE_CHANGED: Regeneration must preserve the shot''s story role.';
  end if;

  update public.video_shots
     set beat_description = btrim(p_planning ->> 'beat_description'),
         compiled_prompt = btrim(p_planning ->> 'compiled_prompt'),
         shot_class = btrim(p_planning ->> 'shot_class'),
         human_presence = btrim(p_planning ->> 'human_presence'),
         render_tier = btrim(p_planning ->> 'render_tier'),
         story_role = coalesce(nullif(btrim(coalesce(p_planning ->> 'story_role', '')), ''), story_role),
         narrative_beat = coalesce(nullif(btrim(coalesce(p_planning ->> 'narrative_beat', '')), ''), narrative_beat),
         message_supported = coalesce(nullif(btrim(coalesce(p_planning ->> 'message_supported', '')), ''), message_supported),
         transition_from_previous = coalesce(
           nullif(btrim(coalesce(p_planning ->> 'transition_from_previous', '')), ''), transition_from_previous),
         transition_to_next = coalesce(
           nullif(btrim(coalesce(p_planning ->> 'transition_to_next', '')), ''), transition_to_next),
         visual_continuity = case
           when p_planning ? 'visual_continuity' then p_planning -> 'visual_continuity'
           else visual_continuity
         end,
         emotional_intent = coalesce(nullif(btrim(coalesce(p_planning ->> 'emotional_intent', '')), ''), emotional_intent),
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
      'shot_number', v_shot.shot_number,
      'story_role', v_updated.story_role
    )
  );

  return v_updated;
end;
$function$;

revoke all on function public.regenerate_pending_reel_shot(uuid, uuid, uuid, timestamp with time zone, jsonb) from public;
grant execute on function public.regenerate_pending_reel_shot(uuid, uuid, uuid, timestamp with time zone, jsonb) to service_role;
