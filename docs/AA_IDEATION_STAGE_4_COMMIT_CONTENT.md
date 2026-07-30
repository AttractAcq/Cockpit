# AA Ideation — Stage 4: Commit Content

Status: implemented and deployed.
Branch: `feat/ideation-stage-4-commit-content`. Base: `e7a3b65`.

## Locked five-stage Ideation plan

| Stage | Purpose | Status |
| --- | --- | --- |
| 1 | Operational candidate generation | Accepted (frozen foundation) |
| 2 | Score and sort generated candidates | Deployed |
| 3 | Create and approve a proposed Calendar | Deployed |
| 4 | Commit approved proposed content into the operational Calendar and content masters | **This document** |
| 5 | Full end-to-end verification, and IDEATION-D1 resolution | Not implemented |

The stages are not redesigned, merged, or reordered. The Ideation system as a whole
is **not** complete: Stage 5 remains.

## What Stage 4 is

Stage 4 turns an **approved** Stage 3 proposal into real operational content, in one
database transaction, with no AI model call anywhere in the path.

Operator workflow:

1. Open an approved Proposed Calendar.
2. Review dates, slots, candidates, scores, asset types, and conflicts.
3. Click **Commit Content**.
4. Review the commit-confirmation summary.
5. Confirm.
6. The backend transactionally creates, for every approved proposal slot, one
   operational content-master row **and** one operational `calendar_cells` row.
7. Full provenance is persisted, from Ideation cycle through to the created rows.
8. The committed content appears on the Calendar tab and the Content tab.
9. Repeating the request returns the existing commit result, creating no duplicates.

Stage 4 is deterministic and transactional. **There is no AI model call in Stage 4.**

## Target-master mapping — `aa.ideation.commit-targets.v1`

The manifest is code-owned (`_shared/ideation/commit/targets.ts`) and executed in SQL
(`commit_ideation_content`). A test asserts the two agree.

| Candidate `asset_type` | Phase 3 `type_code` | Master table | `calendar_cells.row_type` |
| --- | --- | --- | --- |
| `reel` | `RL` | `organic_master` | `reel` |
| `carousel` | `CR` | `organic_master` | `carousels` |
| `static` | `FP` | `organic_master` | `feed_posts` |
| `story` | `ST` | **`story_master`** | `stories` |

Story content is **never** coerced into `organic_master`; it is the only asset type
that targets `story_master`.

**`ads_master`, paid campaign tables, and paid-distribution tables are never written
by Stage 4.** There is no code path from Stage 4 to them, and the `AD` type code is
rejected. This is asserted by test.

An unsupported asset type rejects the whole commit **before any operational write**,
with a typed non-retryable `UNSUPPORTED_ASSET_TYPE` error naming the incompatible
proposal slot. The approved proposal is left unchanged.

## Master field mapping — `aa.ideation.commit-mapping.v1`

Mapping is deterministic and narrow. Only fields the Ideation candidate genuinely
carries are written. **Nothing is fabricated and no AI call expands the content.**

### `organic_master` (reel / carousel / static)

| Column | Source |
| --- | --- |
| `client_id` | proposal slot |
| `month` | `to_char(proposed_date,'YYYY-MM')` |
| `ref` | allocated by `allocate_phase3_ref` |
| `review_state` | `needs_review` (canonical, never auto-approved) |
| `status` | `idea` |
| `content_type` | `RL` / `CR` / `FP` from the target manifest |
| `working_title` | candidate `working_title` |
| `hook` | candidate `hook` |
| `core_message` | candidate `core_message` |
| `cta` | candidate `cta` |
| `psychological_angle` | candidate `psychological_angle` |
| `distribution_date` | slot `proposed_date` |
| `source_origin` | deterministic provenance marker (below) |
| `format_proven` | `false` (matches Phase 3) |

### `story_master` (story)

