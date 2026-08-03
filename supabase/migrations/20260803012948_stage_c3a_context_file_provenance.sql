-- Programme Stage C3a: which frozen playbook authority produced a context file.
-- Recording playbook_version_id plus the content hash at generation time is what
-- prevents a stale playbook from silently replacing locked authority.

create table public.client_context_file_playbooks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  context_file_id uuid not null references public.client_context_files(id) on delete cascade,
  context_file_version integer not null,
  playbook_id uuid not null references public.playbooks(id) on delete restrict,
  playbook_version_id uuid not null references public.playbook_versions(id) on delete restrict,
  playbook_version integer not null,
  playbook_content_hash text not null,
  applied_sections jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint client_context_file_playbooks_hash_check check (playbook_content_hash ~ '^[0-9a-f]{64}$'),
  constraint client_context_file_playbooks_sections_check check (jsonb_typeof(applied_sections) = 'array'),
  constraint client_context_file_playbooks_unique unique (context_file_id, context_file_version, playbook_version_id)
);
create index client_context_file_playbooks_client_idx on public.client_context_file_playbooks (client_id);
alter table public.client_context_file_playbooks enable row level security;
revoke all on public.client_context_file_playbooks from public, anon, authenticated;
grant select on public.client_context_file_playbooks to authenticated;
grant all on public.client_context_file_playbooks to service_role;
create policy client_context_file_playbooks_select on public.client_context_file_playbooks for select to authenticated using (client_id = any(public.auth_client_ids()));
