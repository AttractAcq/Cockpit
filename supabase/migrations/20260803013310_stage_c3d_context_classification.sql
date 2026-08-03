-- Programme Stage C3d: context versus strategy separation.
-- Nullable and deliberately NOT backfilled: the existing 21 approved context
-- rows keep their current meaning until an operator classifies them, so no
-- approved client file is silently invalidated.

alter table public.client_context_files add column classification text;
alter table public.client_context_files add constraint client_context_files_classification_check
  check (classification is null or classification in ('business_context','client_strategic_system','hybrid'));
comment on column public.client_context_files.classification is 'Stage C context/strategy separation: business_context, client_strategic_system or hybrid. Null means not yet classified; existing rows are deliberately not backfilled.';