| Column | Source |
| --- | --- |
| `client_id`, `month`, `ref`, `review_state`, `status` | as above |
| `story_type` | `daily` — the canonical default Phase 3 also falls back to |
| `story_theme` | candidate `working_title` |
| `frame_1` | candidate `hook` |
| `frame_2` | candidate `core_message` |
| `frame_3` | candidate `psychological_angle` (nullable) |
| `cta_engagement_prompt` | candidate `cta` |
| `distribution_date` | slot `proposed_date` |
| `source_origin` | deterministic provenance marker |

### Deliberately left NULL

`storyboard_outline`, `caption_script`, `production_brief`, `archetype`, `pillar`,
`the_one_person`, `one_belief_to_change`, `notes`, `repurposed_from_to`,
`production_date`, `edit_date`, `editor`, `frame_4_optional`, `proof_used`,
`what_not_to_claim`.

An Ideation candidate carries none of these. Stage 1's own output contract explicitly
**prohibits** the model from emitting `production_brief`, `storyboard`, and
`shot_list`, so inventing them at commit time would manufacture content that no
authority ever produced. They stay NULL and a human fills them during review.

`distribution_channel` is also left NULL: a platform assumption is not confirmed
authority, and Ideation never captured one. Phase 3's `"Instagram"` fallback is not
copied.

If a mandatory operational column cannot be derived deterministically, the commit
fails **before any write** with a typed `MASTER_MAPPING_INVALID` /
`REQUIRED_FIELD_MISSING` error naming the field. Partial rows are never inserted.

### Provenance marker

`source_origin` is set to `Ideation {first 8 characters of the cycle id}` —
deterministic, non-fabricated, and traceable. Full provenance lives in
`client_ideation_commit_items`, not in invented master columns. No operational column
is added to `organic_master`, `story_master`, or `calendar_cells` by Stage 4.

### Review lifecycle

Committed masters enter the **normal** review lifecycle at `review_state =
'needs_review'`, `status = 'idea'`. Stage 4 never auto-approves content, never creates
a production brief, never generates an asset, never creates a Reel Studio project,
and never publishes or distributes anything.

## Calendar row mapping

One `calendar_cells` row per committed master:

| Column | Source |
| --- | --- |
| `client_id` | commit run |
| `month` | `to_char(proposed_date,'YYYY-MM')` |
| `date` | slot `proposed_date` |
| `row_type` | slot `calendar_row_type` (target manifest) |
| `ref` | the same allocated operational ref as the master |
| `review_state` | `needs_review` |

Master and Calendar row always agree on client, date, ref, and type. Existing Calendar
rows are never overwritten or deleted. There can be no orphan master and no orphan
Calendar row — both are inserted in the same transaction, and exact reconciliation is
enforced before the transaction commits.

## Operational reference allocation

Stage 4 reuses the **existing canonical allocator**, `allocate_phase3_ref(client, date,
type_code)`, unchanged:

- format `{MON}{DD}-{TYPE}-{NNN}`, e.g. `JUL26-CR-001`;
- collision safety via `pg_advisory_xact_lock(client:month:type_code)`, so concurrent
  commits and concurrent Phase 3 runs serialise on the same lock;
- it already accounts for both existing master rows and refs reserved by
  `client_phase3_scope_items`.

The externally visible Phase 3 reference format is unchanged. The Ideation display
reference (`IDEATION/{cycle8}/{TECH}-{ASSET}-{nn}`) is **never** used as an operational
ref — it stays a Stage 3 review-only label.

Allocation is deterministic in item order (slots ordered by `proposed_date`, then
`proposal_slot_key`). No `MAX(ref)+1` is computed outside the lock, and no reference is
ever computed in the browser.

## Eligibility

A proposal is committable only when every one of these holds; failure occurs **before
any operational write**:

authenticated caller; `admin` or `account_manager`; caller has client access; proposal
belongs to the client; status `approved`; not superseded; is the active approved
proposal for the lineage; cycle complete with zero shortfall; scoring run complete with
zero shortfall; slot count equals expected; assigned equals expected; zero unassigned;
zero unresolved conflicts; every candidate and slot appears exactly once; every slot has
one candidate; candidate asset type matches slot asset type; every date inside the
period; candidate hashes unchanged; score records unchanged; authority hashes unchanged;
Calendar not materially changed; no completed commit exists; every asset type supported.

