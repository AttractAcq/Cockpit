-- Programme Stage C3b: claim-level traceability for context files.
-- The origin check constraint enforces, in the database, that every material
-- claim traces to exactly one of: client input, an uploaded source, a research
-- source, or a human-approved inference. Unsupported claims fail closed.

create table public.client_context_file_citations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  context_file_id uuid not null references public.client_context_files(id) on delete cascade,
  context_file_version integer not null,
  claim_excerpt text not null,
  source_type text not null,
  client_input_field text,
  source_document_id uuid references public.client_source_documents(id) on delete restrict,
  document_chunk_id uuid references public.client_document_chunks(id) on delete restrict,
  research_source_id uuid references public.client_research_sources(id) on delete restrict,
  inference_rationale text,
  inference_approved_by uuid references public.users(id) on delete set null,
  inference_approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint client_context_file_citations_excerpt_check check (length(claim_excerpt) between 1 and 4000),
  constraint client_context_file_citations_source_type_check check (source_type in ('client_input','source_document','research_source','approved_inference')),
  constraint client_context_file_citations_origin_check check (
    (source_type = 'client_input' and client_input_field is not null and source_document_id is null and research_source_id is null)
    or (source_type = 'source_document' and source_document_id is not null and research_source_id is null and client_input_field is null)
    or (source_type = 'research_source' and research_source_id is not null and source_document_id is null and client_input_field is null)
    or (source_type = 'approved_inference' and inference_rationale is not null and inference_approved_by is not null and inference_approved_at is not null and source_document_id is null and research_source_id is null and client_input_field is null)
  )
);
create index client_context_file_citations_file_idx on public.client_context_file_citations (context_file_id, context_file_version);
create index client_context_file_citations_client_idx on public.client_context_file_citations (client_id);
alter table public.client_context_file_citations enable row level security;
revoke all on public.client_context_file_citations from public, anon, authenticated;
grant select on public.client_context_file_citations to authenticated;
grant all on public.client_context_file_citations to service_role;
create policy client_context_file_citations_select on public.client_context_file_citations for select to authenticated using (client_id = any(public.auth_client_ids()));
