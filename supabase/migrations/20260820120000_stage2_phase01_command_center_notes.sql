-- Stage 2, Phase 01 — Overview / Command Center.
--
-- Additive only. The Metrics/Activity/Work-Item data Command Center needs
-- already exists (client_publish_attempts, client_exception_queue,
-- client_work_items, activity_log, clients) and is read directly by the
-- frontend via src/lib/observability.ts -- no schema change needed for
-- that part. The one genuinely new piece is the manually-authored
-- Bottlenecks & Priorities note the build plan deliberately deferred AI
-- inference for ("has to be earned by a human before it's trusted").
--
-- command_center_notes is cross-business, not per-client -- the first table
-- in this schema with no client_id column, by design. Follows the exact
-- Stage O convention (security definer set search_path = '', explicit
-- revoke from public+anon, activity_log write on mutation) for internal
-- admin operations rather than an edge function, per Stage 2 Phase 00's
-- Open Decision 4 ("0 new edge functions where a direct RPC suffices").

create table public.command_center_notes (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  body text not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  constraint command_center_notes_category_check check (category in ('bottleneck','priority')),
  constraint command_center_notes_body_check check (length(trim(body)) > 0),
  constraint command_center_notes_resolved_check check ((resolved_at is null) = (resolved_by is null))
);

create index command_center_notes_open_idx on public.command_center_notes (category, created_at desc) where resolved_at is null;

alter table public.command_center_notes enable row level security;
revoke all on public.command_center_notes from public, anon, authenticated;
grant select on public.command_center_notes to authenticated;
grant all on public.command_center_notes to service_role;

-- Staff-only read (every non-client role, matching client_onboarding_templates'
-- own precedent for cross-business content) -- the whole team should see
-- leadership's stated bottlenecks/priorities, not just admin.
create policy command_center_notes_select on public.command_center_notes
  for select to authenticated using (coalesce(public.auth_role(), '') <> 'client');

comment on table public.command_center_notes is 'Manually-authored Bottleneck/Priority notes for the cross-business Command Center (Stage 2 Phase 01). Deliberately human-only -- AI inference for this is explicitly deferred by the Stage 2 build plan until the manual version has been trusted first. Not client-scoped: the first table in this schema with no client_id column, by design.';

create or replace function public.add_command_center_note(p_category text, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') <> 'admin' then raise exception 'AUTH: admin role required'; end if;
  if p_category not in ('bottleneck','priority') then raise exception 'VALIDATION: category must be bottleneck or priority'; end if;
  if length(trim(coalesce(p_body,''))) = 0 then raise exception 'VALIDATION: body is required'; end if;

  insert into public.command_center_notes (category, body, created_by)
  values (p_category, trim(p_body), auth.uid())
  returning id into v_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (null, auth.uid(), 'command_center_note_added', 'Command Center ' || p_category || ' noted: ' || left(trim(p_body), 120) || '.', 'command_center_note', v_id, jsonb_build_object('category', p_category));

  return v_id;
end; $$;

create or replace function public.resolve_command_center_note(p_note_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.command_center_notes;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') <> 'admin' then raise exception 'AUTH: admin role required'; end if;

  select * into v_row from public.command_center_notes where id = p_note_id for update;
  if not found then raise exception 'NOT_FOUND: command center note'; end if;
  if v_row.resolved_at is not null then raise exception 'CONFLICT: note already resolved'; end if;

  update public.command_center_notes set resolved_at = now(), resolved_by = auth.uid() where id = p_note_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (null, auth.uid(), 'command_center_note_resolved', 'Command Center ' || v_row.category || ' resolved: ' || left(v_row.body, 120) || '.', 'command_center_note', v_row.id, jsonb_build_object('category', v_row.category));
end; $$;

revoke all on function public.add_command_center_note(text, text) from public, anon;
revoke all on function public.resolve_command_center_note(uuid) from public, anon;
grant execute on function public.add_command_center_note(text, text) to authenticated, service_role;
grant execute on function public.resolve_command_center_note(uuid) to authenticated, service_role;

comment on function public.add_command_center_note(text, text) is 'Admin-only. Records one manually-authored bottleneck or priority note for the Command Center. Stage 2 Phase 01: AI inference for this is deliberately deferred.';
comment on function public.resolve_command_center_note(uuid) is 'Admin-only. Marks a Command Center note resolved; notes are never deleted, only resolved, so history is preserved.';
