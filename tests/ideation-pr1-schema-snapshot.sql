\pset tuples_only on
\pset format unaligned

with dependency_relations as (
  select unnest(array[
    'clients','users','team_members','client_users','activity_log',
    'client_context_files','client_execution_files','playbooks','playbook_runs'
  ]) as relname
),
snapshot as (
  select jsonb_build_object(
    'extensions', (
      select coalesce(jsonb_agg(jsonb_build_object('name', extname, 'version', extversion)
        order by extname), '[]'::jsonb)
      from pg_extension
    ),
    'relations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', pg_class.relname,
        'kind', pg_class.relkind,
        'rls', pg_class.relrowsecurity,
        'force_rls', pg_class.relforcerowsecurity
      ) order by pg_class.relname), '[]'::jsonb)
      from pg_class
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = 'public'
        and pg_class.relname in (select relname from dependency_relations)
    ),
    'columns', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', table_name,
        'column', column_name,
        'type', data_type,
        'udt', udt_schema || '.' || udt_name,
        'nullable', is_nullable,
        'default', column_default
      ) order by table_name, ordinal_position), '[]'::jsonb)
      from information_schema.columns
      where table_schema = 'public'
        and table_name in (select relname from dependency_relations)
    ),
    'constraints', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', pg_class.relname,
        'name', pg_constraint.conname,
        'type', pg_constraint.contype,
        'definition', pg_get_constraintdef(pg_constraint.oid, true)
      ) order by pg_class.relname, pg_constraint.conname), '[]'::jsonb)
      from pg_constraint
      join pg_class on pg_class.oid = pg_constraint.conrelid
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = 'public'
        and pg_class.relname in (select relname from dependency_relations)
    ),
    'indexes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', tablename,
        'name', indexname,
        'definition', indexdef
      ) order by tablename, indexname), '[]'::jsonb)
      from pg_indexes
      where schemaname = 'public'
        and tablename in (select relname from dependency_relations)
    ),
    'policies', (
      select coalesce(jsonb_agg(to_jsonb(pg_policies)
        order by tablename, policyname), '[]'::jsonb)
      from pg_policies
      where schemaname = 'public'
        and tablename in (select relname from dependency_relations)
    ),
    'grants', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', table_name,
        'grantee', grantee,
        'privilege', privilege_type,
        'grantable', is_grantable
      ) order by table_name, grantee, privilege_type), '[]'::jsonb)
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name in (select relname from dependency_relations)
    ),
    'helpers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'signature', pg_get_function_identity_arguments(pg_proc.oid),
        'name', pg_proc.proname,
        'result', pg_get_function_result(pg_proc.oid),
        'security_definer', pg_proc.prosecdef,
        'config', pg_proc.proconfig,
        'definition', pg_get_functiondef(pg_proc.oid)
      ) order by pg_proc.proname, pg_get_function_identity_arguments(pg_proc.oid)), '[]'::jsonb)
      from pg_proc
      join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
      where pg_namespace.nspname = 'public'
        and pg_proc.proname in ('auth_role','auth_client_ids','set_updated_at')
    )
  ) as value
)
select value::text from snapshot;
