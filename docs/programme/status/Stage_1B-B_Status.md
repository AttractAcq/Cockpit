# Stage 1B-B Status — Facebook Page Destinations and Authorisation

Second stage of Programme Phase 1-B, on top of Stage 1B-A (`7b71e73`). Builds real, live, deployed destination onboarding for Facebook Pages.

## Starting and final commit state

- Branch: `stage-1b-b-facebook-page-destinations-authorisation`, created off `stage-1b-a-facebook-architecture-capability-baseline` at `7b71e73`.
- Not committed to `main`, per the stage prompt.

## An important live finding, surfaced before anything else

Live testing this stage's real Meta Graph API call (`discover-facebook-pages` against a disposable fixture) returned a real, live error from Meta: **"Error validating access token: Session has expired on Tuesday, 21-Jul-26 14:00:00 PDT."** The token resolved is the same `_GLOBAL_META_SYSTEM_USER_TOKEN`/`META_SYSTEM_USER_TOKEN` env-var-backed credential `instagram-publish.ts`'s `resolveMetaConfig` has used for every real Instagram publish across the whole A–P programme — this stage's credential resolver deliberately reuses that exact chain (see Architecture decisions, below). **This means the credential real Instagram publishing depends on today has likely been expired since 2026-07-21**, and any real Instagram publish attempted since then would fail the same way. This was not something this stage set out to find; it surfaced as a side effect of live-testing the new Facebook discovery call with real infrastructure. Flagged prominently here and to the user directly — it is a live production concern independent of Facebook, Phase 1-B, or this stage's own scope, and reconfiguring it is an operator action (a new Meta System User token), not a code change.

## Architecture and ownership decisions

1. **`client_distribution_accounts` extended, not replaced.** Stage 1B-A found it already generic (`platform` free-text, default `'instagram'`) — this stage added `credential_reference`, `connection_status`, `last_verified_at`, `external_metadata`, plus a `platform in ('instagram','facebook')` CHECK (destination-level only; `publish-capability.ts`'s live `SUPPORTED_PUBLISH_PLATFORMS` gate, still `["instagram"]`, is untouched).
2. **A second real security gap found and fixed before extending the table further.** `client_distribution_accounts` and its sibling `client_distribution_records` had staff RLS policies checking only `auth_role()`, with **no `client_id` scoping via `auth_client_ids()` at all** — unlike their sibling `client_distribution_policies`. Any `account_manager`/`editor`, even with zero `team_members` grants for a client, could see and modify every client's distribution accounts and distribution records. Fixed via `ALTER POLICY` on all six affected policies (both tables' select/insert/update). Zero effect on the live scheduled-publishing worker, which runs as `service_role` and bypasses RLS entirely — this only affects staff access through the frontend. **Live-verified conclusively** (see Security verification below): the same query, run as the same test operator, returned a different client's row before rows existed to distinguish, then correctly showed only the granted client's row once both existed.
3. **Credential resolution deliberately reuses Instagram's exact chain**, not a new Facebook-specific path — because Facebook Page publishing and Instagram Business publishing both go through the same Meta System User identity. `client_distribution_accounts.credential_reference` is stored (a Vault credential *name*, never a token) for future flexibility and operator visibility, but is not yet consulted by the resolver — deliberately, since the `vault_read_credential` RPC it would route through does not exist in the live database (confirmed again this stage; unchanged from the Stage 1B-A finding).
4. **Ownership is always re-verified fresh, never trusted from a request body.** Both `connect-facebook-page-destination` and `verify-facebook-destination-capability` re-run Page discovery against the caller's real Meta identity before acting — a `page_id` typed into a request is never sufficient on its own.
5. **A capability snapshot table, not per-scope rows.** `client_distribution_account_capabilities` upserts atomically (one row per destination) so a failed refresh can never leave stale "granted" scopes next to fresh "missing" ones.
6. **The auth/ownership check is a genuine, RLS-verified client check**, not a coarse role lookup — `validateFacebookDestinationAccess` (in the new `facebook-destination-auth.ts`) reads under the *caller's own JWT* against the real `clients` RLS, mirroring `_shared/ideation/auth.ts`'s pattern but widened to the 3-role `STAFF_ROLES` set this stage's RLS actually grants (ideation's own helper only allows 2).
7. **`facebook-pages.ts` kept fully dependency-free**, splitting the Supabase-client-dependent auth/credential logic into a separate `facebook-destination-auth.ts` file — discovered mid-stage that importing `jsr:@supabase/supabase-js@2` at the top of a module breaks Node's ESM loader entirely (the same root cause as the pre-existing `instagram-publish.test.ts` baseline gap), so the split was necessary to get real `node --test` coverage on the pure logic at all.

