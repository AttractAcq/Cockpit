-- Programme Stage E1: one source contract for all four supply streams.
-- Additive. content_sources (Stage B) gains raw capture, processing/retry state
-- and adapter linkage so Manual Ideas, Proof, Research Candidates and
-- Performance Insights all resolve to the same canonical source identity.
-- No source stream writes to the Calendar or production system.

alter table public.content_sources
  add column raw_content text,
  add column raw_content_hash text,
  add column processing_status text not null default 'pending',
  add column attempt_count integer not null default 0,
  add column maximum_attempts integer not null default 3,
  add column failure_code text,
  add column failure_message text,
  add column processed_at timestamptz,
  add column ideation_candidate_id uuid references public.client_ideation_candidates(id) on delete set null,
  add column performance_insight_id uuid references public.client_performance_insights(id) on delete set null,
  add column source_document_id uuid references public.client_source_documents(id) on delete set null,
  add column proof_item_id uuid references public.proof_items(id) on delete set null;

alter table public.content_sources
  add constraint content_sources_raw_hash_check
    check (raw_content_hash is null or raw_content_hash ~ '^[0-9a-f]{64}$'),
  add constraint content_sources_raw_pair_check
    check ((raw_content is null) = (raw_content_hash is null)),
  add constraint content_sources_processing_check
    check (processing_status in ('pending','processing','processed','failed','skipped')),
  add constraint content_sources_attempts_check
    check (attempt_count >= 0 and maximum_attempts >= 1 and attempt_count <= maximum_attempts),
  add constraint content_sources_failure_check
    check (processing_status <> 'failed' or failure_code is not null),
  add constraint content_sources_processed_check
    check ((processing_status = 'processed') = (processed_at is not null)),
  add constraint content_sources_adapter_check check (
    (source_kind = 'manual_idea' and ideation_candidate_id is null and performance_insight_id is null and proof_item_id is null)
    or (source_kind = 'proof_item' and ideation_candidate_id is null and performance_insight_id is null)
    or (source_kind = 'research_candidate' and performance_insight_id is null and proof_item_id is null)
    or (source_kind = 'performance_insight' and ideation_candidate_id is null and proof_item_id is null)
  );

create unique index content_sources_raw_dedupe
  on public.content_sources (client_id, raw_content_hash)
  where raw_content_hash is not null;
create unique index content_sources_ideation_candidate_unique
  on public.content_sources (ideation_candidate_id) where ideation_candidate_id is not null;
create unique index content_sources_performance_insight_unique
  on public.content_sources (performance_insight_id) where performance_insight_id is not null;

create or replace function public.prevent_raw_source_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
begin
  if old.raw_content is distinct from new.raw_content
     or old.raw_content_hash is distinct from new.raw_content_hash then
    raise exception 'content_sources.raw_content is immutable (source %)', old.id
      using errcode = 'restrict_violation';
  end if;
  if old.client_id is distinct from new.client_id then
    raise exception 'content_sources.client_id is immutable (source %)', old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$fn$;

create trigger content_sources_immutable_raw
  before update on public.content_sources
  for each row execute function public.prevent_raw_source_mutation();

comment on column public.content_sources.raw_content is 'Stage E: the raw source material exactly as captured. Immutable, enforced by trigger content_sources_immutable_raw.';
comment on index public.content_sources_raw_dedupe is 'Stage E duplicate source detection, scoped per client.';
