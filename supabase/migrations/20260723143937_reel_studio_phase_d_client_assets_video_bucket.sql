-- Reel Studio Phase D (2026-07-23), applied live on xivewedajschthjlblfb but never
-- captured in this repo. Reconstructed on 2026-07-27 from the ACTUAL deployed
-- constraint definition (pg_get_constraintdef):
--
--   client_assets_storage_bucket_check
--   CHECK ((storage_bucket = ANY (ARRAY['client-assets'::text, 'video-assets'::text])))
--
-- Reason it exists: the original constraint hardcoded 'client-assets' only, so a
-- Reel Studio clip (which lives in the private video-assets bucket) could not be
-- referenced by a client_assets row.
--
-- Idempotent; matches the deployed state exactly.

alter table public.client_assets drop constraint if exists client_assets_storage_bucket_check;
alter table public.client_assets add constraint client_assets_storage_bucket_check
  check (storage_bucket = any (array['client-assets'::text, 'video-assets'::text]));
