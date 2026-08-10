-- Phase 2A evidence-origin compatibility.
--
-- Later intelligence domains consume immutable records from approved upstream
-- OS releases. Those records are inspectable structured observations, but they
-- do not own a client_research_sources row in the downstream research run. The
-- original foundation constraint only admitted source-backed observations and
-- therefore rejected valid Market -> Avatar -> Competitor -> Association ->
-- Brand Strategist traceability.
--
-- Preserve the existing source, Context, and client-input rules. Add only the
-- missing upstream-release origin, which must carry a complete immutable record
-- locator. Application authority loading continues to enforce same-client and
-- approved-release ownership before these rows are inserted.

alter table public.client_evidence_records
  drop constraint if exists client_evidence_records_origin_check;

alter table public.client_evidence_records
  add constraint client_evidence_records_origin_check check (
    (source_type = 'research_source'
      and research_source_id is not null
      and context_file_id is null
      and client_input_field is null)
    or
    (source_type = 'context_file'
      and research_source_id is null
      and context_file_id is not null
      and client_input_field is null)
    or
    (source_type = 'client_input'
      and research_source_id is null
      and context_file_id is null
      and nullif(trim(client_input_field), '') is not null)
    or
    (source_type = 'structured_observation'
      and context_file_id is null
      and client_input_field is null
      and (
        research_source_id is not null
        or (
          research_source_id is null
          and locator ->> 'upstream_domain' in (
            'market_os',
            'avatar_os',
            'competitor_os',
            'association_os',
            'brand_strategist'
          )
          and nullif(trim(locator ->> 'release_id'), '') is not null
          and nullif(trim(locator ->> 'record_key'), '') is not null
        )
      ))
  ) not valid;

alter table public.client_evidence_records
  validate constraint client_evidence_records_origin_check;

comment on constraint client_evidence_records_origin_check on public.client_evidence_records is
  'Exactly one inspectable evidence origin: research source, Context file, client input, or a fully located immutable upstream OS record.';
