\set ON_ERROR_STOP on

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'client_ideation_cycles',
    'client_ideation_technique_runs',
    'client_ideation_research_results',
    'client_ideation_candidates'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'IDEATION_POSTFLIGHT_TABLE_MISSING: public.%', v_table;
    end if;
    if not exists (
      select 1
      from pg_class
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = 'public'
        and pg_class.relname = v_table
        and pg_class.relrowsecurity
    ) then
      raise exception 'IDEATION_POSTFLIGHT_RLS_DISABLED: public.%', v_table;
    end if;
    if not has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') then
      raise exception 'IDEATION_POSTFLIGHT_AUTHENTICATED_SELECT_MISSING: public.%', v_table;
    end if;
    if has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
      or has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
      or has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE') then
      raise exception 'IDEATION_POSTFLIGHT_AUTHENTICATED_MUTATION_GRANTED: public.%', v_table;
    end if;
  end loop;
end
$$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.begin_ideation_run(uuid,text,date,date,text[],text,text,jsonb,jsonb,jsonb,jsonb,text,integer,uuid)',
    'public.renew_ideation_run_lease(uuid,text,integer)',
    'public.complete_ideation_run(uuid,text,jsonb,jsonb,jsonb,text,text,text,text,uuid)',
    'public.fail_ideation_run(uuid,text,text,text,uuid)'
  ]
  loop
    if to_regprocedure(v_signature) is null then
      raise exception 'IDEATION_POSTFLIGHT_FUNCTION_MISSING: %', v_signature;
    end if;
    if not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'IDEATION_POSTFLIGHT_SERVICE_EXECUTE_MISSING: %', v_signature;
    end if;
    if has_function_privilege('authenticated', v_signature, 'EXECUTE')
      or has_function_privilege('anon', v_signature, 'EXECUTE') then
      raise exception 'IDEATION_POSTFLIGHT_PUBLIC_EXECUTE_PRESENT: %', v_signature;
    end if;
  end loop;
end
$$;

select 'ideation authoritative-schema postflight passed' as result;
