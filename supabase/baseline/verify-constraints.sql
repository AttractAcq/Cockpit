-- Representative behavioral constraint evidence for the rebuilt Route B schema.
-- Every fixture is synthetic and the complete scenario is rolled back.

begin;

insert into public.clients (id, name, slug, health_score)
values ('c2000000-0000-0000-0000-000000000001', 'Constraint Control', 'stage-a-constraint-control', 100);

do $$
declare
  diagnosed_column text;
  diagnosed_constraint text;
begin
  begin
    insert into public.clients (id, name, slug)
    values ('c2000000-0000-0000-0000-000000000002', null, 'stage-a-null-name');
    raise exception 'clients.name NOT NULL accepted an invalid write';
  exception when not_null_violation then
    get stacked diagnostics diagnosed_column = column_name;
    if diagnosed_column <> 'name' then
      raise exception 'expected clients.name NOT NULL violation, diagnosed column %', diagnosed_column;
    end if;
  end;

  begin
    insert into public.clients (id, name, slug, health_score)
    values ('c2000000-0000-0000-0000-000000000003', 'Invalid Health', 'stage-a-invalid-health', 101);
    raise exception 'clients_health_score_check accepted 101';
  exception when check_violation then
    get stacked diagnostics diagnosed_constraint = constraint_name;
    if diagnosed_constraint <> 'clients_health_score_check' then
      raise exception 'expected clients_health_score_check, diagnosed %', diagnosed_constraint;
    end if;
  end;

  begin
    insert into public.organic_master (client_id, month, ref, content_type)
    values ('c2000000-0000-0000-0000-000000000001', '2026-08', 'CONSTRAINT-BAD-TYPE', 'VIDEO');
    raise exception 'organic_master_content_type_check accepted VIDEO';
  exception when check_violation then
    get stacked diagnostics diagnosed_constraint = constraint_name;
    if diagnosed_constraint <> 'organic_master_content_type_check' then
      raise exception 'expected organic_master_content_type_check, diagnosed %', diagnosed_constraint;
    end if;
  end;

  begin
    insert into public.clients (id, name, slug, status)
    values ('c2000000-0000-0000-0000-000000000004', 'Invalid State', 'stage-a-invalid-state', 'not_a_client_state');
    raise exception 'client_status domain accepted an invalid state';
  exception when invalid_text_representation then
    if sqlerrm not like '%client_status%' and sqlerrm not like '%not_a_client_state%' then
      raise;
    end if;
  end;

  if (select count(*) from public.clients where id = 'c2000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'valid constraint control row is missing';
  end if;
end
$$;

rollback;

\echo STAGE_A_CASE constraints.clients_name_not_null_rejects_null PASS
\echo STAGE_A_CASE constraints.clients_health_score_check_rejects_101 PASS
\echo STAGE_A_CASE constraints.organic_content_type_check_rejects_video PASS
\echo STAGE_A_CASE constraints.client_status_domain_rejects_unknown_state PASS
\echo STAGE_A_CASE constraints.valid_control_row_is_accepted PASS
