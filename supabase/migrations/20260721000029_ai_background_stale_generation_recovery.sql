-- Manual, audited recovery for an interrupted AI background generation.
-- This never calls a provider, touches storage, creates assets, or publishes.

create or replace function public.recover_stale_ai_background_generation(p_generation_id uuid)
returns public.client_ai_background_image_generations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.client_ai_background_image_generations;
  v_message constant text := 'Recovered after interrupted provider execution; no image was stored. Create a new prompt/generation if retry is required.';
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then
    raise exception 'AUTH: staff role required';
  end if;

  update public.client_ai_background_image_generations
  set prompt_status='failed',error_message=v_message,updated_at=now()
  where id=p_generation_id
    and prompt_status='generating'
    and storage_path is null
    and generated_at is null
    and provider_response='{}'::jsonb
    and updated_at < now()-interval '5 minutes'
  returning * into v_row;

  if not found then
    raise exception 'RECOVERY_REJECTED: generation must be stale, generating, and have no stored or provider result';
  end if;

  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values(v_row.client_id,'ai_background_generation_recovered','Interrupted AI background generation recovered as failed for '||v_row.source_ref||'.','client_ai_background_image_generation',v_row.id,jsonb_build_object('source_ref',v_row.source_ref,'previous_status','generating','new_status','failed'));
  return v_row;
end $$;

revoke all on function public.recover_stale_ai_background_generation(uuid) from public,anon;
grant execute on function public.recover_stale_ai_background_generation(uuid) to authenticated,service_role;
comment on function public.recover_stale_ai_background_generation(uuid) is 'Manually terminalizes one stale generating AI background row with no stored/provider result; never retries provider work.';
