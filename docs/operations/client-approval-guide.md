# Client Approval Guide

What "approval" concretely means at each stage of production, and — honestly — where that concept is and isn't real code today.

## Context file approval (Phase 1)

`client_inputs`/context files carry an `approved` status, set only by a human (never auto-approved — see root `CLAUDE.md` §11). This is real and has been exercised for the one real client (all 21 Client 001 context files are `approved`, per root `CLAUDE.md` §7).

## Production brief approval (legacy pipeline)

`client_production_briefs.status` reaches `approved` through real, exercised code — all 26 existing briefs are `approved`. This is the approval gate that has governed every real piece of content produced by this system to date.

## Content Item approval (canonical spine)

`content_items.status` includes an `approved` step in its CHECK-constrained enum, and the constraint correctly requires an `approved_by`/`approved_at` pair before status can advance that far. **No real code path sets these today** (confirmed by this stage's audit — see architecture guide §3, Manual Idea path). If you're building a client-facing approval UI against the canonical spine, this is a real gap to close first, not an existing mechanism to wire a UI onto.

## Client-side approval on distribution

`client_distribution_records` has `client_approved_by`/`client_approved_at` columns — these represent a client (not staff) sign-off concept. As of this stage's live audit, they are unset on every real record, including all 19 published ones. Treat this as unimplemented in practice, not as a broken feature — no UI currently writes to it.

## Reel Studio project approval

`video_projects.status` includes `approved` as a real, exercised transition (Phase C/D, live-tested) — a project must be `approved` before `handoff-video-project` will turn it into real `client_assets`. This is the one genuinely real, end-to-end "approval gates production" mechanism in the system today.

## What this means for a client-facing approval feature

If asked to build or extend a client approval surface: the Reel Studio project-approval pattern (`video_projects.status`, `handoff-video-project`'s fail-closed checks) is the real, working template to copy — not the content_items or client_distribution_records columns, which exist in schema but carry no real behavior yet.