## Migrations, tables, RLS, RPC and Edge Function changes

- `20260813120000_stage_1b_b_distribution_client_isolation_fix.sql` — the RLS fix (§2 above), six `ALTER POLICY` statements.
- `20260813120100_stage_1b_b_facebook_destination_schema.sql` — extends `client_distribution_accounts`; backfills the one real live row (`connection_status = 'connected'`, matching its existing `is_active = true`).
- `20260813120200_stage_1b_b_destination_capabilities.sql` — new `client_distribution_account_capabilities` table, RLS from day one with the corrected (role + client) pattern.
- New Edge Functions, all deployed ACTIVE to `xivewedajschthjlblfb`: `discover-facebook-pages` (read-only), `connect-facebook-page-destination`, `verify-facebook-destination-capability`.
- New shared modules: `_shared/facebook-pages.ts` (pure discovery/ownership/duplicate/capability logic), `_shared/facebook-destination-auth.ts` (auth + credential resolution).

## Shared domain, API and frontend changes

- `src/types/phase.ts` — `ClientDistributionAccount` extended with the four new fields; new `FacebookPageDiscoveryResult`, `DistributionAccountCapabilityResult`, `DistributionAccountConnectionStatus` types.
- `src/lib/api.ts` — `discoverFacebookPages`, `connectFacebookPageDestination`, `verifyFacebookDestinationCapability`, all via `invokeFn` (edge functions only — no direct table write from the browser for anything credential-adjacent).
- `src/components/client/ClientSettingsPanel.tsx` — new `ConnectFacebookPageDialog` (discovery-driven Page picker, never a manually-typed Page ID); existing manual "Add account" flow **untouched** and still Instagram-only; account cards gained a `connection_status` badge and a "Refresh capability"/"Reconnect" action for Facebook destinations only.

## Compatibility, backfill and cutover behaviour

