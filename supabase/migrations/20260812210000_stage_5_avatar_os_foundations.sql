-- Stage 5: Avatar OS foundations.
--
-- Avatar OS creates owned communication identity authority for a client brand:
-- strategy, appearance, voice, environment, creative direction, knowledge,
-- formats, and reusable assets. It amplifies proof and expertise; it does not
-- replace proof, invent client facts, or create content ideas by itself.

alter table public.client_research_runs
  drop constraint if exists client_research_runs_domain_check;

alter table public.client_research_runs
  add constraint client_research_runs_domain_check check (research_domain in (
    'business',
    'market',
    'competitors',
    'customer_language',
    'category_regulation',
    'market_conditions',
    'avatar',
    'competitor',
    'association',
    'brand_strategist',
    'campaign_intelligence',
    'offer_system',
    'avatar_system'
  ));

create table public.client_avatar_releases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  version integer not null,
  status text not null default 'draft',
  research_run_id uuid,
  title text not null,
  summary text not null default '',
  authority_snapshot jsonb not null default '{}'::jsonb,
  generated_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  superseded_at timestamptz,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_avatar_releases_run_client_fk foreign key (research_run_id, client_id)
    references public.client_research_runs(id, client_id) on delete restrict,
  constraint client_avatar_releases_status_check check (status in (
    'draft','needs_review','approved','superseded','archived'
  )),
  constraint client_avatar_releases_version_check check (version >= 1),
  constraint client_avatar_releases_summary_check check (length(summary) <= 5000),
  constraint client_avatar_releases_authority_snapshot_check check (jsonb_typeof(authority_snapshot) = 'object'),
  constraint client_avatar_releases_client_version_unique unique (client_id, version),
  constraint client_avatar_releases_id_client_unique unique (id, client_id)
);

create index client_avatar_releases_client_status_idx
  on public.client_avatar_releases (client_id, status, created_at desc);

create table public.client_avatar_components (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  release_id uuid not null,
  component_type text not null,
  component_key text not null,
  title text not null,
  summary text not null default '',
  strategic_rationale text not null default '',
  evidence_summary text not null default '',
  structured_payload jsonb not null default '{}'::jsonb,
  upstream_refs jsonb not null default '[]'::jsonb,
  generation_contract jsonb not null default '{}'::jsonb,
  regenerates_component_id uuid,
  display_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_avatar_components_release_client_fk foreign key (release_id, client_id)
    references public.client_avatar_releases(id, client_id) on delete cascade,
  constraint client_avatar_components_regenerates_fk foreign key (regenerates_component_id, client_id)
    references public.client_avatar_components(id, client_id) on delete restrict,
  constraint client_avatar_components_type_check check (component_type in (
    'avatar_strategy',
    'appearance',
    'environment',
    'voice_personality',
    'creative_direction',
    'knowledge_expertise',
    'content_format',
    'asset_library'
  )),
  constraint client_avatar_components_key_check check (length(trim(component_key)) between 1 and 120),
  constraint client_avatar_components_summary_check check (length(summary) <= 5000),
  constraint client_avatar_components_payload_check check (jsonb_typeof(structured_payload) = 'object'),
  constraint client_avatar_components_refs_check check (jsonb_typeof(upstream_refs) = 'array'),
  constraint client_avatar_components_contract_check check (jsonb_typeof(generation_contract) = 'object'),
  constraint client_avatar_components_order_check check (display_order >= 1),
  constraint client_avatar_components_release_key_unique unique (release_id, component_key),
  constraint client_avatar_components_release_order_unique unique (release_id, display_order),
  constraint client_avatar_components_id_client_unique unique (id, client_id)
);

create index client_avatar_components_release_idx
  on public.client_avatar_components (release_id, display_order);
create index client_avatar_components_type_idx
  on public.client_avatar_components (client_id, component_type, created_at desc);

create table public.client_avatar_assets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  release_id uuid not null,
  component_id uuid,
  asset_type text not null,
  title text not null,
  description text not null default '',
  storage_bucket text,
  storage_path text,
  external_url text,
  prompt_payload jsonb not null default '{}'::jsonb,
  generation_provider text,
  generation_model text,
  status text not null default 'draft',
  version integer not null default 1,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_avatar_assets_release_client_fk foreign key (release_id, client_id)
    references public.client_avatar_releases(id, client_id) on delete cascade,
  constraint client_avatar_assets_component_client_fk foreign key (component_id, client_id)
    references public.client_avatar_components(id, client_id) on delete restrict,
  constraint client_avatar_assets_type_check check (asset_type in (
    'canonical_image','pose_reference','expression_reference','environment_reference',
    'character_sheet','environment_sheet','prompt_pack','voice_reference','production_reference','other'
  )),
  constraint client_avatar_assets_status_check check (status in ('draft','needs_review','approved','archived')),
  constraint client_avatar_assets_prompt_check check (jsonb_typeof(prompt_payload) = 'object'),
  constraint client_avatar_assets_version_check check (version >= 1),
  constraint client_avatar_assets_location_check check (
    status in ('draft','needs_review','archived')
    or storage_path is not null
    or external_url is not null
    or asset_type in ('prompt_pack','production_reference','other')
  )
);

