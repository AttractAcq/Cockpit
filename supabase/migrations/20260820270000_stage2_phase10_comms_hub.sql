-- Stage 2, Phase 10 — Communications Hub.
--
-- Per Decision 3 (Phase 00): v1 channel is Instagram/Meta DMs, one channel
-- only ("Start with one or two channels, not the whole list" -- the phase
-- card's own deferral). Two new tables: comms_identities (a real external
-- platform identity -- an Instagram-scoped sender ID -- optionally linked
-- to a sales_leads or clients row) and comms_messages (the conversation
-- timeline). Within Decision 4's <=3-table budget.
--
-- Identity resolution is deliberately manual in v1, not automatic fuzzy
-- matching: Instagram gives no email/phone to match against, and building
-- an AI-based auto-linker ahead of any real usage would be exactly the
-- kind of premature automation Principle 01 and the command_center_notes
-- precedent both warn against ("AI inference... deliberately deferred
-- until the manual version is trusted first"). A human links an identity
-- to a Sales lead or Delivery client; the exit gate ("real conversations
-- attribute correctly") is satisfied by that human-confirmed link, not by
-- guessing.
--
-- Inbound message ingestion is service-role-only (called by the
-- meta-instagram-webhook edge function, which authenticates Meta itself
-- via X-Hub-Signature-256, not a Supabase JWT -- there is no staff session
-- on an inbound DM). record_comms_message is therefore granted to
-- service_role only, unlike every other Stage 2 RPC which grants to
-- authenticated too.

create table public.comms_identities (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  external_user_id text not null,
  display_name text,
  matched_lead_id uuid references public.sales_leads(id) on delete set null,
  matched_client_id uuid references public.clients(id) on delete set null,
  matched_at timestamptz,
  matched_by uuid references public.users(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint comms_identities_platform_check check (platform in ('instagram')),
  constraint comms_identities_unique unique (platform, external_user_id),
  constraint comms_identities_single_match_check check (not (matched_lead_id is not null and matched_client_id is not null))
);

create index comms_identities_lead_idx on public.comms_identities (matched_lead_id) where matched_lead_id is not null;
create index comms_identities_client_idx on public.comms_identities (matched_client_id) where matched_client_id is not null;

alter table public.comms_identities enable row level security;
revoke all on public.comms_identities from public, anon, authenticated;
grant select on public.comms_identities to authenticated;
grant all on public.comms_identities to service_role;

create policy comms_identities_select on public.comms_identities
  for select to authenticated using (coalesce(public.auth_role(), '') <> 'client');

comment on table public.comms_identities is 'Stage 2 Phase 10: one real external-platform identity (v1: Instagram DM sender), optionally linked to a sales_leads or clients row by explicit staff action -- never auto-matched.';

create table public.comms_messages (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.comms_identities(id) on delete cascade,
  direction text not null,
  body text not null,
  external_message_id text,
  occurred_at timestamptz not null default now(),
  sent_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint comms_messages_direction_check check (direction in ('inbound','outbound')),
  constraint comms_messages_body_check check (length(trim(body)) > 0)
);

create unique index comms_messages_external_id_idx on public.comms_messages (identity_id, external_message_id) where external_message_id is not null;
create index comms_messages_identity_idx on public.comms_messages (identity_id, occurred_at desc);

alter table public.comms_messages enable row level security;
revoke all on public.comms_messages from public, anon, authenticated;
grant select on public.comms_messages to authenticated;
grant all on public.comms_messages to service_role;

create policy comms_messages_select on public.comms_messages
  for select to authenticated using (coalesce(public.auth_role(), '') <> 'client');

comment on table public.comms_messages is 'Stage 2 Phase 10: the conversation timeline for a comms_identities row. external_message_id + the unique index give idempotent inbound ingestion -- a Meta webhook retry cannot create a duplicate.';

-- Service-role-only: called by the webhook (inbound) and by
-- send-instagram-message (outbound) after a successful Graph API call.
-- Never callable from a staff browser session directly -- there is no
-- legitimate reason for the frontend to fabricate a message row.
create or replace function public.record_comms_message(
  p_platform text, p_external_user_id text, p_direction text, p_body text,
  p_display_name text default null, p_external_message_id text default null,
  p_occurred_at timestamptz default now(), p_sent_by uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_identity_id uuid; v_message_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'AUTH: service role required'; end if;
  if p_platform not in ('instagram') then raise exception 'VALIDATION: unsupported platform'; end if;
  if p_direction not in ('inbound','outbound') then raise exception 'VALIDATION: invalid direction'; end if;
  if length(trim(coalesce(p_body,''))) = 0 then raise exception 'VALIDATION: body is required'; end if;

  insert into public.comms_identities (platform, external_user_id, display_name)
  values (p_platform, p_external_user_id, nullif(trim(coalesce(p_display_name,'')),''))
  on conflict (platform, external_user_id) do update set
    last_seen_at = now(),
    display_name = coalesce(nullif(trim(coalesce(p_display_name,'')),''), public.comms_identities.display_name)
  returning id into v_identity_id;

  insert into public.comms_messages (identity_id, direction, body, external_message_id, occurred_at, sent_by)
  values (v_identity_id, p_direction, trim(p_body), p_external_message_id, coalesce(p_occurred_at, now()), p_sent_by)
  on conflict (identity_id, external_message_id) where external_message_id is not null do nothing
  returning id into v_message_id;

  if v_message_id is null then
    select id into v_message_id from public.comms_messages
    where identity_id = v_identity_id and external_message_id = p_external_message_id;
  end if;

  return v_message_id;
end; $$;

revoke all on function public.record_comms_message(text,text,text,text,text,text,timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.record_comms_message(text,text,text,text,text,text,timestamptz,uuid) to service_role;

comment on function public.record_comms_message(text,text,text,text,text,text,timestamptz,uuid) is 'Service-role only. Find-or-create the identity, idempotently insert the message (external_message_id dedupes webhook retries). Called by meta-instagram-webhook (inbound) and send-instagram-message (outbound), never directly from a staff session.';

create or replace function public.link_comms_identity(p_identity_id uuid, p_lead_id uuid default null, p_client_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.comms_identities;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if p_lead_id is not null and p_client_id is not null then raise exception 'VALIDATION: link to a lead or a client, not both'; end if;

  select * into v_row from public.comms_identities where id = p_identity_id for update;
  if not found then raise exception 'NOT_FOUND: identity'; end if;
  if p_lead_id is not null and not exists (select 1 from public.sales_leads where id = p_lead_id) then raise exception 'NOT_FOUND: sales lead'; end if;
  if p_client_id is not null and not exists (select 1 from public.clients where id = p_client_id) then raise exception 'NOT_FOUND: client'; end if;

  update public.comms_identities set
    matched_lead_id = p_lead_id,
    matched_client_id = p_client_id,
    matched_at = case when p_lead_id is not null or p_client_id is not null then now() else null end,
    matched_by = case when p_lead_id is not null or p_client_id is not null then auth.uid() else null end
  where id = p_identity_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (p_client_id, auth.uid(), 'comms_identity_linked', 'Conversation identity ' || coalesce(v_row.display_name, v_row.external_user_id) || ' linked.', 'comms_identity', v_row.id, jsonb_build_object('lead_id', p_lead_id, 'client_id', p_client_id));
end; $$;

revoke all on function public.link_comms_identity(uuid,uuid,uuid) from public, anon;
grant execute on function public.link_comms_identity(uuid,uuid,uuid) to authenticated, service_role;

comment on function public.link_comms_identity(uuid,uuid,uuid) is 'Staff-only. Manually links (or unlinks, if both null) a comms identity to a sales_leads or clients row -- deliberately not automatic, per this migration''s own header.';
