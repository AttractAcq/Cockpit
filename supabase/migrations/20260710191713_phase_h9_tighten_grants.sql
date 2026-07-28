-- Phase H9 (grant hardening): the apply RPCs are invoked ONLY by the service role
-- from the Edge Functions, so strip Supabase's default `authenticated` EXECUTE and
-- the default PUBLIC EXECUTE on the published-check helper. Service role retains
-- what the functions need. No behavior change; defense-in-depth only.
REVOKE EXECUTE ON FUNCTION public.apply_delete_asset(uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_delete_phase3_content(uuid, uuid, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_reject_asset(uuid, uuid, text, uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_reject_content_brief(uuid, uuid, uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.phase_ref_is_published(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase_ref_is_published(uuid, text) TO service_role;
