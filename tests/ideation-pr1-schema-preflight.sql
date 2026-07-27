\set ON_ERROR_STOP on

-- Read-only dependency validation performed after restoring an authoritative
-- schema baseline and before applying the Ideation migration.
do $$
declare
  v_missing text[];
begin
  select array_agg(required.name order by required.name)
  into v_missing
  from (values
    ('public.clients'),
    ('public.users'),
    ('public.team_members'),
    ('public.activity_log'),
    ('public.client_context_files'),
    ('public.client_execution_files')
  ) as required(name)
  where to_regclass(required.name) is null;
  if v_missing is not null then
    raise exception 'AUTHORITATIVE_SCHEMA_MISSING_RELATIONS: %', v_missing;
  end if;
end
$$;

do $$
declare
  v_problem text;
begin
  with expected(table_name, column_name, udt_name) as (
    values
      ('clients','id','uuid'),
      ('users','id','uuid'),
      ('team_members','user_id','uuid'),
      ('activity_log','id','uuid'),
      ('activity_log','client_id','uuid'),
      ('activity_log','actor_id','uuid'),
      ('activity_log','event_type','text'),
      ('activity_log','plain_english_message','text'),
      ('activity_log','object_type','text'),
      ('activity_log','object_id','text'),
      ('activity_log','metadata','jsonb'),
      ('client_context_files','id','uuid'),
      ('client_context_files','client_id','uuid'),
      ('client_context_files','file_number','int4'),
      ('client_context_files','file_name','text'),
      ('client_context_files','content_md','text'),
      ('client_context_files','status','context_file_status'),
      ('client_context_files','version','int4'),
      ('client_execution_files','id','uuid'),
      ('client_execution_files','client_id','uuid'),
      ('client_execution_files','month','text'),
      ('client_execution_files','file_number','int4'),
      ('client_execution_files','file_name','text'),
      ('client_execution_files','content_md','text'),
      ('client_execution_files','review_state','review_state'),
      ('client_execution_files','version','int4')
  )
  select string_agg(
    format('%I.%I expected %s, found %s', expected.table_name, expected.column_name,
      expected.udt_name, coalesce(columns.udt_name, '<missing>')),
    '; ' order by expected.table_name, expected.column_name
  )
  into v_problem
  from expected
  left join information_schema.columns
    on columns.table_schema = 'public'
   and columns.table_name = expected.table_name
   and columns.column_name = expected.column_name
  where columns.column_name is null or columns.udt_name <> expected.udt_name;
  if v_problem is not null then
    raise exception 'AUTHORITATIVE_SCHEMA_COLUMN_MISMATCH: %', v_problem;
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')
    or not exists (select 1 from pg_roles where rolname = 'authenticated')
    or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'AUTHORITATIVE_SCHEMA_SUPABASE_ROLES_MISSING';
  end if;
  if to_regprocedure('public.auth_role()') is null then
    raise exception 'AUTHORITATIVE_SCHEMA_HELPER_MISSING: public.auth_role()';
  end if;
  if to_regprocedure('public.auth_client_ids()') is null
    or pg_get_function_result(to_regprocedure('public.auth_client_ids()')) <> 'uuid[]' then
    raise exception 'AUTHORITATIVE_SCHEMA_HELPER_MISMATCH: public.auth_client_ids() must return uuid[]';
  end if;
  if to_regprocedure('public.set_updated_at()') is null
    or pg_get_function_result(to_regprocedure('public.set_updated_at()')) <> 'trigger' then
    raise exception 'AUTHORITATIVE_SCHEMA_HELPER_MISMATCH: public.set_updated_at() must return trigger';
  end if;
  if to_regprocedure('gen_random_uuid()') is null then
    raise exception 'AUTHORITATIVE_SCHEMA_UUID_FUNCTION_MISSING: gen_random_uuid()';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    raise exception 'AUTHORITATIVE_SCHEMA_EXTENSION_MISSING: pgcrypto';
  end if;
  if exists (
    select 1
    from pg_proc
    where oid in (
      to_regprocedure('public.auth_role()'),
      to_regprocedure('public.auth_client_ids()'),
      to_regprocedure('public.set_updated_at()')
    )
      and not exists (
        select 1 from unnest(coalesce(proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
      )
  ) then
    raise exception 'AUTHORITATIVE_SCHEMA_SEARCH_PATH_UNPINNED';
  end if;
end
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['clients','client_context_files','client_execution_files']
  loop
    if not exists (
      select 1
      from pg_class
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = 'public'
        and pg_class.relname = v_table
        and pg_class.relrowsecurity
    ) then
      raise exception 'AUTHORITATIVE_SCHEMA_RLS_DISABLED: public.%', v_table;
    end if;
  end loop;
end
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['clients','users']
  loop
    if not exists (
      select 1
      from pg_constraint
      where conrelid = format('public.%I', v_table)::regclass
        and contype in ('p','u')
        and conkey = array[
          (select attnum from pg_attribute
           where attrelid = format('public.%I', v_table)::regclass and attname = 'id')
        ]::smallint[]
    ) then
      raise exception 'AUTHORITATIVE_SCHEMA_KEY_MISSING: public.%.id must be a primary/unique key', v_table;
    end if;
  end loop;
end
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'activity_log',
    'client_context_files',
    'client_execution_files'
  ]
  loop
    if not exists (
      select 1
      from pg_constraint
      where conrelid = format('public.%I', v_table)::regclass
        and confrelid = 'public.clients'::regclass
        and contype = 'f'
        and conkey = array[
          (select attnum from pg_attribute
           where attrelid = format('public.%I', v_table)::regclass and attname = 'client_id')
        ]::smallint[]
        and confkey = array[
          (select attnum from pg_attribute
           where attrelid = 'public.clients'::regclass and attname = 'id')
        ]::smallint[]
    ) then
      raise exception 'AUTHORITATIVE_SCHEMA_CLIENT_FK_MISSING: public.%.client_id', v_table;
    end if;
  end loop;
end
$$;

do $$
begin
  if exists (
    select 1
    from pg_class
    join pg_namespace on pg_namespace.oid = pg_class.relnamespace
    where pg_namespace.nspname = 'public'
      and (
        pg_class.relname like 'client_ideation_%'
        or pg_class.relname like 'idx_client_ideation_%'
      )
  ) or exists (
    select 1
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname in (
        'begin_ideation_run',
        'renew_ideation_run_lease',
        'complete_ideation_run',
        'fail_ideation_run'
      )
  ) or exists (
    select 1 from pg_policies
    where schemaname = 'public' and policyname like 'client_ideation_%'
  ) then
    raise exception 'AUTHORITATIVE_SCHEMA_IDEATION_NAME_COLLISION';
  end if;
end
$$;

select 'ideation authoritative-schema preflight passed' as result;
