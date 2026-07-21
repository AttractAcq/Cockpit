-- Forward repair: reject an explicitly supplied blank AI background prompt.
-- NULL still requests deterministic prompt construction from the approved brief.

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
  if p_prompt_text is not null and length(btrim(p_prompt_text))=0 then raise exception 'VALIDATION: prompt text cannot be blank'; end if;
  if p_prompt_text is null then
    v_prompt := concat_ws(E'\n',
      'Create a background image only; do not render text, logos, UI, or watermarks.',
      'Client asset: '||v_brief.title||' ('||v_brief.source_ref||').',
      'Format: '||p_format||case when p_frame_index is null then '.' else ', frame '||p_frame_index||'.' end,
      'Use the approved production brief as creative direction while preserving clear space and contrast for later typography.',
      left(v_brief.content_md,3000),
      case when nullif(trim(p_operator_notes),'') is null then null else 'Operator notes: '||trim(p_operator_notes) end
    );
  else
    v_prompt := btrim(p_prompt_text);
  end if;
  v_fingerprint := md5(concat_ws(E'\n',v_brief.title,v_brief.source_ref,v_brief.asset_format,v_brief.content_md,v_brief.version::text));
  insert into public.client_ai_background_image_generations(client_id,production_brief_id,source_ref,format,frame_index,prompt_text,prompt_created_by,brief_fingerprint_at_prompt)
  values(p_client_id,p_production_brief_id,trim(p_source_ref),p_format,p_frame_index,v_prompt,case when auth.role()='service_role' then 'system' else auth.uid()::text end,v_fingerprint)
  returning id into v_id;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values(p_client_id,'ai_background_prompt_created','AI background prompt draft created for '||trim(p_source_ref)||'.','client_ai_background_image_generation',v_id,jsonb_build_object('source_ref',trim(p_source_ref),'format',p_format,'frame_index',p_frame_index));
  return v_id;
end $$;

revoke all on function public.create_ai_background_prompt(uuid,uuid,text,text,integer,text,text) from public,anon;
grant execute on function public.create_ai_background_prompt(uuid,uuid,text,text,integer,text,text) to authenticated,service_role;

comment on function public.create_ai_background_prompt(uuid,uuid,text,text,integer,text,text) is 'Creates a deterministic prompt when prompt text is NULL; rejects explicitly blank prompt text and preserves approved-brief ownership and fingerprint validation.';
