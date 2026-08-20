-- Stage 2, Phase 02 — Business Selector.
--
-- Purely additive, per Phase 00's Open Decision 1: a new `businesses` table,
-- not a repurpose of `clients`. AA's business row links to its existing
-- internal `clients` row (seeded since the very first migration,
-- is_internal_client = true) via a nullable FK -- a future business with no
-- AA-agency-service relationship simply has that FK null. Nothing existing
-- is touched: no column added to `clients`, no existing RLS policy changed,
-- no existing route or component modified by this migration.

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  client_id uuid references public.clients(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint businesses_name_check check (length(trim(name)) > 0),
  constraint businesses_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create index businesses_client_idx on public.businesses (client_id) where client_id is not null;

drop trigger if exists businesses_updated_at on public.businesses;
create trigger businesses_updated_at before update on public.businesses
  for each row execute function public.set_updated_at();

alter table public.businesses enable row level security;
revoke all on public.businesses from public, anon, authenticated;
grant select on public.businesses to authenticated;
grant all on public.businesses to service_role;

-- Staff-only read (every non-client role), matching client_onboarding_templates'
-- own precedent for cross-business content -- there is no "client portal"
-- concept of a business yet, and none is being invented here.
create policy businesses_select on public.businesses
  for select to authenticated using (coalesce(public.auth_role(), '') <> 'client');

comment on table public.businesses is 'Stage 2 Phase 02: the additive Business Object. Optionally linked to an existing clients row via client_id (nullable) -- AA links to its own internal client row; a business with no agency-service-delivery relationship has client_id null. Deliberately thin: no Sales/Finance/Team ownership columns yet -- those are designed against Business Instance #2''s real friction in later phases, not guessed at here (Stage 2 build plan, Principle 01).';

create or replace function public.create_business(p_name text, p_slug text, p_client_id uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') <> 'admin' then raise exception 'AUTH: admin role required'; end if;
  if length(trim(coalesce(p_name,''))) = 0 then raise exception 'VALIDATION: name is required'; end if;
  if length(trim(coalesce(p_slug,''))) = 0 then raise exception 'VALIDATION: slug is required'; end if;
  if p_client_id is not null and not exists (select 1 from public.clients where id = p_client_id) then
    raise exception 'NOT_FOUND: client';
  end if;

  insert into public.businesses (name, slug, client_id, created_by)
  values (trim(p_name), trim(p_slug), p_client_id, auth.uid())
  returning id into v_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (p_client_id, auth.uid(), 'business_created', 'Business "' || trim(p_name) || '" created.', 'business', v_id, jsonb_build_object('slug', trim(p_slug)));

  return v_id;
end; $$;

revoke all on function public.create_business(text, text, uuid) from public, anon;
grant execute on function public.create_business(text, text, uuid) to authenticated, service_role;

comment on function public.create_business(text, text, uuid) is 'Admin-only. Creates a Business Object row, optionally linked to an existing clients row.';

-- Seed: AA becomes business row #1, linked to its existing internal clients row.
insert into public.businesses (name, slug, client_id)
select 'Attract Acquisition', 'attract-acquisition', c.id
from public.clients c
where c.slug = 'attract-acquisition'
on conflict (slug) do nothing;
