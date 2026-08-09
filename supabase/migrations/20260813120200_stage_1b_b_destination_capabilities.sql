-- Programme Stage 1B-B — per-destination capability/permission state.
--
-- One row per client_distribution_accounts destination, upserted atomically
-- on every verification pass (never partially updated field-by-field, so a
-- failed refresh cannot leave stale "granted" scopes next to fresh "missing"
-- ones). client_id is denormalized from the parent destination row -- the
-- same convention used throughout this programme (e.g.
-- client_iteration_candidates, client_exception_queue) so RLS can scope
-- directly without a join, and so this row survives being queried
-- independently of its parent.

create table public.client_distribution_account_capabilities (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  distribution_account_id uuid not null unique references public.client_distribution_accounts(id) on delete cascade,
  granted_scopes jsonb not null default '[]'::jsonb,
  missing_scopes jsonb not null default '[]'::jsonb,
  supported_capabilities jsonb not null default '[]'::jsonb,
  verification_status text not null default 'never_checked'
    check (verification_status in ('verified', 'missing_permissions', 'token_invalid', 'error', 'never_checked')),
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_distribution_account_capabilities_scopes_arrays
    check (jsonb_typeof(granted_scopes) = 'array' and jsonb_typeof(missing_scopes) = 'array' and jsonb_typeof(supported_capabilities) = 'array')
);

create index client_distribution_account_capabilities_client_idx
  on public.client_distribution_account_capabilities (client_id);

alter table public.client_distribution_account_capabilities enable row level security;

-- Same corrected pattern as this stage's client_distribution_accounts fix:
-- role AND client scoping together, from day one.
create policy client_distribution_account_capabilities_staff_select
  on public.client_distribution_account_capabilities for select
  using (auth_role() = any (array['admin','account_manager','editor']) and client_id = any (auth_client_ids()));

create policy client_distribution_account_capabilities_staff_insert
  on public.client_distribution_account_capabilities for insert
  with check (auth_role() = any (array['admin','account_manager','editor']) and client_id = any (auth_client_ids()));

create policy client_distribution_account_capabilities_staff_update
  on public.client_distribution_account_capabilities for update
  using (auth_role() = any (array['admin','account_manager','editor']) and client_id = any (auth_client_ids()))
  with check (auth_role() = any (array['admin','account_manager','editor']) and client_id = any (auth_client_ids()));

create trigger client_distribution_account_capabilities_set_updated_at
  before update on public.client_distribution_account_capabilities
  for each row execute function public.set_updated_at();
