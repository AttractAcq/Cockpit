-- Dedicated required bootstrap-seed gate.
do $$
declare actual integer;
begin
  select count(*) into actual from public.brand_prompt_blocks
  where (block_type, version) in (('brand_dna',1),('brand_sting',1));
  if actual <> 2 then raise exception 'expected two required brand prompt seed rows, found %', actual; end if;
end
$$;
\echo STAGE_A_CASE seeds.brand_dna_v1_and_brand_sting_v1_exist PASS
