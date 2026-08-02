-- Representative global and client-scoped uniqueness evidence.
-- First writes and non-conflicting writes survive until the final rollback.

begin;

insert into public.clients (id, name, slug) values
  ('c4000000-0000-0000-0000-000000000001', 'Unique Client One', 'stage-a-unique-one'),
  ('c4000000-0000-0000-0000-000000000002', 'Unique Client Two', 'stage-a-unique-two');

do $$
declare
  diagnosed_constraint text;
begin
  begin
    insert into public.clients (id, name, slug)
    values ('c4000000-0000-0000-0000-000000000003', 'Duplicate Slug', 'stage-a-unique-one');
    raise exception 'clients_slug_key accepted a conflicting duplicate';
  exception when unique_violation then
    get stacked diagnostics diagnosed_constraint = constraint_name;
    if diagnosed_constraint <> 'clients_slug_key' then
      raise exception 'expected clients_slug_key, diagnosed %', diagnosed_constraint;
    end if;
  end;

  insert into public.clients (id, name, slug)
  values ('c4000000-0000-0000-0000-000000000004', 'Distinct Slug', 'stage-a-unique-distinct');
end
$$;

insert into public.organic_master (client_id, month, ref, content_type) values
  ('c4000000-0000-0000-0000-000000000001', '2026-08', 'SHARED-REF', 'RL'),
  ('c4000000-0000-0000-0000-000000000002', '2026-08', 'SHARED-REF', 'FP'),
  ('c4000000-0000-0000-0000-000000000001', '2026-08', 'DISTINCT-REF', 'CR');

do $$
declare
  diagnosed_constraint text;
begin
  begin
    insert into public.organic_master (client_id, month, ref, content_type)
    values ('c4000000-0000-0000-0000-000000000001', '2026-09', 'SHARED-REF', 'RL');
    raise exception 'organic_master_client_id_ref_key accepted a same-client duplicate';
  exception when unique_violation then
    get stacked diagnostics diagnosed_constraint = constraint_name;
    if diagnosed_constraint <> 'organic_master_client_id_ref_key' then
      raise exception 'expected organic_master_client_id_ref_key, diagnosed %', diagnosed_constraint;
    end if;
  end;

  if (select count(*) from public.organic_master where ref = 'SHARED-REF') <> 2 then
    raise exception 'same ref was not preserved once per distinct client';
  end if;
  if (select count(*) from public.organic_master where client_id = 'c4000000-0000-0000-0000-000000000001') <> 2 then
    raise exception 'permitted non-conflicting rows were not preserved for client one';
  end if;
end
$$;

rollback;

\echo STAGE_A_CASE uniqueness.clients_slug_first_and_distinct_are_accepted PASS
\echo STAGE_A_CASE uniqueness.clients_slug_duplicate_is_rejected PASS
\echo STAGE_A_CASE uniqueness.organic_same_client_ref_duplicate_is_rejected PASS
\echo STAGE_A_CASE uniqueness.organic_same_ref_for_different_clients_is_accepted PASS
\echo STAGE_A_CASE uniqueness.organic_distinct_ref_for_same_client_is_accepted PASS
