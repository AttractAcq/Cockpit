-- Programme Stage K — Organic Distribution Consolidation.
--
-- Additive only. Preserves the entire existing distribution machinery
-- (client_distribution_accounts, client_distribution_records' scheduling/
-- retry/reconciliation columns, the reconcile_distribution_record RPC, the
-- Reels async-container state machine) untouched. Adds:
--   1. Canonical linkage columns on client_distribution_records so a
--      record can reference the Stage H/I canonical Content Item, Content
--      Brief and Content Item Asset, alongside the existing legacy
--      asset_group_ref/production_brief_id/video_deliverable_id linkage
--      (which stays exactly as-is for the live legacy pipeline).
--   2. client_distribution_policies — per-client approval policy
--      (internal-only vs client-approval-required, auto-schedule,
--      manual-publish-only, blackout periods, restricted weekdays).

-- ---------------------------------------------------------------------------
-- Canonical linkage on client_distribution_records
-- ---------------------------------------------------------------------------

alter table public.client_distribution_records
  add column if not exists content_item_id uuid references public.content_items(id) on delete set null,
  add column if not exists content_item_asset_id uuid references public.content_item_assets(id) on delete set null,
  add column if not exists content_brief_id uuid references public.content_briefs(id) on delete set null,
  add column if not exists caption_version integer,
  add column if not exists campaign_reference text,
  add column if not exists client_approved_by uuid references public.users(id) on delete set null,
  add column if not exists client_approved_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_distribution_records_caption_version_check') then
    alter table public.client_distribution_records
      add constraint client_distribution_records_caption_version_check
        check (caption_version is null or caption_version >= 1);
  end if;
end $$;

-- Backbone scope: at most one canonical distribution record per Content
-- Item (multi-platform fan-out from one Content Item is deferred -- see the
-- Stage K status report). Legacy records (content_item_id null) are
-- unaffected by this partial index.
create unique index if not exists client_distribution_records_content_item_unique
  on public.client_distribution_records (content_item_id)
  where content_item_id is not null;

create index if not exists client_distribution_records_content_item_asset_idx
  on public.client_distribution_records (content_item_asset_id)
  where content_item_asset_id is not null;

-- ---------------------------------------------------------------------------
-- client_distribution_policies — per-client approval policy.
-- ---------------------------------------------------------------------------

create table if not exists public.client_distribution_policies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  approval_mode text not null default 'internal_only',
  auto_schedule_after_approval boolean not null default false,
  manual_publish_only boolean not null default false,
  blackout_periods jsonb not null default '[]'::jsonb,
  restricted_weekdays jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  constraint client_distribution_policies_client_unique unique (client_id),
  constraint client_distribution_policies_approval_mode_check
    check (approval_mode in ('internal_only', 'client_approval_required')),
  constraint client_distribution_policies_blackout_periods_check
    check (jsonb_typeof(blackout_periods) = 'array'),
  constraint client_distribution_policies_restricted_weekdays_check
    check (jsonb_typeof(restricted_weekdays) = 'array')
);

drop trigger if exists client_distribution_policies_updated_at on public.client_distribution_policies;
create trigger client_distribution_policies_updated_at before update on public.client_distribution_policies
  for each row execute function public.set_updated_at();

alter table public.client_distribution_policies enable row level security;
revoke all on public.client_distribution_policies from public, anon, authenticated;
grant select on public.client_distribution_policies to authenticated;
grant all on public.client_distribution_policies to service_role;
drop policy if exists client_distribution_policies_select on public.client_distribution_policies;
create policy client_distribution_policies_select on public.client_distribution_policies
  for select to authenticated using (client_id = any(public.auth_client_ids()));
