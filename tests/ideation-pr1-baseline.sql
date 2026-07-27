-- SYNTHETIC MINIMAL UNIT FIXTURE for the unexecuted Ideation migration.
-- It is useful for isolated SQL behavior tests, but it is not an exact schema
-- dump and is not proof of deployed-schema migration compatibility.
-- This is not an application migration and must never be applied to linked Supabase.

create extension if not exists pgcrypto;
create schema if not exists auth;
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end
$$;

create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  package_tier text not null default 'proof_sprint',
  stage1_status text not null default 'complete',
  stage2_status text not null default 'complete'
);

create table public.client_context_files (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  file_number integer not null,
  file_name text not null,
  content_md text not null,
  status text not null default 'approved',
  version integer not null default 1,
  unique (client_id, file_number)
);

create table public.client_execution_files (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  month text not null,
  file_number integer not null,
  file_name text not null,
  content_md text not null,
  review_state text not null default 'approved',
  version integer not null default 1,
  unique (client_id, month, file_number)
);

create table public.team_members (
  user_id uuid not null references public.users(id),
  client_id uuid not null references public.clients(id),
  primary key (user_id, client_id)
);

create table public.client_users (
  user_id uuid not null references public.users(id),
  client_id uuid not null references public.clients(id),
  primary key (user_id, client_id)
);

create or replace function public.auth_role() returns text
language sql stable security definer set search_path = public
as $$
  select role from public.users where id = auth.uid()
$$;

create or replace function public.auth_client_ids() returns uuid[]
language plpgsql stable security definer set search_path = public
as $$
declare v_role text;
begin
  v_role := public.auth_role();
  return case v_role
    when 'admin' then array(select id from public.clients)
    when 'account_manager' then array(select client_id from public.team_members where user_id = auth.uid())
    when 'client' then array(select client_id from public.client_users where user_id = auth.uid())
    else array[]::uuid[]
  end;
end
$$;

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  actor_id uuid references public.users(id) on delete set null,
  event_type text not null,
  plain_english_message text not null,
  object_type text,
  object_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant all on public.activity_log to service_role;
