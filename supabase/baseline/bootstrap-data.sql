-- Stage A Route B bootstrap data and Supabase-managed configuration.
--
-- This file is only executed by scripts/bootstrap-disposable-supabase.sh after
-- that script has proved it is connected to the named local Docker database.
-- It contains no credentials, production URLs, client rows, or production data.

set row_security = off;

do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception 'Supabase Storage schemas are required before bootstrap';
  end if;
end
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('client-assets', 'client-assets', false, 20971520,
    array['image/png','image/jpeg','image/webp']),
  ('video-assets', 'video-assets', false, 209715200,
    array['video/mp4','video/quicktime','video/webm','image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists client_assets_storage_staff_select on storage.objects;
create policy client_assets_storage_staff_select on storage.objects
  for select to authenticated
  using (bucket_id = 'client-assets' and public.auth_role() in ('admin','account_manager','editor'));

drop policy if exists client_assets_storage_staff_insert on storage.objects;
create policy client_assets_storage_staff_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'client-assets' and public.auth_role() in ('admin','account_manager','editor'));

drop policy if exists client_assets_storage_staff_update on storage.objects;
create policy client_assets_storage_staff_update on storage.objects
  for update to authenticated
  using (bucket_id = 'client-assets' and public.auth_role() in ('admin','account_manager','editor'))
  with check (bucket_id = 'client-assets' and public.auth_role() in ('admin','account_manager','editor'));

drop policy if exists client_assets_storage_staff_delete on storage.objects;
create policy client_assets_storage_staff_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'client-assets' and public.auth_role() in ('admin','account_manager','editor'));

drop policy if exists video_assets_storage_staff_select on storage.objects;
create policy video_assets_storage_staff_select on storage.objects
  for select to authenticated
  using (bucket_id = 'video-assets' and public.auth_role() in ('admin','account_manager','editor'));

drop policy if exists video_assets_storage_staff_insert on storage.objects;
create policy video_assets_storage_staff_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'video-assets' and public.auth_role() in ('admin','account_manager','editor'));

drop policy if exists video_assets_storage_staff_update on storage.objects;
create policy video_assets_storage_staff_update on storage.objects
  for update to authenticated
  using (bucket_id = 'video-assets' and public.auth_role() in ('admin','account_manager','editor'))
  with check (bucket_id = 'video-assets' and public.auth_role() in ('admin','account_manager','editor'));

drop policy if exists video_assets_storage_staff_delete on storage.objects;
create policy video_assets_storage_staff_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'video-assets' and public.auth_role() in ('admin','account_manager','editor'));

-- These are the only repository-proven application seed rows omitted by the
-- schema-only production snapshot. They originate in migration 20260722203942.
insert into public.brand_prompt_blocks
  (block_type, version, name, grade_block, lens_block, mood_block, motion_block, negative_block, is_active)
values (
  'brand_dna', 1, 'AA Reel Studio Brand DNA v1',
  'Near-black background #0A0E0D, desaturated, single teal accent light #00E5C3.',
  '35mm feel, shallow depth of field.',
  'Dusk / overcast Cape Town light, premium, restrained. World: South African trade context -- job sites, bakkies, tools, pool renovations, roofing, workshops.',
  'Cinematic motion: slow dolly, push-in, crane, tracking -- deliberate, unhurried camera moves only.',
  'No faces, no readable fake signage or logos, no fake client branding, no text baked into footage.',
  true
)
on conflict (block_type, version) do nothing;

insert into public.brand_prompt_blocks
  (block_type, version, name, prompt_block, is_active)
values (
  'brand_sting', 1, 'AA Reel Studio Brand Sting v1',
  'Closing brand sting, 2-3 seconds: same camera move and teal light hit (#00E5C3) as the AA Reel Studio Brand DNA v1 grade, near-black background (#0A0E0D), no faces, no readable text or logos.',
  true
)
on conflict (block_type, version) do nothing;
