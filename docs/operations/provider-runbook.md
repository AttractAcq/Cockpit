# Provider Runbook

External providers Cockpit's edge functions integrate with, their real configuration state, and known failure modes. All calls to these providers happen exclusively from edge functions (`supabase/functions/`) — never from the frontend, per the golden architecture rule.

## Meta (Instagram publishing + Marketing API)

- **Instagram publishing** (organic): real, live, in production. `process-scheduled-publishing` → `publish-instagram-asset` / `instagram-reels-publish.ts`. Container-based publish flow (`external_container_id`/`container_status`/`container_checked_at`/`container_poll_count` columns on `client_distribution_records`).
- **Meta Marketing API** (paid/Ad Studio): schema and code are real and wired (Stage L), but **no live Meta ad-account credentials have ever been configured**, and no real call has ever been made against the live Meta Marketing API — a deliberate safety decision carried through Stages L, M, and confirmed still true at Stage P. `launch-ad-campaign` calls the real Graph API path (`_shared/meta-ads.ts`) but fails closed at the credentials check before any request is sent. Do not add credentials without an explicit decision to go live with real ad spend — this is not a "just flip it on" toggle, it's a decision with real financial consequences.
- A separate, unrelated legacy function `meta-ad-ops` targets an old `campaigns` table (pre-Stage-B architecture) — not part of the current Ad Studio chain. Do not confuse the two when debugging.

## Higgsfield (AI video/image generation — Reel Studio)

- Two-step pipeline: text-to-image (`higgsfield-ai/soul/standard`) then image-to-video (`higgsfield-ai/dop/lite` for draft tier; `higgsfield-ai/dop/standard` for final tier is unconfirmed — never tested live).
- Auth: `Authorization: Key {api_key}:{api_key_secret}` — two separate Supabase secrets (`HIGGSFIELD_API_KEY`, `HIGGSFIELD_API_SECRET`) assembled into one header value. Never store them pre-joined.
- Submit: `POST https://platform.higgsfield.ai/{model_id}`. Status: `GET https://platform.higgsfield.ai/requests/{request_id}/status`. Async lifecycle `queued → in_progress → completed/failed/nsfw`.
- **Known field-name gotchas** (found via real 422s, already fixed in code — re-check if Higgsfield changes their API): the image-to-video body field is `image_url`, not `image`; the motion field is `motions[].id`, not `motions[].motion`, and that `id` must be a real UUID from Higgsfield's motion catalog (`GET https://platform.higgsfield.ai/v1/motions`, undocumented, 121 entries), not a free-text slug.
- Webhooks are supported (`?hf_webhook=` query param, retried 2h) but **not trusted** — no signature verification is documented, so every function polls status itself rather than trusting a webhook body. Keep it this way unless Higgsfield documents webhook signing.
- No documented per-request credit-cost field exists in Higgsfield's API — `generation_credits_ledger` is a real table that has never been written to, because there's nothing real to write. Don't backfill fabricated costs into it.
- Generated files are retained 7 days minimum on Higgsfield's side — always download into the `video-assets` bucket promptly; don't rely on re-fetching a Higgsfield URL later.

## Anthropic / OpenAI (content generation)

- Configured as plain Supabase secrets (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`), read via `Deno.env.get(...)` — the convention for global, non-tenant-scoped provider keys. This is deliberately different from the per-tenant Vault convention (`vault_read_credential`/`_GLOBAL_`) used for client-scoped service credentials — do not conflate the two when adding a new provider.
- Used for: Phase 1/2 content generation, ideation research/scoring/calendar/commit steps, `generate-content-brief`, `generate-production-brief`, `generate-video-storyboard`, `generate-ad-creative-variants`.
- Retry pattern: single corrective retry on validation failure if wall-clock budget allows, else a clean error (never a silent partial write, never a stuck-`running` status — see incident runbook).

## Supabase itself

- Project ref `xivewedajschthjlblfb` is the sole production project. The old project `iwkhdqqgfjtpdhcbpftu` is not current authority — never query or deploy to it.
- `pg_net`/`pg_cron` underlie the async publishing worker infrastructure. `pg_net` is installed in the `public` schema (flagged WARN by the security advisor as `extension_in_public`) — this is pre-existing and was not relocated in Stage P; moving it is a separate, higher-risk migration since worker code references it directly.
- Edge function deploys: when bundling shared files, the `files` array must use the exact literal relative import path the entrypoint uses (e.g. `../_shared/aa.ts`), since the entrypoint is bundled under a `source/` subdirectory — omitting the `../` prefix fails with a "Module not found" error even when the file is present in the payload.

## Deno test-runner gap (not a provider, but a standing gotcha)

`supabase/functions/_shared/instagram-publish.test.ts` fails under `node --test` because it uses a Deno-only `jsr:@std/assert@1` import. This is a pre-existing, harmless test-runner mismatch (Deno edge functions aren't typechecked by `tsc` either — only linted and functionally verified via `node --test` for pure `_shared/*.ts` modules). It has been present and unrelated to every stage's own changes since at least Stage L. Do not "fix" it by weakening the assertion or skipping the file without checking whether a Deno-native test runner should be introduced instead — that's a tooling decision, not a bug fix.
