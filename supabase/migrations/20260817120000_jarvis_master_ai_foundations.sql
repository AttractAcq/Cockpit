-- Master AI ("Jarvis") foundations: a client-scoped agent with tool-calling
-- access across the app, driven from a chat page.
--
-- Four tables, deliberately NOT reusing client_research_runs/client_research_
-- steps (the Intelligence Agent run tables) -- those carry domain-specific
-- CHECK constraints and their own release/approval semantics that don't fit
-- a general-purpose agent. Modeled on the same shape (lease-claimable run,
-- ordered transcript, RLS SELECT-only-to-authenticated / ALL-to-service_role)
-- established by client_research_runs and client_distribution_policies.
--
-- Safety boundary, enforced in application code (the jarvis-turn edge
-- function), not by this schema alone: client_jarvis_settings.autonomous_mode
-- governs INTERNAL review gates only (approving a Source, Brief, asset
-- group, Ad Opportunity/Brief/Campaign draft). Real-world-facing actions
-- (launching a paid ad campaign, publishing or scheduling a real post) are a
-- hard floor -- always land in client_agent_pending_actions with
-- gate='floor', regardless of this setting. That floor is hardcoded in the
-- tool dispatcher, not stored data, so it can't be changed by editing this
-- table.

create table public.client_jarvis_settings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  autonomous_mode boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_jarvis_settings_client_unique unique (client_id)
);
create trigger client_jarvis_settings_updated_at before update on public.client_jarvis_settings
  for each row execute function public.set_updated_at();

create table public.client_agent_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 400),
  status text not null default 'running',
  -- Snapshot of the toggle at run start. A run already in flight must not
  -- change behavior because someone flipped the setting mid-run.
  autonomous_mode boolean not null default false,
  lease_owner text,
  lease_expires_at timestamptz,
  turn_count integer not null default 0 check (turn_count >= 0),
  failure_message text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint client_agent_runs_status_check check (status in (
    'running', 'waiting_human', 'completed', 'failed', 'cancelled'
  )),
  constraint client_agent_runs_completed_check check (
    (status in ('completed', 'failed', 'cancelled')) = (completed_at is not null)
  )
);
create index client_agent_runs_client_idx on public.client_agent_runs (client_id, created_at desc);
create trigger client_agent_runs_updated_at before update on public.client_agent_runs
  for each row execute function public.set_updated_at();

create table public.client_agent_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  run_id uuid not null references public.client_agent_runs(id) on delete cascade,
  turn_order integer not null check (turn_order >= 1),
  role text not null,
  content text,
  tool_use_id text,
  tool_name text,
  tool_input jsonb,
  tool_output jsonb,
  created_at timestamptz not null default now(),
  constraint client_agent_messages_role_check check (role in ('user', 'assistant', 'tool')),
  constraint client_agent_messages_run_order_unique unique (run_id, turn_order)
);
create index client_agent_messages_run_idx on public.client_agent_messages (run_id, turn_order);

create table public.client_agent_pending_actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  run_id uuid not null references public.client_agent_runs(id) on delete cascade,
  tool_use_id text not null,
  tool_name text not null,
  tool_input jsonb not null default '{}'::jsonb,
  -- 'floor': hardcoded in the dispatcher, never bypassable by the toggle.
  -- 'toggle': only pending because autonomous_mode was off for this run.
  gate text not null,
  reason text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  resolution_note text,
  constraint client_agent_pending_actions_gate_check check (gate in ('floor', 'toggle')),
  constraint client_agent_pending_actions_status_check check (status in (
    'pending', 'approved', 'rejected', 'expired'
  )),
  constraint client_agent_pending_actions_resolved_check check (
    (status in ('approved', 'rejected')) = (resolved_at is not null and resolved_by is not null)
  ),
  constraint client_agent_pending_actions_tool_use_unique unique (run_id, tool_use_id)
);
create index client_agent_pending_actions_run_idx on public.client_agent_pending_actions (run_id);
create index client_agent_pending_actions_pending_idx on public.client_agent_pending_actions (client_id, status)
  where status = 'pending';

-- RLS: identical pattern across all four tables, matching
-- client_distribution_policies -- SELECT-only to authenticated (scoped by
-- auth_client_ids()), ALL to service_role. Every write happens inside the
-- staff-gated edge functions (set-jarvis-settings, jarvis-turn).
alter table public.client_jarvis_settings enable row level security;
alter table public.client_agent_runs enable row level security;
alter table public.client_agent_messages enable row level security;
alter table public.client_agent_pending_actions enable row level security;

revoke all on public.client_jarvis_settings from public, anon, authenticated;
revoke all on public.client_agent_runs from public, anon, authenticated;
revoke all on public.client_agent_messages from public, anon, authenticated;
revoke all on public.client_agent_pending_actions from public, anon, authenticated;

grant select on public.client_jarvis_settings to authenticated;
grant select on public.client_agent_runs to authenticated;
grant select on public.client_agent_messages to authenticated;
grant select on public.client_agent_pending_actions to authenticated;

grant all on public.client_jarvis_settings to service_role;
grant all on public.client_agent_runs to service_role;
grant all on public.client_agent_messages to service_role;
grant all on public.client_agent_pending_actions to service_role;

create policy client_jarvis_settings_select on public.client_jarvis_settings
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_agent_runs_select on public.client_agent_runs
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_agent_messages_select on public.client_agent_messages
  for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_agent_pending_actions_select on public.client_agent_pending_actions
  for select to authenticated using (client_id = any(public.auth_client_ids()));
