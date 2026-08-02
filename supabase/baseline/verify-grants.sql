-- Dedicated least-privilege gate for representative service-role-only RPCs.
do $$
declare
  signature text;
  signatures text[] := array[
    'public.apply_delete_asset(uuid,uuid)',
    'public.claim_due_distribution_records(text,integer)',
    'public.commit_ideation_content(uuid,uuid,integer,uuid,text,jsonb,text,text,text,text,text,text,text)',
    'public.insert_reel_storyboard_if_empty(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,text)',
    'public.persist_instagram_insights_collection(uuid,uuid,text,text[],jsonb,text[])',
    'public.reset_failed_reel_shot_video(uuid,uuid,uuid,timestamp with time zone,text,numeric)'
  ];
begin
  foreach signature in array signatures loop
    if to_regprocedure(signature) is null then raise exception 'missing restricted function %', signature; end if;
    if has_function_privilege('anon', signature, 'EXECUTE') then raise exception 'anon can execute %', signature; end if;
    if has_function_privilege('authenticated', signature, 'EXECUTE') then raise exception 'authenticated can execute %', signature; end if;
    if not has_function_privilege('service_role', signature, 'EXECUTE') then raise exception 'service_role cannot execute %', signature; end if;
  end loop;
end
$$;
\echo STAGE_A_CASE grants.six_restricted_rpcs_are_service_role_only PASS