create index client_avatar_assets_release_idx
  on public.client_avatar_assets (release_id, created_at desc);

create table public.client_avatar_approval_decisions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  release_id uuid not null,
  decision text not null,
  previous_status text not null,
  resulting_status text not null,
  note text,
  decided_by uuid not null,
  decided_at timestamptz not null default now(),
  constraint client_avatar_decisions_release_client_fk foreign key (release_id, client_id)
    references public.client_avatar_releases(id, client_id) on delete cascade,
  constraint client_avatar_decisions_decision_check check (decision in (
    'approved','changes_requested','rejected'
  ))
);

create index client_avatar_decisions_release_idx
  on public.client_avatar_approval_decisions (release_id, decided_at desc);

create table public.client_avatar_active_releases (
  client_id uuid primary key references public.clients(id) on delete cascade,
  release_id uuid not null,
  activated_by uuid not null,
  activated_at timestamptz not null default now(),
  constraint client_avatar_active_release_fk foreign key (release_id, client_id)
    references public.client_avatar_releases(id, client_id) on delete restrict
);

create trigger client_avatar_releases_updated_at before update on public.client_avatar_releases
  for each row execute function public.set_updated_at();
create trigger client_avatar_components_updated_at before update on public.client_avatar_components
  for each row execute function public.set_updated_at();
create trigger client_avatar_assets_updated_at before update on public.client_avatar_assets
  for each row execute function public.set_updated_at();

create or replace function public.prevent_approved_avatar_release_mutation()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_status text;
  v_release_id uuid;
begin
  if tg_op = 'DELETE' then
    v_release_id := old.release_id;
  else
    v_release_id := new.release_id;
  end if;
  select status into v_status from public.client_avatar_releases where id = v_release_id;
  if v_status in ('approved','superseded','archived') then
    raise exception 'IMMUTABLE: approved avatar releases cannot be changed';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end; $$;

create trigger client_avatar_components_release_guard
  before insert or update or delete on public.client_avatar_components
  for each row execute function public.prevent_approved_avatar_release_mutation();

drop trigger if exists client_avatar_assets_release_guard on public.client_avatar_assets;

create or replace function public.review_avatar_release(
  p_release_id uuid,
  p_decision text,
  p_note text default null
) returns public.client_avatar_releases
language plpgsql security definer set search_path = '' as $$
declare
  v_release public.client_avatar_releases;
  v_previous public.client_avatar_releases;
  v_resulting_status text;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then
    raise exception 'AUTH: staff role required';
  end if;
  if p_decision not in ('approved','changes_requested','rejected') then
    raise exception 'VALIDATION: invalid approval decision';
  end if;

  select * into v_release from public.client_avatar_releases where id = p_release_id for update;
  if not found then raise exception 'NOT_FOUND: avatar release'; end if;
  if not (v_release.client_id = any(public.auth_client_ids())) then
    raise exception 'AUTH: client access required';
  end if;
  if v_release.status <> 'needs_review' then
    raise exception 'VALIDATION: release must be awaiting review';
  end if;

  if p_decision = 'approved' then
    if not exists (
      select 1 from public.client_avatar_components component
      where component.release_id = v_release.id
        and component.client_id = v_release.client_id
        and component.component_type = 'avatar_strategy'
    ) then
      raise exception 'VALIDATION: avatar strategy component required';
    end if;
    v_resulting_status := 'approved';
    update public.client_avatar_releases
    set status = 'approved', approved_at = now()
    where id = v_release.id
    returning * into v_release;

    select release.* into v_previous
    from public.client_avatar_active_releases active
    join public.client_avatar_releases release on release.id = active.release_id
    where active.client_id = v_release.client_id
      and active.release_id <> v_release.id
    for update of release;

    if found then
      update public.client_avatar_releases
      set status = 'superseded', superseded_at = now()
      where id = v_previous.id;
    end if;

    insert into public.client_avatar_active_releases (
      client_id, release_id, activated_by, activated_at
    ) values (
      v_release.client_id, v_release.id, auth.uid(), now()
    ) on conflict (client_id) do update set
      release_id = excluded.release_id,
      activated_by = excluded.activated_by,
      activated_at = excluded.activated_at;
  elsif p_decision = 'changes_requested' then
    v_resulting_status := 'draft';
    update public.client_avatar_releases
    set status = 'draft', submitted_at = null
    where id = v_release.id
    returning * into v_release;
  else
    v_resulting_status := 'archived';
    update public.client_avatar_releases
    set status = 'archived', archived_at = now()
    where id = v_release.id
    returning * into v_release;
  end if;

  insert into public.client_avatar_approval_decisions (
    client_id, release_id, decision, previous_status, resulting_status, note, decided_by
  ) values (
    v_release.client_id, v_release.id, p_decision, 'needs_review', v_resulting_status,
    nullif(trim(coalesce(p_note, '')), ''), auth.uid()
  );

  insert into public.activity_log (
    client_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    v_release.client_id, auth.uid(), 'avatar_os.reviewed',
    'client_avatar_releases', v_release.id,
    jsonb_build_object('decision', p_decision, 'resulting_status', v_resulting_status)
  );

  return v_release;
