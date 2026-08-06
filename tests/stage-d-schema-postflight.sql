-- Programme Stage D — schema postflight.
--
-- Verifies the guarantees Stage D depends on are actually enforced by the
-- database, not merely by application code. Run against the linked project:
--   supabase db query --linked -f tests/stage-d-schema-postflight.sql
--
-- Every row returned must show status 'PASS'.

with checks as (

  -- Approval fails closed: `approved` is unreachable without a passed
  -- reconciliation AND a human approver.
  select 'approval_check_present' as check_name,
         case when exists (
           select 1 from pg_constraint
           where conname = 'client_execution_configs_approval_check'
             and pg_get_constraintdef(oid) ilike '%reconciliation_status%passed%'
             and pg_get_constraintdef(oid) ilike '%approved_by is not null%'
             and pg_get_constraintdef(oid) ilike '%approved_at is not null%'
         ) then 'PASS' else 'FAIL' end as status

  -- At most one approved config per client and month.
  union all
  select 'single_approved_config',
         case when exists (
           select 1 from pg_indexes
           where indexname = 'client_execution_configs_single_approved'
             and indexdef ilike '%unique%'
             and indexdef ilike '%where (status = ''approved''::text)%'
         ) then 'PASS' else 'FAIL' end

  -- Derivation is idempotent: one requirement per config/platform/channel/format.
  union all
  select 'requirement_derivation_identity',
         case when exists (
           select 1 from pg_indexes
           where indexname = 'content_requirements_derived_identity'
             and indexdef ilike '%unique%'
             and indexdef ilike '%execution_config_id, platform, channel, asset_format%'
         ) then 'PASS' else 'FAIL' end

  -- Derived rows must always carry a platform, or the unique index above is
  -- defeated by SQL's NULL-distinct rule.
  union all
  select 'derived_platform_not_null',
         case when exists (
           select 1 from pg_constraint
           where conname = 'content_requirements_derived_platform_check'
         ) then 'PASS' else 'FAIL' end

  -- Slot identity remains enforced by the Stage B constraint, unweakened.
  union all
  select 'slot_identity_unique',
         case when exists (
           select 1 from pg_constraint
           where conname = 'calendar_slots_unique'
             and pg_get_constraintdef(oid) ilike
                 '%(content_requirement_id, scheduled_for, slot_index)%'
         ) then 'PASS' else 'FAIL' end

  -- Slots default to non-operational; only approval may promote them.
  union all
  select 'slots_default_non_operational',
         case when (
           select column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'calendar_slots'
             and column_name = 'is_operational'
         ) = 'false' then 'PASS' else 'FAIL' end

  -- A requirement cannot be orphaned from the config that justifies it.
  union all
  select 'requirement_config_fk_restrict',
         case when exists (
           select 1 from pg_constraint
           where conrelid = 'public.content_requirements'::regclass
             and contype = 'f'
             and confrelid = 'public.client_execution_configs'::regclass
             and confdeltype = 'r'   -- ON DELETE RESTRICT
         ) then 'PASS' else 'FAIL' end

  -- Client isolation: RLS on, and the read policy is client-scoped.
  union all
  select 'rls_enabled_on_stage_d_tables',
         case when (
           select bool_and(rowsecurity) from pg_tables
           where schemaname = 'public'
             and tablename in ('client_execution_configs', 'client_execution_config_checks')
         ) then 'PASS' else 'FAIL' end

  union all
  select 'config_select_policy_client_scoped',
         case when exists (
           select 1 from pg_policies
           where schemaname = 'public'
             and tablename = 'client_execution_configs'
             and qual ilike '%auth_client_ids()%'
         ) then 'PASS' else 'FAIL' end

  -- No anon or authenticated write path to Stage D tables; writes are
  -- service-role only, i.e. edge functions.
  union all
  select 'no_direct_write_grants',
         case when not exists (
           select 1 from information_schema.role_table_grants
           where table_schema = 'public'
             and table_name in ('client_execution_configs', 'client_execution_config_checks')
             and grantee in ('anon', 'authenticated')
             and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
         ) then 'PASS' else 'FAIL' end
)
select check_name, status from checks order by status desc, check_name;
