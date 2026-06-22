-- P1 security lockdown (reconciliation report §9.1 / CLAUDE.md open item #7)
-- Corrected from live introspection 2026-06-22:
--   * increment_ad_lead was granted to PUBLIC (the real hole — anon inherits it),
--     and had a mutable (null) search_path. Revoke PUBLIC/anon/authenticated and pin.
--   * trg_lead_score_before/after already have search_path=public pinned; they only
--     need their PUBLIC/authenticated RPC exposure revoked. Triggers still fire
--     normally (they run as the table owner, independent of EXECUTE grants).
--   * auth_role/auth_entity_ids/auth_team_id are intentionally EXECUTE-able by
--     authenticated (RLS helpers) and already pinned — left untouched.
-- service_role / postgres retain EXECUTE; increment_ad_lead's only caller is
-- meta-webhook under the service role, which bypasses these grants.

-- increment_ad_lead: close anon/public/authenticated RPC + pin search_path
REVOKE EXECUTE ON FUNCTION public.increment_ad_lead(uuid, date) FROM PUBLIC, anon, authenticated;
ALTER  FUNCTION public.increment_ad_lead(uuid, date) SET search_path = public;

-- lead-score trigger functions: revoke RPC exposure (search_path already pinned)
REVOKE EXECUTE ON FUNCTION public.trg_lead_score_before() FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_lead_score_after()  FROM PUBLIC, authenticated;
