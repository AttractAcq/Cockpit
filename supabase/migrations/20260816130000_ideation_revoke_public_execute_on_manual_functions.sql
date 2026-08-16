-- Corrective migration (do not edit the two migrations below in place).
--
-- commit_manual_content (20260815120000) and
-- distribute_content_items_to_calendar (20260816120000) each revoked EXECUTE
-- from anon/authenticated explicitly, but PostgreSQL grants EXECUTE to the
-- PUBLIC pseudo-role by default on function creation -- every role,
-- including anon and authenticated, inherits it through that PUBLIC grant
-- regardless of a per-role revoke. Both functions fail closed internally
-- (they reject any caller whose auth.role() isn't service_role), so this was
-- never actually exploitable, but the database layer should enforce it too,
-- not just the function body. Found via get_advisors after Phase 2 deploy.

revoke all on function public.commit_manual_content(uuid, uuid, text, text, text, text, text, text, date, text, uuid) from public;
revoke all on function public.distribute_content_items_to_calendar(uuid, uuid, jsonb) from public;
