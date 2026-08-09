-- Programme Stage 1B-B — Facebook Page Destinations and Authorisation.
--
-- Extends the existing, already-real, already-live client_distribution_accounts
-- table (verified Stage 1B-A: no schema change was needed to hold a
-- 'facebook' platform value) with the columns real destination onboarding
-- needs: a credential reference (never a raw token), connection health, and
-- provider-specific metadata. Additive only -- no existing column is
-- changed, and the single real live row (the one active Instagram
-- destination) is backfilled to a connection_status consistent with its
-- existing is_active flag, never silently reset.
--
-- credential_reference stores a Vault credential NAME (e.g.
-- "ACME_META_SYSTEM_USER_TOKEN", built by the existing vaultName() helper in
-- _shared/aa.ts), never a token value -- satisfies "store token references
-- and permission metadata without committing secrets" literally. Nullable:
-- when null, the resolver falls back to the same default Meta system-user
-- credential Instagram already uses for this client, since Facebook Page
-- publishing and Instagram publishing share the same Meta identity (a
-- System User granted access to both the IG account and the Page in
-- Business Manager) -- documented, not yet live-confirmed, per Stage 1B-A's
-- security model doc.

alter table public.client_distribution_accounts
  add column credential_reference text,
  add column connection_status text not null default 'disconnected',
  add column last_verified_at timestamptz,
  add column external_metadata jsonb not null default '{}'::jsonb;

alter table public.client_distribution_accounts
  add constraint client_distribution_accounts_connection_status_check
    check (connection_status in ('connected', 'needs_reauth', 'disconnected', 'error'));

-- Destination-level platform constraint. Distinct from (and does not touch)
-- publish-capability.ts's SUPPORTED_PUBLISH_PLATFORMS, which still gates
-- actual publishing to instagram only -- this constraint only governs which
-- platforms can be onboarded as a destination, which is exactly this
-- stage's job for facebook.
alter table public.client_distribution_accounts
  add constraint client_distribution_accounts_platform_known
    check (platform in ('instagram', 'facebook'));

-- Backfill: the one real live row is an active Instagram destination that
-- has been publishing successfully throughout the whole A-P programme --
-- reflect that real history honestly rather than defaulting it to
-- 'disconnected' alongside brand-new rows.
update public.client_distribution_accounts
set connection_status = case when is_active then 'connected' else 'disconnected' end;

comment on column public.client_distribution_accounts.credential_reference is
  'Vault credential NAME this destination resolves its Meta token through (see vaultName() in _shared/aa.ts). Never a token value. Null = use the client''s default Meta system-user credential.';
comment on column public.client_distribution_accounts.connection_status is
  'connected: last verification succeeded. needs_reauth: token expired/revoked, operator action required. disconnected: never connected or intentionally deactivated. error: verification failed for a reason other than auth (e.g. Page removed).';
comment on column public.client_distribution_accounts.external_metadata is
  'Provider-reported destination metadata (e.g. Facebook Page name/category from Graph API discovery). Never a credential.';
