-- Human-reviewed AI background-image prompts and generated-image records.
-- Additive only: this does not generate an image, start asset production, or publish.

create table public.client_ai_background_image_generations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  production_brief_id uuid not null references public.client_production_briefs(id) on delete restrict,
  source_ref text not null check (length(trim(source_ref)) > 0),
  format text not null check (format in ('feed_post','carousel','story_sequence')),
  frame_index integer check (frame_index is null or frame_index > 0),
  prompt_text text not null check (length(trim(prompt_text)) > 0),
  prompt_status text not null default 'draft' check (prompt_status in ('draft','needs_review','approved','rejected','generating','generated','failed')),
  prompt_created_by text not null default 'operator',
  prompt_approved_by text,
  prompt_approved_at timestamptz,
  brief_fingerprint_at_prompt text not null,
  brief_fingerprint_at_approval text,
  image_model text,
  image_size text,
  image_quality text,
  storage_bucket text,
  storage_path text,
  public_url text,
  provider_response jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_response) = 'object'),
  error_message text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (prompt_status <> 'generated' or (storage_path is not null and generated_at is not null))
);

create table public.client_ai_background_image_reviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  generation_id uuid not null references public.client_ai_background_image_generations(id) on delete cascade,
  previous_status text,
  new_status text not null,
  review_note text,
  reviewed_by text not null default 'operator',
  created_at timestamptz not null default now()
);

create index client_ai_background_generations_client_idx on public.client_ai_background_image_generations(client_id,created_at desc);
create index client_ai_background_generations_source_idx on public.client_ai_background_image_generations(client_id,source_ref,created_at desc);
create index client_ai_background_generations_brief_idx on public.client_ai_background_image_generations(production_brief_id,created_at desc);
create index client_ai_background_generations_status_idx on public.client_ai_background_image_generations(client_id,prompt_status,created_at desc);
create index client_ai_background_reviews_generation_idx on public.client_ai_background_image_reviews(generation_id,created_at desc);
create unique index client_ai_background_one_active_generation
  on public.client_ai_background_image_generations(client_id,production_brief_id,coalesce(frame_index,0))
  where prompt_status in ('generating');

alter table public.client_ai_background_image_generations enable row level security;
alter table public.client_ai_background_image_reviews enable row level security;
revoke all on public.client_ai_background_image_generations,public.client_ai_background_image_reviews from public,anon,authenticated;
grant select on public.client_ai_background_image_generations,public.client_ai_background_image_reviews to authenticated;
grant select,insert,update,delete on public.client_ai_background_image_generations,public.client_ai_background_image_reviews to service_role;
create policy client_ai_background_generations_staff_select on public.client_ai_background_image_generations for select to authenticated
  using (public.auth_role() in ('admin','account_manager','editor'));
create policy client_ai_background_reviews_staff_select on public.client_ai_background_image_reviews for select to authenticated
  using (public.auth_role() in ('admin','account_manager','editor'));

