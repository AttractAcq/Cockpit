-- Representative behavioral foreign-key evidence for the rebuilt Route B schema.
-- Covers acceptance, rejection, ON DELETE CASCADE, and default ON UPDATE NO ACTION.

begin;

insert into public.clients (id, name, slug) values
  ('c3000000-0000-0000-0000-000000000001', 'FK Parent One', 'stage-a-fk-parent-one'),
  ('c3000000-0000-0000-0000-000000000002', 'FK Parent Two', 'stage-a-fk-parent-two');

insert into public.organic_master (id, client_id, month, ref, content_type) values
  ('d3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', '2026-08', 'FK-VALID-ONE', 'RL'),
  ('d3000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000002', '2026-08', 'FK-VALID-TWO', 'FP');

do $$
declare
  diagnosed_constraint text;
begin
  if (select count(*) from public.organic_master where id = 'd3000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'valid organic_master parent reference was not accepted';
  end if;

  begin
    insert into public.organic_master (client_id, month, ref, content_type)
    values ('c3000000-0000-0000-0000-000000000099', '2026-08', 'FK-MISSING', 'RL');
    raise exception 'nonexistent organic_master parent was accepted';
  exception when foreign_key_violation then
    get stacked diagnostics diagnosed_constraint = constraint_name;
    if diagnosed_constraint <> 'organic_master_client_id_fkey' then
      raise exception 'expected organic_master_client_id_fkey, diagnosed %', diagnosed_constraint;
    end if;
  end;

  delete from public.clients where id = 'c3000000-0000-0000-0000-000000000001';
  if exists (select 1 from public.organic_master where id = 'd3000000-0000-0000-0000-000000000001') then
    raise exception 'organic_master child survived its recorded ON DELETE CASCADE';
  end if;

  begin
    update public.clients
    set id = 'c3000000-0000-0000-0000-000000000003'
    where id = 'c3000000-0000-0000-0000-000000000002';
    raise exception 'parent key update bypassed the recorded ON UPDATE NO ACTION';
  exception when foreign_key_violation then
    get stacked diagnostics diagnosed_constraint = constraint_name;
    if diagnosed_constraint <> 'organic_master_client_id_fkey' then
      raise exception 'expected update rejection from organic_master_client_id_fkey, diagnosed %', diagnosed_constraint;
    end if;
  end;

  if not exists (
    select 1 from public.organic_master
    where id = 'd3000000-0000-0000-0000-000000000002'
      and client_id = 'c3000000-0000-0000-0000-000000000002'
  ) then
    raise exception 'failed parent update did not preserve the valid child relationship';
  end if;
end
$$;

rollback;

\echo STAGE_A_CASE foreign_keys.organic_valid_client_parent_is_accepted PASS
\echo STAGE_A_CASE foreign_keys.organic_nonexistent_client_is_rejected PASS
\echo STAGE_A_CASE foreign_keys.organic_client_delete_cascades PASS
\echo STAGE_A_CASE foreign_keys.organic_client_update_no_action_rejects PASS
