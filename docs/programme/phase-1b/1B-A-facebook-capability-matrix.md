# Stage 1B-A — Facebook Capability Matrix

Verified against Meta's own developer documentation (primary source, fetched live during this stage — not inferred from Instagram's behaviour or secondary/blog sources). Scope: what a Facebook **Page** can publish via the Graph API today. Personal-profile publishing is out of scope — Cockpit's model (client-owned business destinations) only ever targets Pages, matching Instagram's existing Business-Account-only model.

## API version status

The whole codebase (`instagram-publish.ts`, `meta-ads.ts`, `instagram-reels-publish.ts`) hardcodes `GRAPH_VERSION = "v21.0"` in three separate places (no shared constant). Verified live against Meta's official version changelog:

| Version | Expires |
|---|---|
| v21.0 (current codebase) | **2027-01-21** |
| v22.0 | 2027-05-20 |
| v23.0 | 2027-10-08 |
| v24.0 | 2028-02-18 |
| v25.0 (latest) | 2028-07-29 |

v21.0 is **still valid today**, with roughly 5.5 months of runway remaining. This is a real, time-bound maintenance item, not an active outage — flagged here rather than treated as urgent, since an earlier secondary-source search result incorrectly suggested versions older than v22.0 were already being rejected; that claim did not hold up against Meta's own page and is not repeated as fact. See the current-state inventory for the version-consolidation recommendation.

## Page publishing capabilities (Graph API, verified live)

| Content type | Endpoint | Mechanism | Required fields | Scheduling window | Notes |
|---|---|---|---|---|---|
| Text / link post | `POST /{page_id}/feed` | Synchronous | `message`, optional `link` | 10 min – 30 days ahead (`scheduled_publish_time`) | No direct Cockpit analogue today — Cockpit's canonical asset formats are all media-based. |
| Single photo | `POST /{page_id}/photos` | Synchronous | `url` (or uploaded binary) | Same as feed | Directly maps to Instagram's `feed_post` (single IMAGE). |
| Multi-photo album / carousel-equivalent | Not confirmed this stage | — | — | — | Meta's documented album mechanism (unpublished photo uploads + `attached_media` on a `/feed` post) was **not verified via primary source this stage** — needs direct confirmation before 1B-C claims parity with Instagram's `carousel` format. Documented here as an open item, not assumed. |
| Video (feed video, not Reels) | `POST /{page_id}/videos` | Synchronous submission, async transcode | `source` (binary), `title`, `description` | 10 min – 6 months ahead | Different scheduling window than photos/feed — a real, verified asymmetry worth encoding in the contract, not normalizing away. |
| Reels | `POST /{page_id}/video_reels` | **Multi-step resumable upload** (`upload_phase: START` → upload to returned `upload_url` → `upload_phase: FINISH`) | `upload_phase`, `video_id`, `video_state` (`DRAFT`/`PUBLISHED`/`SCHEDULED`) | Supports `scheduled_publish_time` | **Structurally different from Instagram's container-and-poll model.** Instagram Reels: create container → poll `status_code` until `FINISHED` → `media_publish`. Facebook Reels: start an upload session → push bytes to a signed URL → finish. These are not the same state machine and must not be unified into one Reels adapter. |
| Stories | Not confirmed this stage | — | — | — | Out of scope for 1B-A's verification pass — Instagram's Stories model (single-image, no caption) has no confirmed Facebook Page equivalent yet. Flagged as an open item for 1B-C, not assumed absent or present. |

## Permissions required

- `pages_manage_posts` (core publishing permission, all content types)
- `pages_read_engagement`
- `pages_show_list`
- `pages_manage_engagement` (referenced once in Meta's own docs alongside `pages_manage_posts` for feed posts — needs confirmation of exact scope boundary before 1B-B builds the permission-request flow)
- A Page access token from a user with the `CREATE_CONTENT` task capability on that Page (Meta's newer task-based permission model — distinct from Instagram's simpler business-account-token model, see security model doc)

## What is explicitly NOT verified or claimed this stage

Per the exit gate, no publishing implementation begins this stage, so nothing above was tested against a live Meta endpoint with real credentials — this matrix is documentation-verification only (Meta's own reference pages), the same standard as any other primary-source research step. Before 1B-D (Publishing) claims any of the above as implemented, it must live-test against a real Facebook Page with disposable content, exactly as every prior programme stage's Instagram/Meta work did.

## Explicit non-assumption

Per the strategic objective in `facebook-build-plan.md` §2: Facebook capability was derived independently from Meta's own Page publishing documentation, not inferred from what Instagram's Graph API happens to support. Where Instagram and Facebook use genuinely different mechanisms (Reels, most visibly), this matrix keeps them distinct rather than assuming parity.
