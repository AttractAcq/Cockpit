-- Dedicated application storage configuration gate.
do $$
declare actual integer;
begin
  select count(*) into actual from storage.buckets
  where id in ('client-assets','video-assets') and public = false;
  if actual <> 2 then raise exception 'expected two private application storage buckets, found %', actual; end if;
  select count(*) into actual from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname in (
      'client_assets_storage_staff_select','client_assets_storage_staff_insert',
      'client_assets_storage_staff_update','client_assets_storage_staff_delete',
      'video_assets_storage_staff_select','video_assets_storage_staff_insert',
      'video_assets_storage_staff_update','video_assets_storage_staff_delete'
    );
  if actual <> 8 then raise exception 'expected eight application storage policies, found %', actual; end if;
end
$$;
\echo STAGE_A_CASE storage.two_private_buckets_and_eight_policies_exist PASS
