-- Programme Stage O — corrective fix, found via live testing.
--
-- onboard_client is SECURITY DEFINER with `set search_path = ''` (the
-- established convention throughout this programme to prevent search-path
-- hijacking), which means every type, table and function reference inside
-- the function body must be fully schema-qualified. The insert into
-- public.clients correctly qualified every table/function reference but
-- cast p_package_tier as `::package_tier` instead of `::public.package_tier`
-- -- with an empty search_path, the bare type name cannot be resolved at
-- all ("type "package_tier" does not exist"), a real, immediate failure
-- caught by the live disposable-fixture test on the very first onboarding
-- call, before any real client was affected.

create or replace function public.onboard_client(
  p_name text, p_slug text, p_package_tier text default 'proof_sprint', p_template_id uuid default null,
  p_account_manager_id uuid default null, p_geography text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_client_id uuid;
  v_template public.client_onboarding_templates;
  v_area jsonb;
  v_capacity jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') <> 'admin' then raise exception 'AUTH: admin role required'; end if;
  if length(trim(coalesce(p_name,''))) = 0 then raise exception 'VALIDATION: name is required'; end if;
  if length(trim(coalesce(p_slug,''))) = 0 then raise exception 'VALIDATION: slug is required'; end if;

  insert into public.clients (name, slug, package_tier, status, account_manager_id, geography, onboarded_at)
  values (trim(p_name), trim(p_slug), p_package_tier::public.package_tier, 'prospect', p_account_manager_id, p_geography, now())
  returning id into v_client_id;

  if p_account_manager_id is not null then
    insert into public.team_members (user_id, client_id) values (p_account_manager_id, v_client_id)
    on conflict do nothing;
  end if;

  if p_template_id is not null then
    select * into v_template from public.client_onboarding_templates where id = p_template_id;
    if not found then raise exception 'NOT_FOUND: onboarding template'; end if;

    for v_area in select * from jsonb_array_elements(v_template.default_automation_policies) loop
      perform public.set_client_automation_policy(
        v_client_id, v_area->>'area', v_area->>'automation_level', coalesce(v_area->'thresholds', '{}'::jsonb)
      );
    end loop;

    if v_template.default_capacity_policy <> '{}'::jsonb then
      v_capacity := v_template.default_capacity_policy;
      perform public.set_client_capacity_policy(
        v_client_id,
        (v_capacity->>'monthly_generation_budget_units')::integer,
        (v_capacity->>'per_asset_budget_units')::integer,
        (v_capacity->>'provider_credit_budget_units')::integer,
        (v_capacity->>'max_simultaneous_jobs')::integer,
        (v_capacity->>'human_review_capacity_per_day')::integer,
        coalesce(v_capacity->>'client_priority', 'normal'),
        coalesce((v_capacity->>'due_date_priority_enabled')::boolean, true),
        coalesce((v_capacity->>'retry_cap')::integer, 5)
      );
    end if;

    update public.clients set onboarded_from_template_id = p_template_id where id = v_client_id;
  end if;

  insert into public.activity_log (client_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_client_id, 'client_onboarded', 'Client "' || trim(p_name) || '" onboarded' || case when p_template_id is not null then ' from template "' || v_template.name || '".' else '.' end,
    'client', v_client_id, jsonb_build_object('template_id', p_template_id, 'package_tier', p_package_tier));

  return v_client_id;
end; $$;
