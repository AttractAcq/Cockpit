-- Frozen-object snapshot for Stage 4. The operational Calendar, the content
-- masters, Phase 1/2 authority, Stage 1, Stage 2, Stage 3, and playbooks must be
-- byte-identical before and after the Stage 4 migration.
\pset tuples_only on
\pset format unaligned

with frozen as (
  select unnest(array[
    'calendar_cells','organic_master','story_master','ads_master','proof_master',
    'client_ideation_cycles','client_ideation_technique_runs',
    'client_ideation_research_results','client_ideation_candidates',
    'client_ideation_scoring_runs','client_ideation_candidate_scores',
    'client_ideation_calendar_proposals','client_ideation_calendar_proposal_slots',
    'client_context_files','client_execution_files','playbooks','playbook_runs',
    'client_production_briefs','client_assets','client_distribution_records',
    'client_analytics_records'
  ]) as relname
)
select jsonb_pretty(jsonb_build_object(
  'columns', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', table_name, 'column', column_name, 'type', data_type,
      'nullable', is_nullable, 'default', column_default)
      order by table_name, ordinal_position), '[]'::jsonb)
    from information_schema.columns
    where table_schema = 'public' and table_name in (select relname from frozen)
  ),
  'constraints', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', rel.relname, 'name', con.conname, 'definition', pg_get_constraintdef(con.oid))
      order by rel.relname, con.conname), '[]'::jsonb)
    from pg_constraint con join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname in (select relname from frozen)
      -- Stage 4's one documented additive constraint is expected: the composite
      -- unique key a commit item needs for its ownership foreign key.
      and con.conname <> 'client_ideation_proposal_slots_id_proposal_key'
  ),
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', rel.relname, 'name', pol.polname, 'cmd', pol.polcmd,
      'using', pg_get_expr(pol.polqual, pol.polrelid))
      order by rel.relname, pol.polname), '[]'::jsonb)
    from pg_policy pol join pg_class rel on rel.oid = pol.polrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname in (select relname from frozen)
  ),
  'triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', rel.relname, 'name', tg.tgname) order by rel.relname, tg.tgname), '[]'::jsonb)
    from pg_trigger tg join pg_class rel on rel.oid = tg.tgrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname in (select relname from frozen) and not tg.tgisinternal
  ),
  'allocator', (
    -- Stage 4 reuses this function unchanged; its definition must not drift.
    select coalesce(jsonb_agg(pg_get_functiondef(p.oid) order by p.oid), '[]'::jsonb)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'allocate_phase3_ref'
  )
));
