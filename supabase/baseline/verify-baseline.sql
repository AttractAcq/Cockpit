-- Deterministic catalogue assertions for the Route B current-state baseline.
-- Executed only against the guarded local disposable database.

do $$
declare
  actual integer;
begin
  select count(*) into actual from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r';
  if actual <> 80 then raise exception 'expected 80 public tables, found %', actual; end if;

  select count(*) into actual from pg_type t join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' and t.typtype='e';
  if actual <> 17 then raise exception 'expected 17 public enums, found %', actual; end if;

  select count(*) into actual from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public';
  if actual <> 86 then raise exception 'expected 86 public function signatures, found %', actual; end if;

  select count(*) into actual from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='v';
  if actual <> 1 then raise exception 'expected one public view, found %', actual; end if;

  select count(*) into actual from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('m','S');
  if actual <> 0 then raise exception 'unexpected public materialized view or sequence count: %', actual; end if;

  select count(*) into actual from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal;
  if actual <> 38 then raise exception 'expected 38 public triggers, found %', actual; end if;

  select count(*) into actual from pg_indexes where schemaname='public';
  if actual <> 318 then raise exception 'expected 318 public indexes including constraint indexes, found %', actual; end if;

  select count(*) into actual from pg_policies where schemaname='public';
  if actual <> 145 then raise exception 'expected 145 public policies, found %', actual; end if;

  select count(*) into actual from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity;
  if actual <> 80 then raise exception 'expected RLS on all 80 public tables, found %', actual; end if;

  select count(*) into actual from storage.buckets where id in ('client-assets','video-assets');
  if actual <> 2 then raise exception 'expected two application storage buckets, found %', actual; end if;

  select count(*) into actual from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname in (
        'client_assets_storage_staff_select','client_assets_storage_staff_insert',
        'client_assets_storage_staff_update','client_assets_storage_staff_delete',
        'video_assets_storage_staff_select','video_assets_storage_staff_insert',
        'video_assets_storage_staff_update','video_assets_storage_staff_delete'
      );
  if actual <> 8 then raise exception 'expected eight application storage policies, found %', actual; end if;

  select count(*) into actual from public.brand_prompt_blocks
    where (block_type, version) in (('brand_dna',1),('brand_sting',1));
  if actual <> 2 then raise exception 'expected two required brand prompt seed rows, found %', actual; end if;

  if to_regclass('public.client_phase3_status_v') is not null then
    raise exception 'held client_phase3_status_v was applied unexpectedly';
  end if;

  if to_regprocedure('public.increment_ad_lead(uuid,date)') is not null
     or to_regprocedure('public.trg_lead_score_before()') is not null
     or to_regprocedure('public.trg_lead_score_after()') is not null then
    raise exception 'held legacy security targets unexpectedly exist';
  end if;
end
$$;

do $$
declare
  signature text;
  signatures text[] := array[
    'public.apply_delete_asset(uuid,uuid)',
    'public.claim_due_distribution_records(text,integer)',
    'public.commit_ideation_content(uuid,uuid,integer,uuid,text,jsonb,text,text,text,text,text,text,text)',
    'public.insert_reel_storyboard_if_empty(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,text)',
    'public.persist_instagram_insights_collection(uuid,uuid,text,text[],jsonb,text[])',
    'public.reset_failed_reel_shot_video(uuid,uuid,uuid,timestamp with time zone,text,numeric)'
  ];
begin
  foreach signature in array signatures loop
    if to_regprocedure(signature) is null then raise exception 'missing restricted function %', signature; end if;
    if has_function_privilege('anon', signature, 'EXECUTE') then raise exception 'anon can execute %', signature; end if;
    if has_function_privilege('authenticated', signature, 'EXECUTE') then raise exception 'authenticated can execute %', signature; end if;
    if not has_function_privilege('service_role', signature, 'EXECUTE') then raise exception 'service_role cannot execute %', signature; end if;
  end loop;
end
$$;
