-- Cockpit v3, Step 3 (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md) — Team
-- workspace. The one genuinely greenfield piece of this step: channels and
-- threaded messages, replacing nothing (the existing read-only directory,
-- Stage 2 Phase 09's TeamRolesSection, stays exactly as-is; this is additive
-- alongside it, per the "hide before delete" discipline -- there is nothing
-- to hide here since nothing is being replaced, only added to).
--
-- Business-scoped (business_id, not client_id), following Phase 06's
-- sales_leads precedent for genuinely new cross-department schema: a Team
-- channel is a property of the business operating it, not of any one
-- clients row. No per-business channel-membership/ACL table yet -- every
-- staff role can read/write every business's channels, the same breadth
-- Sales already uses (Decision 00, "thin enough" -- a membership/ACL layer
-- is deferred until Business #2 or a real multi-tenant conflict shows it's
-- needed, not guessed at now).
--
-- Threads are one level deep: parent_message_id on team_messages itself (a
-- self-reference), with an RPC-enforced rule that a reply's own parent must
-- itself be a top-level message -- no nested threads, matching the
-- deliberately thin bar every other Stage 2/Cockpit v3 department has used.
--
-- @mention *execution* (an agent actually acting on being mentioned) is
-- explicitly deferred to Step 5 (Master AI) per this step's own card --
-- there is no agent-invocation machinery here, only the client-side
-- rendering the plan asks for (src/lib/team-mentions.ts). Agents are
-- mentioned by their real registry name (e.g. "run-market-os"), never an
-- invented display name -- this codebase has no friendly agent-name concept
-- anywhere else (TeamRolesSection shows the raw registry name too).

create table public.team_channels (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  slug text not null,
  archived boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_channels_name_check check (length(trim(name)) > 0),
  constraint team_channels_slug_check check (slug ~ '^[a-z0-9-]+$'),
  constraint team_channels_business_slug_unique unique (business_id, slug)
);

create index team_channels_business_idx on public.team_channels (business_id, archived);

drop trigger if exists team_channels_updated_at on public.team_channels;
create trigger team_channels_updated_at before update on public.team_channels
  for each row execute function public.set_updated_at();

alter table public.team_channels enable row level security;
revoke all on public.team_channels from public, anon, authenticated;
grant select on public.team_channels to authenticated;
grant all on public.team_channels to service_role;

create policy team_channels_select on public.team_channels
  for select to authenticated using (coalesce(public.auth_role(), '') <> 'client');

comment on table public.team_channels is 'Cockpit v3 Step 3: a Team workspace channel, business-scoped (businesses(id), no client_id -- new cross-department schema follows Phase 06''s sales_leads precedent). No per-channel membership/ACL yet: every staff role can read/write every business''s channels, deferred generalization matching Decision 00''s "thin enough" bar.';

create table public.team_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.team_channels(id) on delete cascade,
  parent_message_id uuid references public.team_messages(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint team_messages_body_check check (length(trim(body)) > 0)
);

create index team_messages_channel_idx on public.team_messages (channel_id, created_at);
create index team_messages_parent_idx on public.team_messages (parent_message_id) where parent_message_id is not null;

alter table public.team_messages enable row level security;
revoke all on public.team_messages from public, anon, authenticated;
grant select on public.team_messages to authenticated;
grant all on public.team_messages to service_role;

create policy team_messages_select on public.team_messages
  for select to authenticated using (coalesce(public.auth_role(), '') <> 'client');

comment on table public.team_messages is 'Cockpit v3 Step 3: one Team workspace message. parent_message_id makes a one-level-deep thread (RPC-enforced: a reply''s own parent must itself be top-level, no nested threads). @mention parsing is client-side rendering only (src/lib/team-mentions.ts) -- agent-mention *execution* is explicitly deferred to Step 5 (Master AI).';

create or replace function public.create_team_channel(p_business_id uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_slug text; v_client_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if length(trim(coalesce(p_name,''))) = 0 then raise exception 'VALIDATION: name is required'; end if;
  if not exists (select 1 from public.businesses where id = p_business_id) then
    raise exception 'NOT_FOUND: business';
  end if;

  v_slug := regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if length(v_slug) = 0 then raise exception 'VALIDATION: name must contain at least one letter or digit'; end if;
  if exists (select 1 from public.team_channels where business_id = p_business_id and slug = v_slug) then
    raise exception 'CONFLICT: a channel with this name already exists for this business';
  end if;

  insert into public.team_channels (business_id, name, slug, created_by)
  values (p_business_id, trim(p_name), v_slug, auth.uid())
  returning id into v_id;

  select client_id into v_client_id from public.businesses where id = p_business_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_client_id, auth.uid(), 'team_channel_created', 'Team channel "#' || v_slug || '" created.', 'team_channel', v_id, jsonb_build_object('business_id', p_business_id));

  return v_id;
end; $$;

create or replace function public.post_team_message(p_channel_id uuid, p_body text, p_parent_message_id uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_parent public.team_messages;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if length(trim(coalesce(p_body,''))) = 0 then raise exception 'VALIDATION: body is required'; end if;
  if not exists (select 1 from public.team_channels where id = p_channel_id) then
    raise exception 'NOT_FOUND: channel';
  end if;

  if p_parent_message_id is not null then
    select * into v_parent from public.team_messages where id = p_parent_message_id;
    if not found then raise exception 'NOT_FOUND: parent message'; end if;
    if v_parent.channel_id <> p_channel_id then raise exception 'VALIDATION: parent message belongs to a different channel'; end if;
    if v_parent.parent_message_id is not null then raise exception 'VALIDATION: threads are one level deep -- reply to the top-level message, not to a reply'; end if;
  end if;

  insert into public.team_messages (channel_id, parent_message_id, author_id, body)
  values (p_channel_id, p_parent_message_id, auth.uid(), trim(p_body))
  returning id into v_id;

  return v_id;
end; $$;

revoke all on function public.create_team_channel(uuid,text) from public, anon;
revoke all on function public.post_team_message(uuid,text,uuid) from public, anon;
grant execute on function public.create_team_channel(uuid,text) to authenticated, service_role;
grant execute on function public.post_team_message(uuid,text,uuid) to authenticated, service_role;

comment on function public.create_team_channel(uuid,text) is 'Staff-only. Creates a team_channels row for a business; slug is derived from name and must be unique per business.';
comment on function public.post_team_message(uuid,text,uuid) is 'Staff-only. Posts a top-level message, or a threaded reply when p_parent_message_id is given -- rejects replying to a reply (one level deep only).';