create or replace function public.create_ai_background_prompt(
  p_client_id uuid,p_production_brief_id uuid,p_source_ref text,p_format text,
  p_frame_index integer default null,p_operator_notes text default null,p_prompt_text text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_brief public.client_production_briefs; v_id uuid; v_prompt text; v_fingerprint text;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
  select * into v_brief from public.client_production_briefs where id=p_production_brief_id and client_id=p_client_id;
  if not found then raise exception 'VALIDATION: production brief does not belong to client'; end if;
  if v_brief.source_ref is distinct from trim(p_source_ref) then raise exception 'VALIDATION: production brief does not belong to source ref'; end if;
  if v_brief.asset_format is distinct from p_format then raise exception 'VALIDATION: format does not match production brief'; end if;
  if v_brief.status is distinct from 'approved'::public.review_state then raise exception 'VALIDATION: production brief must be approved'; end if;
  if p_format not in ('feed_post','carousel','story_sequence') then raise exception 'VALIDATION: format is not supported for AI backgrounds'; end if;
  v_prompt := nullif(trim(p_prompt_text),'');
  if v_prompt is null then
    v_prompt := concat_ws(E'\n',
      'Create a background image only; do not render text, logos, UI, or watermarks.',
      'Client asset: '||v_brief.title||' ('||v_brief.source_ref||').',
      'Format: '||p_format||case when p_frame_index is null then '.' else ', frame '||p_frame_index||'.' end,
      'Use the approved production brief as creative direction while preserving clear space and contrast for later typography.',
      left(v_brief.content_md,3000),
      case when nullif(trim(p_operator_notes),'') is null then null else 'Operator notes: '||trim(p_operator_notes) end
    );
  end if;
  v_fingerprint := md5(concat_ws(E'\n',v_brief.title,v_brief.source_ref,v_brief.asset_format,v_brief.content_md,v_brief.version::text));
  insert into public.client_ai_background_image_generations(client_id,production_brief_id,source_ref,format,frame_index,prompt_text,prompt_created_by,brief_fingerprint_at_prompt)
  values(p_client_id,p_production_brief_id,trim(p_source_ref),p_format,p_frame_index,v_prompt,case when auth.role()='service_role' then 'system' else auth.uid()::text end,v_fingerprint)
  returning id into v_id;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values(p_client_id,'ai_background_prompt_created','AI background prompt draft created for '||trim(p_source_ref)||'.','client_ai_background_image_generation',v_id,jsonb_build_object('source_ref',trim(p_source_ref),'format',p_format,'frame_index',p_frame_index));
  return v_id;
end $$;

create or replace function public.update_ai_background_prompt(
  p_generation_id uuid,p_prompt_text text default null,p_new_status text default null,p_review_note text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.client_ai_background_image_generations; v_brief public.client_production_briefs; v_prompt text; v_status text; v_fingerprint text;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
  select * into v_row from public.client_ai_background_image_generations where id=p_generation_id for update;
  if not found then raise exception 'NOT_FOUND: AI background prompt'; end if;
  v_prompt := coalesce(nullif(trim(p_prompt_text),''),v_row.prompt_text);
  v_status := coalesce(nullif(trim(p_new_status),''),v_row.prompt_status);
  if p_prompt_text is not null and v_row.prompt_status not in ('draft','failed') then raise exception 'VALIDATION: only draft prompts can be edited'; end if;
  if length(trim(v_prompt))=0 then raise exception 'VALIDATION: prompt cannot be blank'; end if;
  if v_status is distinct from v_row.prompt_status and not (
    (v_row.prompt_status='draft' and v_status in ('needs_review','rejected')) or
    (v_row.prompt_status='needs_review' and v_status in ('approved','rejected')) or
    (v_row.prompt_status='approved' and v_status='rejected') or
    (v_row.prompt_status='failed' and v_status='draft')
  ) then raise exception 'VALIDATION: invalid prompt status transition'; end if;
  if v_status='approved' and v_status is distinct from v_row.prompt_status then
    select * into v_brief from public.client_production_briefs where id=v_row.production_brief_id and client_id=v_row.client_id for share;
    if not found or v_brief.source_ref is distinct from v_row.source_ref or v_brief.asset_format is distinct from v_row.format or v_brief.status is distinct from 'approved'::public.review_state then
      raise exception 'STALE_BRIEF: linked production brief is missing, mismatched, or not approved; create a new prompt draft';
    end if;
    v_fingerprint := md5(concat_ws(E'\n',v_brief.title,v_brief.source_ref,v_brief.asset_format,v_brief.content_md,v_brief.version::text));
    if v_fingerprint is distinct from v_row.brief_fingerprint_at_prompt then
      raise exception 'STALE_BRIEF: production brief changed after prompt creation; create a new prompt draft';
    end if;
  end if;
  update public.client_ai_background_image_generations set prompt_text=v_prompt,prompt_status=v_status,
    prompt_approved_by=case when v_status='approved' then case when auth.role()='service_role' then 'system' else auth.uid()::text end else prompt_approved_by end,
    prompt_approved_at=case when v_status='approved' then now() else prompt_approved_at end,
    brief_fingerprint_at_approval=case when v_status='approved' then v_fingerprint else brief_fingerprint_at_approval end,
    error_message=case when v_status='draft' then null else error_message end,updated_at=now()
  where id=v_row.id;
  if v_status is distinct from v_row.prompt_status then
    insert into public.client_ai_background_image_reviews(client_id,generation_id,previous_status,new_status,review_note,reviewed_by)
    values(v_row.client_id,v_row.id,v_row.prompt_status,v_status,nullif(trim(p_review_note),''),case when auth.role()='service_role' then 'system' else auth.uid()::text end);
    insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata)
    values(v_row.client_id,'ai_background_prompt_'||v_status,'AI background prompt marked '||replace(v_status,'_',' ')||' for '||v_row.source_ref||'.','client_ai_background_image_generation',v_row.id,jsonb_build_object('previous_status',v_row.prompt_status,'new_status',v_status));
  end if;
end $$;

-- Atomic claim used only by the authenticated Edge Function after its own staff check.
create or replace function public.generate_ai_background_image(p_generation_id uuid,p_client_id uuid,p_image_size text default null,p_image_quality text default null)
returns setof public.client_ai_background_image_generations language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'AUTH: service role required'; end if;
  return query update public.client_ai_background_image_generations
    set prompt_status='generating',image_size=nullif(trim(p_image_size),''),
      image_quality=nullif(trim(p_image_quality),''),error_message=null,updated_at=now()
    where id=p_generation_id and client_id=p_client_id and prompt_status='approved'
      and production_brief_id is not null and brief_fingerprint_at_approval is not null
      and exists(select 1 from public.client_production_briefs b where b.id=client_ai_background_image_generations.production_brief_id and b.client_id=client_ai_background_image_generations.client_id and b.source_ref=client_ai_background_image_generations.source_ref and b.asset_format=client_ai_background_image_generations.format and b.status='approved'::public.review_state and md5(concat_ws(E'\n',b.title,b.source_ref,b.asset_format,b.content_md,b.version::text))=client_ai_background_image_generations.brief_fingerprint_at_approval)
      and not exists(select 1 from public.client_ai_background_image_generations x where x.id<>p_generation_id and x.client_id=client_ai_background_image_generations.client_id and x.production_brief_id=client_ai_background_image_generations.production_brief_id and coalesce(x.frame_index,0)=coalesce(client_ai_background_image_generations.frame_index,0) and x.prompt_status='generating')
    returning *;
  if not found then raise exception 'STALE_BRIEF: prompt must be approved, current, client-owned, and have no active generation; create or re-approve a fresh prompt'; end if;
end $$;

revoke all on function public.create_ai_background_prompt(uuid,uuid,text,text,integer,text,text),public.update_ai_background_prompt(uuid,text,text,text),public.generate_ai_background_image(uuid,uuid,text,text) from public,anon;
grant execute on function public.create_ai_background_prompt(uuid,uuid,text,text,integer,text,text),public.update_ai_background_prompt(uuid,text,text,text) to authenticated,service_role;
grant execute on function public.generate_ai_background_image(uuid,uuid,text,text) to service_role;

comment on table public.client_ai_background_image_generations is 'Human-reviewed prompt and durable generated background metadata. Generated images do not start final asset generation or publishing.';
comment on table public.client_ai_background_image_reviews is 'Audit trail for human prompt review transitions.';
comment on function public.generate_ai_background_image(uuid,uuid,text,text) is 'Service-role atomic claim that revalidates client ownership, approved production brief state, and the approval-time brief fingerprint before provider work.';
