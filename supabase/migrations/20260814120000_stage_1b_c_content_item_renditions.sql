-- Programme Stage 1B-C — Facebook Renditions and Platform-Specific Planning.
--
-- One canonical Content Item can now produce independent, platform-specific
-- Renditions without mutating the canonical Brief (content_briefs) or any
-- other platform's Rendition. The Brief stays the single source of creative
-- strategy (objective, audience, core_idea, hook, proof, narrative,
-- approval_rules) -- a Rendition captures the platform-specific REALISATION
-- of that brief: actual copy/CTA text, format, chosen media, scheduling
-- guidance, and its own independent approval lifecycle.
--
-- Lifecycle deliberately mirrors content_briefs' own 4-state model
-- (draft/in_review/approved/superseded) rather than inventing new names --
-- review-content-brief/index.ts's own comment already establishes this
-- convention ("Stage H's differently-worded lifecycle collapses onto it
-- rather than replacing it"). Versioning mirrors content_briefs'
-- brief_version + status='superseded' pattern (not content_item_assets'
-- is_current/revision_of pattern) since a Rendition's creative-review
-- lifecycle is much closer to a Brief's than to a generated asset's.
--
-- `format` reuses the RenditionContentType vocabulary already defined in
-- _shared/distribution-platform-contract.ts (Stage 1B-A) -- the canonical
-- domain contract that stage deliberately defined ahead of any real
-- implementation. This is the first real use of it.
--
-- `platform` allows 'instagram' as well as 'facebook' for forward
-- consistency with client_distribution_accounts (Stage 1B-B), but Instagram
-- publishing continues to work directly off content_items/
-- client_distribution_records without ever needing a Rendition row --
-- nothing in this migration or its callers requires one.

create table public.content_item_renditions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook')),
  rendition_version integer not null default 1 check (rendition_version >= 1),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'superseded')),
  format text not null check (format in ('IMAGE', 'CAROUSEL', 'STORIES', 'REELS', 'VIDEO', 'TEXT_LINK')),
  copy text not null default '',
  cta text not null default '',
  -- Array of content_item_asset_id values this rendition uses. An asset id
  -- that also appears in another rendition (or would be the canonical
  -- default) is a SHARED asset; one that appears only here is
  -- platform-specific -- expressed structurally by which rows reference it,
  -- not by a redundant boolean that could drift out of sync.
  media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array'),
  scheduling_guidance jsonb not null default '{}'::jsonb check (jsonb_typeof(scheduling_guidance) = 'object'),
  -- Snapshot of the last capability validation (see facebook-rendition-contract.ts),
  -- so an operator can see WHY a rendition is or isn't publication-ready
  -- without re-running the check.
  capability_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(capability_snapshot) = 'object'),
  change_request_notes text,
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_item_renditions_approval_check
    check ((status = 'approved') = (approved_by is not null and approved_at is not null))
);

-- At most one non-superseded Rendition per (Content Item, platform) --
-- creating a new version must first supersede the previous one, exactly
-- like content_briefs' own versioning discipline.
create unique index content_item_renditions_active_platform_idx
  on public.content_item_renditions (content_item_id, platform)
  where status <> 'superseded';

create index content_item_renditions_client_idx on public.content_item_renditions (client_id);
create index content_item_renditions_content_item_idx on public.content_item_renditions (content_item_id);

alter table public.content_item_renditions enable row level security;

-- Matches the exact pattern already live on content_items/content_briefs/
-- content_item_assets: SELECT scoped by client_id = ANY(auth_client_ids()),
-- no direct authenticated INSERT/UPDATE policy -- writes go through
-- SECURITY DEFINER RPCs / service-role Edge Functions only.
create policy content_item_renditions_select
  on public.content_item_renditions for select
  using (client_id = any (auth_client_ids()));

create trigger content_item_renditions_set_updated_at
  before update on public.content_item_renditions
  for each row execute function public.set_updated_at();
