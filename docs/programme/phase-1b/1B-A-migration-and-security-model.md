# Stage 1B-A — Migration/Backfill Design and Security/Permission Model

## Migration design

### What does NOT need a schema change

Per the current-state inventory §3, `client_distribution_records`, `client_distribution_accounts`, and `client_analytics_records` already carry a free-text, unconstrained `platform` column defaulting to `'instagram'`. No `ALTER TABLE` is required to let a `'facebook'` value exist in any of these tables — this was verified by reading the live constraint list, not assumed.

### The one real gap found — deliberately NOT fixed this stage, and why

`public.distribution_publication_supported()` — the SQL-side trigger function backing `publish-capability.ts`'s comment about defence-in-depth — never checks `platform` (current-state inventory §2). Today this has **zero live blast radius**: nothing anywhere sets `platform` to anything but `'instagram'`, so the gap cannot currently be exercised.

Closing it turned out to be more invasive than a documentation-stage fix should attempt. Tracing every real caller: the function is invoked by `enforce_distribution_publish_capability` (the `BEFORE INSERT/UPDATE` trigger on `client_distribution_records` itself), by `claim_due_distribution_records` (the atomic, `FOR UPDATE SKIP LOCKED` claim query the live scheduled-publishing worker runs every minute for every client), and by `block_unsupported_scheduled_distribution` (the sweep that fails records whose eligibility changed after scheduling). Three real overloads exist across two migrations with their own `REVOKE`/`GRANT` pairs. Adding a `platform` parameter correctly means touching the live worker's claim query — the single most sensitive piece of code in the entire organic-distribution pipeline, carrying every real client's real Instagram publishing today.

Given the gap's current blast radius is zero, and this stage's own exit gate reads "no Facebook credential or publishing implementation begins until the destination, rendition, publication and verification contracts are canonical and tested" — touching live worker-claim SQL under an audit-and-contracts-only stage was judged the wrong trade. **Recommended instead as 1B-B's first "expand" step**, at the exact point a real `'facebook'` platform value is about to be written into `client_distribution_accounts`/`client_distribution_records` for the first time — when the gap's blast radius stops being zero and closing it stops being purely precautionary. 1B-B should add the `platform` parameter to all three call sites in one additive migration, verify via a disposable Instagram-platform fixture that the existing worker claim behaviour is provably unchanged, and only then verify a `'facebook'`-platform fixture is correctly rejected until 1B-D's publisher exists.

### Expand → mirror/backfill → cut over → contract, applied to the rest of Phase 1-B

No mirror/backfill/cutover/contract step happens in 1B-A — there is nothing to migrate yet, since no Facebook data exists. The discipline this stage establishes for later stages:

1. **Expand (1B-B):** add real Facebook Page destination rows to `client_distribution_accounts` (schema already supports it), add Facebook-specific columns to `client_distribution_records` only if the canonical domain contract (below) proves the existing jsonb `publish_payload`/`publish_settings` columns are insufficient — the contract is deliberately designed to avoid needing new columns where the existing generic ones already carry the right shape.
2. **Mirror/backfill (1B-C/1B-D):** never applicable in the traditional sense here — Facebook renditions are new records, not migrated versions of existing Instagram records. Each canonical Content Item gains an *additional* `client_distribution_records` row (platform=`facebook`) alongside its existing Instagram row, never replacing it.
3. **Cut over:** N/A — Instagram is not being replaced.
4. **Contract:** once Facebook publishing is live and stable (post-1B-D), remove any Instagram-only naming/comments that become misleading (e.g. `publish-instagram-asset`'s name), but only after the equivalent Facebook path is proven — tracked as 1B-F scope ("retire temporary compatibility paths"), not this stage's.

## Security and permission model

### Credential storage — extends the existing pattern, does not replace it

The existing Vault-backed credential pattern (`readCredential(sb, clientSlug, "META", "SYSTEM_USER_TOKEN")`, with global/env fallbacks) already reads a **Meta** system-user token, not an Instagram-specific one — because Instagram Business publishing itself goes through Facebook's identity layer. This means the credential *storage* mechanism likely needs no new pattern for Facebook — the same Meta system-user token, once granted the additional Page-scoped permissions (`pages_manage_posts`, `pages_read_engagement`, `pages_show_list`), can plausibly serve both. **Not confirmed live this stage** (would require a real token with real Page permissions to test) — flagged as the first real thing 1B-B's live testing must verify, not assumed.

### Permission model gap: Meta's Page task-capability model vs. Cockpit's assumption

Meta's Page publishing permissions now include a per-user, per-Page **task capability** (`CREATE_CONTENT`), layered on top of the app-level OAuth scopes (`pages_manage_posts` etc.) — a two-tier model. The existing Instagram integration's `resolveMetaConfig` only checks for token/IG-user-id presence, not task-level capability, because Instagram Business publishing doesn't use this same task model. A Facebook Page integration needs an explicit capability check (or at minimum, a well-classified failure path when the token lacks `CREATE_CONTENT` on the target Page) — this is a real, new failure mode. `meta-errors.ts`'s real, existing `MetaErrorCategory` union (`meta_authentication`, `meta_rate_limited`, `meta_server_error`, `meta_publish_failed`, etc.) has no permission-specific category today — a `CREATE_CONTENT`-missing response would currently fall through to the generic `meta_publish_failed` fallback via `classifyMetaError`'s catch-all. Whether that's precise enough or Facebook needs its own `meta_permission_denied` category is a real open question for 1B-B, to be settled against a real 403 response body, not guessed at here.

### Client isolation

No new isolation concern: Facebook Page destinations follow the exact same `client_distribution_accounts` row-per-client model Instagram destinations already use, under the same RLS policies (verified clean across all 133 tables in Stage P's hardening pass, `client_distribution_accounts` included). Nothing about adding a `platform` value changes the isolation boundary.

### Fabrication and verification discipline (unchanged, restated for this stage)

Every rule already governing Instagram publishing carries forward unchanged: never report provider acceptance as verified publication, never mark a record `published` without a real Meta success response, never log tokens or signed URLs, credentials checked before any provider call. Nothing in this stage's design weakens any of these for either platform.
