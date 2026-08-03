-- Programme Stage C1: structured source ingestion and document processing.
-- Additive only. Replaces reliance on the unstructured
-- public.client_inputs.uploaded_file_refs jsonb blob with real file records.
-- Nothing existing is altered or removed.

create table public.client_source_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source_kind text not null,
  original_filename text,
  source_url text,
  storage_bucket text,
  storage_path text,
  mime_type text,
  byte_size bigint,
  content_hash text not null,
  extracted_text text,
  extracted_metadata jsonb not null default '{}'::jsonb,
  processing_status text not null default 'pending',
  failure_code text,
  failure_message text,
  attempt_count integer not null default 0,
  maximum_attempts integer not null default 3,
  processed_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_source_documents_kind_check
    check (source_kind in ('client_form','uploaded_document','website_page','service_page','review','existing_marketing','sales_document','offer_document','brand_document','competitor_reference','project_proof')),
  constraint client_source_documents_hash_check check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint client_source_documents_status_check
    check (processing_status in ('pending','extracting','extracted','failed','skipped')),
  constraint client_source_documents_attempts_check
    check (attempt_count >= 0 and maximum_attempts >= 1 and attempt_count <= maximum_attempts),
  constraint client_source_documents_failure_check
    check (processing_status <> 'failed' or failure_code is not null),
  constraint client_source_documents_extracted_check
    check (processing_status <> 'extracted' or (extracted_text is not null and processed_at is not null)),
  constraint client_source_documents_locator_check
    check (storage_path is not null or source_url is not null),
  constraint client_source_documents_dedupe unique (client_id, content_hash)
);
create index client_source_documents_client_status_idx on public.client_source_documents (client_id, processing_status);

create table public.client_document_chunks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source_document_id uuid not null references public.client_source_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  content_hash text not null,
  char_count integer not null,
  locator jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint client_document_chunks_index_check check (chunk_index >= 0),
  constraint client_document_chunks_content_check check (length(content) between 1 and 100000),
  constraint client_document_chunks_hash_check check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint client_document_chunks_count_check check (char_count > 0),
  constraint client_document_chunks_unique unique (source_document_id, chunk_index)
);
create index client_document_chunks_client_idx on public.client_document_chunks (client_id);

create trigger client_source_documents_updated_at before update on public.client_source_documents for each row execute function public.set_updated_at();

alter table public.client_source_documents enable row level security;
alter table public.client_document_chunks enable row level security;
revoke all on public.client_source_documents from public, anon, authenticated;
revoke all on public.client_document_chunks from public, anon, authenticated;
grant select on public.client_source_documents to authenticated;
grant select on public.client_document_chunks to authenticated;
grant all on public.client_source_documents to service_role;
grant all on public.client_document_chunks to service_role;
create policy client_source_documents_select on public.client_source_documents for select to authenticated using (client_id = any(public.auth_client_ids()));
create policy client_document_chunks_select on public.client_document_chunks for select to authenticated using (client_id = any(public.auth_client_ids()));
