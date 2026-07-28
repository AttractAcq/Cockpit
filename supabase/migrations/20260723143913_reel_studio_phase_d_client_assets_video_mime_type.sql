-- Reel Studio Phase D (2026-07-23), applied live on xivewedajschthjlblfb but never
-- captured in this repo. Reconstructed on 2026-07-27 from the ACTUAL deployed
-- constraint definition (pg_get_constraintdef):
--
--   client_assets_mime_type_check
--   CHECK ((mime_type = ANY (ARRAY['image/png'::text, 'image/jpeg'::text,
--           'image/webp'::text, 'video/mp4'::text])))
--
-- Reason it exists: the original constraint only anticipated the synchronous
-- AI-image pipeline and rejected any video row.
--
-- Idempotent; matches the deployed state exactly.

alter table public.client_assets drop constraint if exists client_assets_mime_type_check;
alter table public.client_assets add constraint client_assets_mime_type_check
  check (mime_type = any (array['image/png'::text, 'image/jpeg'::text, 'image/webp'::text, 'video/mp4'::text]));
