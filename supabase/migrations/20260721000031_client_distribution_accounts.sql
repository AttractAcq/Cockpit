-- Client-level publishing destinations. Handles and external account IDs only;
-- credentials and access tokens intentionally do not belong in this table.
create table public.client_distribution_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  platform text not null default 'instagram',
  label text not null,
  handle text not null,
  external_account_id text not null,
  account_type text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  constraint client_distribution_accounts_platform_nonempty check (btrim(platform) <> ''),
  constraint client_distribution_accounts_label_nonempty check (btrim(label) <> ''),
  constraint client_distribution_accounts_handle_normalized check (handle = lower(btrim(handle)) and handle !~ '^@' and btrim(handle) <> ''),
  constraint client_distribution_accounts_external_id_nonempty check (btrim(external_account_id) <> '')
);

create unique index client_distribution_accounts_active_external_unique
  on public.client_distribution_accounts (client_id, platform, external_account_id) where is_active;
create unique index client_distribution_accounts_one_default
  on public.client_distribution_accounts (client_id, platform) where is_active and is_default;
create index client_distribution_accounts_client_idx on public.client_distribution_accounts (client_id);
create index client_distribution_accounts_platform_idx on public.client_distribution_accounts (platform);
create index client_distribution_accounts_active_idx on public.client_distribution_accounts (client_id, platform, is_active);

create trigger client_distribution_accounts_updated_at
  before update on public.client_distribution_accounts
  for each row execute function public.set_updated_at();

alter table public.client_distribution_accounts enable row level security;
revoke all on public.client_distribution_accounts from anon;
grant select, insert, update on public.client_distribution_accounts to authenticated;

create policy client_distribution_accounts_staff_select on public.client_distribution_accounts
  for select to authenticated using (public.auth_role() in ('admin','account_manager','editor'));
create policy client_distribution_accounts_staff_insert on public.client_distribution_accounts
  for insert to authenticated with check (public.auth_role() in ('admin','account_manager','editor'));
create policy client_distribution_accounts_staff_update on public.client_distribution_accounts
  for update to authenticated using (public.auth_role() in ('admin','account_manager','editor'))
  with check (public.auth_role() in ('admin','account_manager','editor'));

-- Safely discover only complete destination/ID pairs. Existing distribution
-- rows are read, never updated. The NOT EXISTS guard makes the backfill idempotent.
with candidates as (
  select distinct
    d.client_id,
    regexp_replace(lower(btrim(d.destination)), '[^a-z0-9._]', '', 'g') as handle,
    lower(coalesce(nullif(btrim(d.platform), ''), 'instagram')) as platform,
    btrim(d.publish_settings #>> '{meta,ig_user_id}') as external_account_id
  from public.client_distribution_records d
  where nullif(btrim(d.destination), '') is not null
    and nullif(btrim(d.publish_settings #>> '{meta,ig_user_id}'), '') is not null
), ranked as (
  select c.*, count(*) over (partition by c.client_id, c.platform) as account_count
  from candidates c
)
insert into public.client_distribution_accounts
  (client_id, platform, label, handle, external_account_id, is_default, is_active)
select r.client_id, r.platform, '@' || r.handle || ' — ' || r.external_account_id,
       r.handle, r.external_account_id, r.account_count = 1, true
from ranked r
where r.handle <> '' and r.external_account_id <> ''
  and not exists (
    select 1 from public.client_distribution_accounts a
    where a.client_id = r.client_id and a.platform = r.platform
      and a.external_account_id = r.external_account_id
  );
