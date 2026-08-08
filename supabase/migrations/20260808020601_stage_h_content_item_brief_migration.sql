-- Programme Stage H — Content Item and Brief Migration.
--
-- Additive only. Stage B already owns content_briefs (client_id,
-- content_item_id, brief_version, status, body jsonb) and content_item_proof
-- as unused skeletons — this migration adds the two small columns needed to
-- make the Content Item the visible canonical parent of its current Brief,
-- and to store the rendered human-readable Markdown alongside the
-- structured body, without redefining any ownership Stage B already locked.
--
-- Stage H's own prompt describes a 5-state Brief lifecycle
-- (pending -> generated -> review -> approved -> superseded). Stage B
-- already shipped a 4-state one (draft, in_review, approved, superseded)
-- with a live CHECK constraint. Per "do not redesign a completed earlier
-- stage," this migration keeps Stage B's 4 states; "pending" and
-- "generated" both collapse into "draft" and are distinguished instead by
-- whether provider/model/prompt_digest are set (generated) or null
-- (manually drafted) — see the Stage H implementation report.

alter table public.content_briefs
  add column rendered_markdown text;

alter table public.content_items
  add column current_content_brief_id uuid references public.content_briefs(id) on delete set null;
