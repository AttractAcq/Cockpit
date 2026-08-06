-- Stage C fix: the original locator check assumed every source document came
-- from storage or a URL. An operator pasting text (a review, a customer email,
-- a sales note) has neither, and would have been rejected. Widen the check to
-- accept inline text as a third legitimate locator.

alter table public.client_source_documents
  drop constraint client_source_documents_locator_check;

alter table public.client_source_documents
  add constraint client_source_documents_locator_check
  check (storage_path is not null or source_url is not null or extracted_text is not null);

comment on constraint client_source_documents_locator_check on public.client_source_documents is
  'A document must be locatable: stored file, external URL, or inline pasted text.';
