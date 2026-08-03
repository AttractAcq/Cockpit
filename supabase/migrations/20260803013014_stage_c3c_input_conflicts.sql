-- Programme Stage C3c: conflict detection surface.
-- Review queue only. A conflict row never mutates client inputs, context files,
-- masters, calendar, assets, distribution or approval state.

create table public.client_input_conflicts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  conflict_type text not null,
  severity text not null default 'warning',
  status text not null default 'open',
  title text not null,
  detail text not null,
  left_source_kind text not null,
  left_source_ref text not null,
  right_source_kind text,
  right_source_ref text,
  detected_by text not null,
  resolution_note text,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_input_conflicts_type_check check (conflict_type in ('contradictory_documents','offer_superseded','deprecated_pricing','conflicting_positioning','unsupported_result','missing_evidence','region_currency')),
  constraint client_input_conflicts_severity_check check (severity in ('info','warning','blocking')),
  constraint client_input_conflicts_status_check check (status in ('open','acknowledged','resolved','dismissed')),
  constraint client_input_conflicts_title_check check (length(title) between 1 and 400),
  constraint client_input_conflicts_resolved_check check (status not in ('resolved','dismissed') or (resolved_by is not null and resolved_at is not null and resolution_note is not null))
);
create index client_input_conflicts_client_status_idx on public.client_input_conflicts (client_id, status);
create trigger client_input_conflicts_updated_at before update on public.client_input_conflicts for each row execute function public.set_updated_at();
alter table public.client_input_conflicts enable row level security;
revoke all on public.client_input_conflicts from public, anon, authenticated;
grant select on public.client_input_conflicts to authenticated;
grant all on public.client_input_conflicts to service_role;
create policy client_input_conflicts_select on public.client_input_conflicts for select to authenticated using (client_id = any(public.auth_client_ids()));
