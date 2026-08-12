-- Phase 4A: Campaign Intelligence foundations.
--
-- Campaign Intelligence answers "what matters when, and why?" as reviewable
-- strategic authority. It remains separate from Offers and Ideation so later
-- modules can consume approved campaign periods without inheriting generation
-- responsibility.

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
    'campaign_intelligence'
  ));

create table public.client_campaign_intelligence_releases (
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
  constraint client_campaign_releases_run_client_fk foreign key (research_run_id, client_id)
    references public.client_research_runs(id, client_id) on delete restrict,
  constraint client_campaign_releases_status_check check (status in (
    'draft','needs_review','approved','superseded','archived'
  )),
  constraint client_campaign_releases_version_check check (version >= 1),
  constraint client_campaign_releases_summary_check check (length(summary) <= 5000),
  constraint client_campaign_releases_authority_snapshot_check check (jsonb_typeof(authority_snapshot) = 'object'),
  constraint client_campaign_releases_client_version_unique unique (client_id, version),
  constraint client_campaign_releases_id_client_unique unique (id, client_id)
);

create index client_campaign_releases_client_status_idx
  on public.client_campaign_intelligence_releases (client_id, status, created_at desc);

create table public.client_campaign_periods (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  release_id uuid not null,
  period_key text not null,
  title text not null,
  strategic_theme text not null,
  timing_label text not null,
  timing_start date,
  timing_end date,
  icp_context text not null default '',
  emotional_states text[] not null default '{}'::text[],
  pain_point_salience text[] not null default '{}'::text[],
  desired_outcome text not null default '',
  awareness_shift text not null default '',
  strategic_messaging_direction text not null default '',
  positioning_direction text not null default '',
  campaign_objective text not null default '',
  customer_journey_stage text not null default 'unspecified',
  previous_period_relationship text not null default '',
  evidence_summary text not null default '',
  payload jsonb not null default '{}'::jsonb,
  display_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_campaign_periods_release_client_fk foreign key (release_id, client_id)
    references public.client_campaign_intelligence_releases(id, client_id) on delete cascade,
  constraint client_campaign_periods_key_check check (length(trim(period_key)) between 1 and 120),
  constraint client_campaign_periods_order_check check (display_order >= 1),
  constraint client_campaign_periods_timing_check check (
    timing_start is null or timing_end is null or timing_start <= timing_end
  ),
  constraint client_campaign_periods_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint client_campaign_periods_release_key_unique unique (release_id, period_key),
  constraint client_campaign_periods_release_order_unique unique (release_id, display_order),
  constraint client_campaign_periods_id_client_unique unique (id, client_id)
);

create index client_campaign_periods_release_idx
  on public.client_campaign_periods (release_id, display_order);

create table public.client_campaign_period_source_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  campaign_period_id uuid not null,
  source_domain text not null,
  source_release_id uuid,
  source_record_id uuid,
  source_finding_id uuid,
  relationship text not null default 'informs',
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint client_campaign_source_period_client_fk foreign key (campaign_period_id, client_id)
    references public.client_campaign_periods(id, client_id) on delete cascade,
  constraint client_campaign_source_domain_check check (source_domain in (
    'market_os','avatar_os','competitor_os','association_os','brand_strategist','context'
  )),
  constraint client_campaign_source_relationship_check check (relationship in (
    'informs','supports','constrains','contradicts'
  )),
  constraint client_campaign_source_has_origin_check check (
    source_release_id is not null or source_record_id is not null or source_finding_id is not null
  )
);

create index client_campaign_source_links_period_idx
  on public.client_campaign_period_source_links (campaign_period_id);

create table public.client_campaign_intelligence_approval_decisions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  release_id uuid not null,
  decision text not null,
  previous_status text not null,
  resulting_status text not null,
  note text,
  decided_by uuid not null,
  decided_at timestamptz not null default now(),
  constraint client_campaign_decisions_release_client_fk foreign key (release_id, client_id)
    references public.client_campaign_intelligence_releases(id, client_id) on delete cascade,
  constraint client_campaign_decisions_decision_check check (decision in (
    'approved','changes_requested','rejected'
  ))
);

create index client_campaign_decisions_release_idx
  on public.client_campaign_intelligence_approval_decisions (release_id, decided_at desc);

create table public.client_campaign_intelligence_active_releases (
  client_id uuid primary key references public.clients(id) on delete cascade,
  release_id uuid not null,
  activated_by uuid not null,
  activated_at timestamptz not null default now(),
  constraint client_campaign_active_release_fk foreign key (release_id, client_id)
    references public.client_campaign_intelligence_releases(id, client_id) on delete restrict
);

create trigger client_campaign_releases_updated_at before update on public.client_campaign_intelligence_releases
  for each row execute function public.set_updated_at();
create trigger client_campaign_periods_updated_at before update on public.client_campaign_periods
  for each row execute function public.set_updated_at();

create or replace function public.prevent_approved_campaign_intelligence_mutation()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_status text;
  v_release_id uuid;
begin
  if tg_table_name = 'client_campaign_period_source_links' then
    select period.release_id into v_release_id
    from public.client_campaign_periods period
    where period.id = coalesce(old.campaign_period_id, new.campaign_period_id);
  else
    v_release_id := coalesce(old.release_id, new.release_id);
  end if;

  select status into v_status
  from public.client_campaign_intelligence_releases
  where id = v_release_id;
  if v_status in ('approved','superseded','archived') then
    raise exception 'IMMUTABLE: approved campaign intelligence releases cannot be changed';
  end if;
  return coalesce(new, old);
end; $$;

