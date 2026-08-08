-- Programme Stage I — Shared Production Studio Framework.
--
-- Additive only. production_jobs (Stage B) already has almost the entire
-- "Production Job" shared entity this stage asks for — idempotency
-- (client_id, idempotency_key) unique constraint, leases, retries,
-- cost_metadata — with zero callers anywhere in src/. This migration adds
-- the two fields it's missing (production_mode, asset_plan) and two new
-- tables for the remaining shared entities this stage lists: Generated
-- Asset / Source Asset / Deliverable (one table, differentiated by `kind`
-- rather than three near-identical tables) and Review (with Scene/Slide/
-- Frame and Asset Requirement represented inside asset_plan/cost_metadata
-- jsonb rather than as separate tables — see the Stage I implementation
-- report for the reasoning).
--
-- Deliberately does not touch client_asset_generation_jobs/_items or
-- client_assets — the live legacy production system every existing studio
-- (Carousel, Story, Feed Post, Ad, and Reel Studio's own dedicated schema)
-- actually runs on today. This builds the new canonical path in parallel,
-- per the same "preserve working systems" principle Stage H followed for
-- client_production_briefs.

-- ---------------------------------------------------------------------------
-- production_jobs: production_mode + asset_plan
-- ---------------------------------------------------------------------------

alter table public.production_jobs
  add column if not exists production_mode text,
  add column if not exists asset_plan jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'production_jobs_production_mode_check') then
    alter table public.production_jobs
      add constraint production_jobs_production_mode_check
        check (production_mode is null or production_mode in ('human', 'ai', 'hybrid'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'production_jobs_asset_plan_check') then
    alter table public.production_jobs
      add constraint production_jobs_asset_plan_check
        check (jsonb_typeof(asset_plan) = 'array');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- content_item_assets — Generated Asset / Source Asset / Deliverable,
-- differentiated by `kind`. Revision is modelled as a new row with
-- revision_of pointing at what it revises, mirroring client_assets'
-- version/is_current pattern.
-- ---------------------------------------------------------------------------

create table if not exists public.content_item_assets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  production_job_id uuid not null references public.production_jobs(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  kind text not null,
  asset_category text,
  storage_bucket text,
  storage_path text,
  mime_type text,
  width integer,
  height integer,
  provider text,
  model text,
  prompt_digest text,
  version integer not null default 1,
  is_current boolean not null default true,
  revision_of uuid references public.content_item_assets(id) on delete set null,
  generated_media_disclosed boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_item_assets_kind_check
    check (kind in ('generated', 'source', 'deliverable')),
  constraint content_item_assets_version_check
    check (version >= 1),
  constraint content_item_assets_digest_check
    check (prompt_digest is null or prompt_digest ~ '^[0-9a-f]{64}$'),
  constraint content_item_assets_not_self_revision_check
    check (revision_of is null or revision_of <> id)
);

create index if not exists content_item_assets_content_item_idx
  on public.content_item_assets (content_item_id);
create index if not exists content_item_assets_job_idx
  on public.content_item_assets (production_job_id);
create index if not exists content_item_assets_current_idx
  on public.content_item_assets (content_item_id, kind)
  where is_current = true;

drop trigger if exists content_item_assets_updated_at on public.content_item_assets;
create trigger content_item_assets_updated_at before update on public.content_item_assets
  for each row execute function public.set_updated_at();

alter table public.content_item_assets enable row level security;
revoke all on public.content_item_assets from public, anon, authenticated;
grant select on public.content_item_assets to authenticated;
grant all on public.content_item_assets to service_role;
drop policy if exists content_item_assets_select on public.content_item_assets;
create policy content_item_assets_select on public.content_item_assets
  for select to authenticated using (client_id = any(public.auth_client_ids()));

-- ---------------------------------------------------------------------------
-- production_reviews — the shared Review entity. Targets a job as a whole,
-- or one specific asset within it.
-- ---------------------------------------------------------------------------

create table if not exists public.production_reviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  production_job_id uuid not null references public.production_jobs(id) on delete cascade,
  content_item_asset_id uuid references public.content_item_assets(id) on delete set null,
  reviewer_id uuid references public.users(id) on delete set null,
  decision text not null,
  notes text,
  quality_checks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint production_reviews_decision_check
    check (decision in ('approved', 'changes_requested', 'rejected')),
  constraint production_reviews_checks_check
    check (jsonb_typeof(quality_checks) = 'array')
);

create index if not exists production_reviews_job_idx
  on public.production_reviews (production_job_id);

alter table public.production_reviews enable row level security;
revoke all on public.production_reviews from public, anon, authenticated;
grant select on public.production_reviews to authenticated;
grant all on public.production_reviews to service_role;
drop policy if exists production_reviews_select on public.production_reviews;
create policy production_reviews_select on public.production_reviews
  for select to authenticated using (client_id = any(public.auth_client_ids()));