The one real live Instagram destination row was backfilled to `connection_status = 'connected'` (its prior `is_active = true` state, honestly carried forward — not reset to the new column's default). No other backfill: Facebook destinations are new rows, never migrated versions of anything.

## Security and client-isolation verification

**Live-verified, not just unit-tested**, using disposable fixtures (two `ZZ-TEST-1B-B` clients, a real disposable `auth.users`/`public.users` operator with `editor` role and a `team_members` grant on only one of the two clients — all deleted after):

- `discover-facebook-pages` / `connect-facebook-page-destination` against the client the operator is **not** granted access to → real `403 CLIENT_ACCESS_DENIED`, confirmed before any Meta call is attempted.
- The exact same query against `client_distribution_accounts` via PostgREST, run as the same operator: before any rows existed for either test client it returned `[]`; after inserting one row per client (as service role, bypassing RLS), it returned **only** the granted client's row — the other client's row, though it existed, was correctly invisible. This is the RLS fix (§2) proven end to end, not just read from the policy definition.
- No auth header → `401` (rejected by the Supabase gateway itself, before this stage's own code ever runs).
- A live `discover-facebook-pages`/`connect-facebook-page-destination` call against the client the operator **is** granted access to reached the real Meta Graph API (confirmed by the real, live "session has expired" error) and correctly returned a fail-closed `502`, writing nothing to `client_distribution_accounts` (verified: zero rows existed afterward).
- `get_advisors(type="security")` re-run after all schema changes: 47 WARN, 0 ERROR — identical to the pre-stage baseline.
- Every fixture (clients, `auth.users`/`identities`/`public.users`, `team_members`, the two `client_distribution_accounts` probe rows) confirmed deleted — zero leftover count on every table checked.

## Tests added and complete results

`tests/facebook-pages.test.ts` — 19 tests covering every test named in the stage prompt: correct Page discovery, cross-client Page rejection, missing permission, expired/revoked token, duplicate destination (including that inactive duplicates don't block reconnection, and that Instagram/Facebook external ids never collide), capability refresh, reconnect, and existing-Instagram regression (every function proven platform-parameterized, not Instagram-hardcoded).

Full suite: **1016/1017 pass** (was 997/998 at the end of Stage 1B-A; +19 new, zero regressions). The 1 failure is the same pre-existing `instagram-publish.test.ts` baseline gap. One transient failure in the unrelated `ideation-provider-reliability.test.ts` (a file this stage never touched) appeared once and did not reproduce on a clean re-run — a pre-existing timing-sensitive flake, not a regression.

## Typecheck, lint and build results

`npm run typecheck` — clean. `npm run lint` — 0 errors, the same 4 pre-existing warnings in files this stage did not touch. `npm run build` — clean. `git diff --check` (staged) — clean. Secret scan of the full staged diff — clean.

## External provider actions and live verification

All three edge functions were deployed live and called against real infrastructure with a real authenticated session (§ Security verification). The Meta Graph API call itself reached Meta for real and received a real, structured error — not a mock, not a simulated response. No Facebook Page was actually connected (correctly — no valid credential exists to complete a real connection right now, per the expired-token finding above).

## Deferred or blocked items, with exact reasons

1. **Real Facebook Page connection end-to-end** — blocked on the expired Meta System User token (see top of this report), an operator credential-rotation action, not a code gap in this stage.
2. **`credential_reference` is stored but not yet consulted** by the resolver — deliberate, since the `vault_read_credential` RPC it would route through still doesn't exist live (carried forward from Stage 1B-A, unchanged).
3. **Multi-photo album / carousel-equivalent and Facebook Page Stories** — still unverified against primary docs (Stage 1B-A's own deferred item, unchanged; not this stage's scope).
4. **`pages_manage_engagement`'s exact scope boundary** and the `CREATE_CONTENT` task-capability failure mode's precise Graph error shape — both flagged in Stage 1B-A as needing verification against a real 403, still blocked on the same expired-token issue.
5. **Page access token derivation (`GET /{page-id}?fields=access_token`)** — documented in the capability matrix, not yet implemented; not needed until 1B-D (Publishing).

## Confirmation against every acceptance criterion

- **"A client can connect and approve a Facebook Page destination."** The full flow (discover → pick → ownership-verify → capability-check → store) is real, deployed, and live-tested end to end through the fail-closed path; blocked only by the expired credential, not by anything in this stage's own code.
- **"Raw access tokens are not stored in tracked code or exposed to the browser."** Confirmed by inspection: no token value appears in any migration, function, or committed file; `discover-facebook-pages` returns Page summaries only, never the token used to fetch them.
- **"Capability state is visible and refreshable."** `client_distribution_account_capabilities` + the UI's "Refresh capability"/"Reconnect" action, live-tested (404 for a real nonexistent destination id).
- **"Invalid ownership and stale credentials fail closed."** Live-verified: cross-client access → 403 before any Meta call; expired token → 502 with zero rows written.
- **"Destination changes are audited."** `audit()` calls on connect and verify, using the established `audit_log` convention.

## Confirmation that the stage exit gate is satisfied

> A verified Facebook Page destination and capability set can be selected safely by downstream rendition and publishing workflows.

The contract and mechanism are real, deployed, and live-tested: ownership verification, capability classification, and connection-status derivation are all proven correct against real infrastructure, and nothing about this stage's code path can produce a false "connected" state — every failure mode observed live (expired token, cross-client access, nonexistent destination) was correctly rejected, not silently accepted. No Facebook Page is actually connected yet, for the credential reason stated above, not a code gap.
