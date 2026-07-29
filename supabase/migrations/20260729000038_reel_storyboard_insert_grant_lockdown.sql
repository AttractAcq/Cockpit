-- Corrective, additive: lock `insert_reel_storyboard_if_empty` back down to
-- service_role only.
--
-- Defect this fixes, found by post-deploy verification of 20260729000037:
--   That migration recreated the function with DROP FUNCTION + CREATE FUNCTION
--   in order to add trailing DEFAULT NULL parameters. A dropped-and-recreated
--   function is a NEW function object, so it inherited this project's
--   ALTER DEFAULT PRIVILEGES grants of EXECUTE to `anon` and `authenticated`.
--   The `REVOKE ... FROM PUBLIC` in that migration does not remove an explicit
--   role grant, so both survived.
--
--   The function is SECURITY DEFINER and writes video_shots / video_projects,
--   so an explicit EXECUTE grant to anon or authenticated bypasses RLS. Every
--   other Reel write RPC (create_bound_reel_video_project,
--   regenerate_pending_reel_shot, delete_pending_reel_shot, the final-Reel
--   RPCs) is service_role-only; this restores that invariant.
--
--   `regenerate_pending_reel_shot` was unaffected because it was updated with
--   CREATE OR REPLACE, which preserves the existing grants on the function.
--
-- No schema, data, or function body changes here — permissions only.

revoke execute on function public.insert_reel_storyboard_if_empty(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, text, text
) from anon, authenticated, public;

grant execute on function public.insert_reel_storyboard_if_empty(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, text, text
) to service_role;