### Authority drift

Authority is re-verified with the **same mechanism Stages 2 and 3 use**,
`reconstructScoringAuthority`, reused rather than reimplemented: every file the
proposal recorded must still exist, still be approved, and still match its
recorded version and content hash. A scalar hash read off the proposal itself
would compare equal to itself and prove nothing, so the verification is done
against the live approved files and its outcome is passed into eligibility.

The commit transaction then re-checks the same recorded authority independently:
every recorded file must still exist, still be approved, and still be at the
recorded version. A file edited between preflight and transaction therefore
fails the commit closed, with `AUTHORITY_SNAPSHOT_MISMATCH`.

## Commit status model

`running → completed` or `running → failed`. Both terminal states are final for that
configuration. `running` exists only for audit around the transaction boundary — there
is no long-lived partial operational state, because the operational writes all happen
inside one transaction.

The approved proposal is never mutated back into an editable state. "Committed" is
derived from the completed commit run.

## Transaction design

One service-role-only `SECURITY DEFINER` RPC, `commit_ideation_content`, performs the
entire operational write in **one transaction**: lock proposal → revalidate everything →
re-read Calendar occupancy → reject drift or new conflict → validate every target and
payload → allocate refs → insert masters → insert Calendar rows → insert commit items →
complete the commit run → activity log → exact reconciliation → return the bundle.

Any failure rolls the whole transaction back: zero masters, zero Calendar rows, zero
commit items, no partially visible content. There is no per-slot Edge Function call and
no client-side loop.

## Idempotency and replay

The Stage 4 configuration hash covers every material input: client, cycle and its
config hash, scoring run and its config hash, proposal and its config hash, proposal
version, edit revision, approval identity, slot IDs and keys, candidate IDs and hashes,
score IDs, ranks, scores, dates, asset types, target master tables, authority snapshot
identities, current Calendar digest, and the target-manifest, mapping, allocator,
output-schema, and module versions. Request IDs, tokens, execution timestamps, and
worker identity are excluded. The caller cannot supply or alter the hash.

A repeated request against a completed commit returns the existing commit bundle as a
**success**, creating no new master, Calendar row, or commit item.

## Provenance

`client_ideation_commit_items` records, per slot: cycle, scoring run, proposal, proposal
slot, candidate, candidate score, candidate content hash, rank and score snapshots,
target master table and ID, target Calendar cell ID, operational ref, committed date,
asset type, and payload hashes. Every committed row is traceable in both directions.

## Authorization and RLS

`admin` and `account_manager` only; all other roles denied; role and client access are
never taken from the request body. Both commit tables: staff SELECT for accessible
clients only; anonymous denied; cross-client denied; no authenticated INSERT/UPDATE/
DELETE. All mutations go through the service-role RPC, which is `SECURITY DEFINER` with
`search_path` pinned and `EXECUTE` revoked from `public`/`anon`/`authenticated`.

No existing policy for Stage 1–3, Phase 1/2, Context Files, Execution Files,
`playbooks`, `playbook_runs`, Calendar, or the masters is modified.

## Boundaries Stage 4 does not cross

No candidate rewriting or re-scoring; no proposal regeneration beyond Stage 3; no
automatic content approval; no production briefs; no asset generation; no Reel Studio
project creation; no publishing; no distribution; no analytics; no performance
iteration; no Ads or Paid Distribution; no Proof Upload; no Website functionality; no
deletion or rollback of committed content; no destructive replacement of existing
masters; no `playbooks` or `playbook_runs` dependency; no Anthropic or OpenAI import.

## IDEATION-D1 — still open, deferred to Stage 5

Approved Context Files often contain Markdown bullets and tables that do not
consistently satisfy the prose-oriented Stage 1 `support_span` contract. This is **not
resolved**. Stage 4 does not weaken Stage 1 grounding, does not re-author approved
Context Files, and does not require a live-generated production proposal — it was
validated on deterministic fixtures in disposable databases.

The first full live generation → scoring → proposal → commit verification is Stage 5,
together with IDEATION-D1.
