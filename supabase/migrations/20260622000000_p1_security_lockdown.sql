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
-- The production object was absent by July 2026, but older environments may still
-- have it. Keep the hardening when the exact legacy function exists.
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.increment_ad_lead(uuid,date)') IS NOT NULL THEN
    EXECUTE
      'REVOKE EXECUTE ON FUNCTION public.increment_ad_lead(uuid, date)
       FROM PUBLIC, anon, authenticated';

    EXECUTE
      'ALTER FUNCTION public.increment_ad_lead(uuid, date)
       SET search_path = public';
  END IF;
END
$$;

-- lead-score trigger functions: revoke RPC exposure (search_path already pinned)
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.trg_lead_score_before()') IS NOT NULL THEN
    EXECUTE
      'REVOKE EXECUTE ON FUNCTION public.trg_lead_score_before()
       FROM PUBLIC, authenticated';
  END IF;

  IF pg_catalog.to_regprocedure('public.trg_lead_score_after()') IS NOT NULL THEN
    EXECUTE
      'REVOKE EXECUTE ON FUNCTION public.trg_lead_score_after()
       FROM PUBLIC, authenticated';
  END IF;
END
$$;