end; $$;

create or replace function public.review_avatar_asset(
  p_asset_id uuid,
  p_decision text,
  p_note text default null
) returns public.client_avatar_assets
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.client_avatar_assets;
  v_resulting_status text;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then
    raise exception 'AUTH: staff role required';
  end if;
  if p_decision not in ('approved','changes_requested','rejected') then
    raise exception 'VALIDATION: invalid asset review decision';
  end if;

  select * into v_asset from public.client_avatar_assets where id = p_asset_id for update;
  if not found then raise exception 'NOT_FOUND: avatar asset'; end if;
  if not (v_asset.client_id = any(public.auth_client_ids())) then
    raise exception 'AUTH: client access required';
  end if;
  if v_asset.status <> 'needs_review' then
    raise exception 'VALIDATION: asset must be awaiting review';
  end if;

  if p_decision = 'approved' then
    if v_asset.asset_type not in ('prompt_pack','production_reference','other')
      and v_asset.storage_path is null
      and v_asset.external_url is null then
      raise exception 'VALIDATION: visual or reference avatar assets require storage_path or external_url before approval';
    end if;
    v_resulting_status := 'approved';
    update public.client_avatar_assets
    set status = 'approved', approved_at = now()
    where id = v_asset.id
    returning * into v_asset;
  elsif p_decision = 'changes_requested' then
    v_resulting_status := 'draft';
    update public.client_avatar_assets
    set status = 'draft', approved_at = null
    where id = v_asset.id
    returning * into v_asset;
  else
    v_resulting_status := 'archived';
    update public.client_avatar_assets
    set status = 'archived', approved_at = null
    where id = v_asset.id
    returning * into v_asset;
  end if;

  insert into public.activity_log (
    client_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    v_asset.client_id, auth.uid(), 'avatar_asset.reviewed',
    'client_avatar_assets', v_asset.id,
    jsonb_build_object(
      'decision', p_decision,
      'resulting_status', v_resulting_status,
      'note', nullif(trim(coalesce(p_note, '')), '')
    )
  );

  return v_asset;
end; $$;

alter table public.client_avatar_releases enable row level security;
alter table public.client_avatar_components enable row level security;
alter table public.client_avatar_assets enable row level security;
alter table public.client_avatar_approval_decisions enable row level security;
alter table public.client_avatar_active_releases enable row level security;

revoke all on
  public.client_avatar_releases,
  public.client_avatar_components,
  public.client_avatar_assets,
  public.client_avatar_approval_decisions,
  public.client_avatar_active_releases
from public, anon, authenticated;

grant select on
  public.client_avatar_releases,
  public.client_avatar_components,
  public.client_avatar_assets,
  public.client_avatar_approval_decisions,
  public.client_avatar_active_releases
to authenticated;

grant all on
  public.client_avatar_releases,
  public.client_avatar_components,
  public.client_avatar_assets,
  public.client_avatar_approval_decisions,
  public.client_avatar_active_releases
to service_role;

create policy client_avatar_releases_select on public.client_avatar_releases
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_avatar_components_select on public.client_avatar_components
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_avatar_assets_select on public.client_avatar_assets
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_avatar_decisions_select on public.client_avatar_approval_decisions
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_avatar_active_select on public.client_avatar_active_releases
  for select to authenticated using (client_id = any(public.auth_client_ids()));

revoke all on function public.review_avatar_release(uuid,text,text) from public, anon;
grant execute on function public.review_avatar_release(uuid,text,text) to authenticated, service_role;
revoke all on function public.review_avatar_asset(uuid,text,text) from public, anon;
grant execute on function public.review_avatar_asset(uuid,text,text) to authenticated, service_role;

comment on table public.client_avatar_releases is
  'Versioned Avatar OS authority. Defines owned communication identity and creative-world guidance; does not replace proof or generate content ideas.';
comment on table public.client_avatar_components is
  'Structured Avatar OS components such as strategy, appearance, environment, voice, knowledge, formats, and creative direction.';
comment on table public.client_avatar_assets is
  'Reusable Avatar OS production assets and prompt/reference library items.';
comment on function public.review_avatar_release(uuid,text,text) is
  'Records human review and atomically activates approved Avatar OS while superseding the prior active release.';
comment on function public.review_avatar_asset(uuid,text,text) is
  'Records human review for generated Avatar OS asset rows. Non-text assets require a stored or external reference before approval.';
