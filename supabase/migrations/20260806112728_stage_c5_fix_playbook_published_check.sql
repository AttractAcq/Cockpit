-- Stage C fix: playbook_versions_published_check was written as a
-- biconditional — (status = 'active') = (published_at is not null and
-- published_by is not null). That made superseding impossible without erasing
-- the publication record, which destroys the audit trail the immutable version
-- history exists to provide.
--
-- Corrected to state the real rule per status:
--   draft       -> never published
--   active      -> published, with publisher and timestamp
--   superseded  -> was published, and RETAINS its publication record

alter table public.playbook_versions
  drop constraint playbook_versions_published_check;

alter table public.playbook_versions
  add constraint playbook_versions_published_check check (
    (status = 'draft' and published_at is null and published_by is null)
    or (status = 'active' and published_at is not null and published_by is not null)
    or (status = 'superseded' and published_at is not null and published_by is not null)
  );

comment on constraint playbook_versions_published_check on public.playbook_versions is
  'A draft is never published; an active version carries publisher and timestamp; a superseded version retains its original publication record.';
