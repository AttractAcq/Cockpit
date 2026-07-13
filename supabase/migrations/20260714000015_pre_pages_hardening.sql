-- Pre-Pages hardening (additive). No RLS policy is weakened; no table grant is
-- broadened. Fixes the advisor findings that matter before the operator surface
-- is published to a public GitHub Pages URL. HELD — do not apply until reviewed.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. client_health_v — stop bypassing RLS.
--    The view is SECURITY DEFINER (default) and owned by postgres, so it returns
--    rows regardless of the caller's RLS. Verified: an anonymous caller reads 1
--    row (client name/tier/status/health). Switching to security_invoker makes
--    the *caller's* RLS on the underlying tables apply. Definition/columns are
--    unchanged — this only flips the option, so output shape is preserved.
alter view public.client_health_v set (security_invoker = true);

-- Remove the stray Supabase default CRUD grants to anon; drop write grants from
-- authenticated (a view is not the write path). authenticated retains SELECT —
-- the operator UI reads this view (src/lib/api.ts, src/lib/api/clients.ts) — and
-- security_invoker now scopes it: staff see all clients, a client-user sees only
-- their own row, anon sees nothing. service_role is unchanged.
revoke all on public.client_health_v from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.client_health_v from authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Lock down SECURITY DEFINER functions that no RLS policy and no UI path
--    depends on (verified: zero RLS policies reference generate_ref; no rpc
--    caller in the codebase for either).
--    generate_ref mutates ref_counters — an anon/authenticated caller could burn
--    ref numbers. handle_new_user is a signup trigger and must not be RPC-callable.
revoke execute on function public.generate_ref(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.generate_ref(uuid, text, text) to service_role;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
-- The trigger still fires: trigger functions execute via the trigger mechanism
-- as the function owner (postgres), independent of any role's EXECUTE grant.

-- NOTE — auth_role() and auth_client_ids() are intentionally NOT modified here.
-- RLS policies on ~every table call them, so `authenticated` MUST retain EXECUTE
-- or all signed-in reads fail. They are caller-scoped (return only the caller's
-- own role / client ids) and already have search_path=public, so anon executing
-- them leaks nothing. Revoking anon is a separate, behavior-changing decision
-- (anon table reads would raise "permission denied for function" instead of
-- returning zero rows) — see the review's "REQUIRES DESIGN DECISION".

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Pin search_path on the four flagged helpers. Every reference in their
--    bodies is either fully schema-qualified (public.*) or a built-in
--    (now/count in pg_catalog, always implicitly searched), so '' is
--    behavior-preserving and closes the mutable-search_path vector.
alter function public.set_updated_at() set search_path = '';
alter function public.claim_next_asset_generation_item(uuid) set search_path = '';
alter function public.requeue_stale_asset_generation_items(uuid, interval) set search_path = '';
alter function public.claim_next_phase3_scope_item(uuid) set search_path = '';