create trigger client_campaign_periods_release_guard
  before insert or update or delete on public.client_campaign_periods
  for each row execute function public.prevent_approved_campaign_intelligence_mutation();
create trigger client_campaign_source_links_release_guard
  before insert or update or delete on public.client_campaign_period_source_links
  for each row execute function public.prevent_approved_campaign_intelligence_mutation();

create or replace function public.review_campaign_intelligence_release(
  p_release_id uuid,
  p_decision text,
  p_note text default null
) returns public.client_campaign_intelligence_releases
language plpgsql security definer set search_path = '' as $$
declare
  v_release public.client_campaign_intelligence_releases;
  v_previous public.client_campaign_intelligence_releases;
  v_resulting_status text;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','editor') then
    raise exception 'AUTH: staff role required';
  end if;
  if p_decision not in ('approved','changes_requested','rejected') then
    raise exception 'VALIDATION: invalid approval decision';
  end if;

  select * into v_release
  from public.client_campaign_intelligence_releases
  where id = p_release_id
  for update;

  if not found then raise exception 'NOT_FOUND: campaign intelligence release'; end if;
  if not (v_release.client_id = any(public.auth_client_ids())) then
    raise exception 'AUTH: client access required';
  end if;
  if v_release.status <> 'needs_review' then
    raise exception 'VALIDATION: release must be awaiting review';
  end if;

  if p_decision = 'approved' then
    if not exists (
      select 1 from public.client_campaign_periods period
      where period.release_id = v_release.id and period.client_id = v_release.client_id
    ) then
      raise exception 'VALIDATION: release has no campaign periods';
    end if;
    v_resulting_status := 'approved';
    update public.client_campaign_intelligence_releases
    set status = 'approved', approved_at = now()
    where id = v_release.id
    returning * into v_release;

    select release.* into v_previous
    from public.client_campaign_intelligence_active_releases active
    join public.client_campaign_intelligence_releases release on release.id = active.release_id
    where active.client_id = v_release.client_id
      and active.release_id <> v_release.id
    for update of release;

    if found then
      update public.client_campaign_intelligence_releases
      set status = 'superseded', superseded_at = now()
      where id = v_previous.id;
    end if;

    insert into public.client_campaign_intelligence_active_releases (
      client_id, release_id, activated_by, activated_at
    ) values (
      v_release.client_id, v_release.id, auth.uid(), now()
    ) on conflict (client_id) do update set
      release_id = excluded.release_id,
      activated_by = excluded.activated_by,
      activated_at = excluded.activated_at;
  elsif p_decision = 'changes_requested' then
    v_resulting_status := 'draft';
    update public.client_campaign_intelligence_releases
    set status = 'draft', submitted_at = null
    where id = v_release.id
    returning * into v_release;
  else
    v_resulting_status := 'archived';
    update public.client_campaign_intelligence_releases
    set status = 'archived', archived_at = now()
    where id = v_release.id
    returning * into v_release;
  end if;

  insert into public.client_campaign_intelligence_approval_decisions (
    client_id, release_id, decision, previous_status, resulting_status, note, decided_by
  ) values (
    v_release.client_id, v_release.id, p_decision, 'needs_review', v_resulting_status,
    nullif(trim(coalesce(p_note, '')), ''), auth.uid()
  );

  insert into public.activity_log (
    client_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    v_release.client_id, auth.uid(), 'campaign_intelligence.reviewed',
    'client_campaign_intelligence_releases', v_release.id,
    jsonb_build_object('decision', p_decision, 'resulting_status', v_resulting_status)
  );

  return v_release;
end; $$;

alter table public.client_campaign_intelligence_releases enable row level security;
alter table public.client_campaign_periods enable row level security;
alter table public.client_campaign_period_source_links enable row level security;
alter table public.client_campaign_intelligence_approval_decisions enable row level security;
alter table public.client_campaign_intelligence_active_releases enable row level security;

revoke all on
  public.client_campaign_intelligence_releases,
  public.client_campaign_periods,
  public.client_campaign_period_source_links,
  public.client_campaign_intelligence_approval_decisions,
  public.client_campaign_intelligence_active_releases
from public, anon, authenticated;

grant select on
  public.client_campaign_intelligence_releases,
  public.client_campaign_periods,
  public.client_campaign_period_source_links,
  public.client_campaign_intelligence_approval_decisions,
  public.client_campaign_intelligence_active_releases
to authenticated;

grant all on
  public.client_campaign_intelligence_releases,
  public.client_campaign_periods,
  public.client_campaign_period_source_links,
  public.client_campaign_intelligence_approval_decisions,
  public.client_campaign_intelligence_active_releases
to service_role;

create policy client_campaign_releases_select on public.client_campaign_intelligence_releases
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_campaign_periods_select on public.client_campaign_periods
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_campaign_source_links_select on public.client_campaign_period_source_links
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_campaign_decisions_select on public.client_campaign_intelligence_approval_decisions
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_campaign_active_releases_select on public.client_campaign_intelligence_active_releases
  for select to authenticated using (client_id = any(public.auth_client_ids()));

revoke all on function public.review_campaign_intelligence_release(uuid,text,text) from public, anon;
grant execute on function public.review_campaign_intelligence_release(uuid,text,text) to authenticated, service_role;

comment on table public.client_campaign_intelligence_releases is
  'Versioned Campaign Intelligence authority. Determines what matters when and why; does not generate offers or content ideas.';
comment on table public.client_campaign_periods is
  'Strategic campaign periods within a Campaign Intelligence release. Downstream Seasonal Offers and Ideation consume approved rows by id.';
comment on function public.review_campaign_intelligence_release(uuid,text,text) is
  'Records human review and atomically activates approved Campaign Intelligence while superseding the prior active release.';
