-- Transactional RLS/client-isolation proof for a disposable local database.
-- Fixed synthetic UUIDs are rolled back; no fixture survives this test.

begin;

insert into auth.users
  (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-000000000001','authenticated','authenticated','stage-a-one@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-000000000002','authenticated','authenticated','stage-a-two@example.invalid','',now(),'{}','{}',now(),now());

insert into public.users (id,email,role) values
  ('a1000000-0000-0000-0000-000000000001','stage-a-one@example.invalid','client'),
  ('a1000000-0000-0000-0000-000000000002','stage-a-two@example.invalid','client');

insert into public.clients (id,name,slug) values
  ('b1000000-0000-0000-0000-000000000001','Stage A Client One','stage-a-client-one'),
  ('b1000000-0000-0000-0000-000000000002','Stage A Client Two','stage-a-client-two');

insert into public.client_users (user_id,client_id) values
  ('a1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000002');

insert into public.organic_master (client_id,month,ref,content_type) values
  ('b1000000-0000-0000-0000-000000000001','2026-08','ORG-TEST-ONE','RL'),
  ('b1000000-0000-0000-0000-000000000002','2026-08','ORG-TEST-TWO','RL');

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}',true);

do $$
declare
  actual integer;
  visible_client_ids uuid[];
  visible_refs text[];
begin
  if public.auth_role() <> 'client' then raise exception 'fixture client role was not resolved'; end if;
  select count(*), array_agg(id order by id) into actual, visible_client_ids from public.clients;
  if actual <> 1 or visible_client_ids <> array['b1000000-0000-0000-0000-000000000001'::uuid] then
    raise exception 'client one visible client ids were %, expected only its exact client id', visible_client_ids;
  end if;
  select count(*) into actual from public.clients where id='b1000000-0000-0000-0000-000000000002';
  if actual <> 0 then raise exception 'client one can see client two'; end if;
  select count(*), array_agg(ref order by ref) into actual, visible_refs from public.organic_master;
  if actual <> 1 or visible_refs <> array['ORG-TEST-ONE'::text] then
    raise exception 'client one visible organic refs were %, expected only ORG-TEST-ONE', visible_refs;
  end if;
  select count(*) into actual from public.organic_master where client_id='b1000000-0000-0000-0000-000000000002';
  if actual <> 0 then raise exception 'client one can see client two organic content'; end if;
end
$$;

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}',true);

do $$
declare
  actual integer;
  visible_client_ids uuid[];
  visible_refs text[];
begin
  if public.auth_role() <> 'client' then raise exception 'fixture client two role was not resolved'; end if;
  select count(*), array_agg(id order by id) into actual, visible_client_ids from public.clients;
  if actual <> 1 or visible_client_ids <> array['b1000000-0000-0000-0000-000000000002'::uuid] then
    raise exception 'client two visible client ids were %, expected only its exact client id', visible_client_ids;
  end if;
  select count(*) into actual from public.clients where id='b1000000-0000-0000-0000-000000000001';
  if actual <> 0 then raise exception 'client two can see client one'; end if;
  select count(*), array_agg(ref order by ref) into actual, visible_refs from public.organic_master;
  if actual <> 1 or visible_refs <> array['ORG-TEST-TWO'::text] then
    raise exception 'client two visible organic refs were %, expected only ORG-TEST-TWO', visible_refs;
  end if;
  select count(*) into actual from public.organic_master where client_id='b1000000-0000-0000-0000-000000000001';
  if actual <> 0 then raise exception 'client two can see client one organic content'; end if;
end
$$;

reset role;
rollback;

\echo STAGE_A_CASE isolation.client_one_sees_own_exact_record PASS
\echo STAGE_A_CASE isolation.client_one_cannot_see_client_two PASS
\echo STAGE_A_CASE isolation.client_two_sees_own_exact_record PASS
\echo STAGE_A_CASE isolation.client_two_cannot_see_client_one PASS
