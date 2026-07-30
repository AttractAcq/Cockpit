# AA Ideation — Stage 5: End-to-End Verification and IDEATION-D1

Status: **corrections implemented, validated, and deployed. Live end-to-end
verification did not complete.**
Branch: `feat/ideation-stage-5-final-verification`. Base: `36c1561`.

**The complete Ideation system is NOT yet marked operational.** See "Live
verification result" below for exactly what blocks it.

## The five-stage Ideation system

| Stage | Purpose | Status |
| --- | --- | --- |
| 1 | Generate evidence-grounded candidates for a period | Deployed. Live generation of a *full* cycle not yet achieved |
| 2 | Score and sort candidates | Deployed, not yet live-verified (needs a completed cycle) |
| 3 | Create, review, edit, approve a proposed Calendar | Deployed, not yet live-verified |
| 4 | Commit the approved proposal into Calendar and content masters | Deployed, not yet live-verified |
| 5 | Resolve remaining issues and verify end to end | **This document** |

There is no Stage 6.

## IDEATION-D1 — representation problem resolved; live cycle not yet achieved

### Root cause

The v1 contract required the model to supply a `support_span` that is a verbatim
substring of a bounded excerpt. Approved Context Files are overwhelmingly
Markdown bullets, key-value lines, and tables — the live client's file 02 parses
to **46 bullets and 9 headings, zero prose sentences**. A model that states a
bullet's proposition in prose produces a span that is not a substring, and the
validator correctly rejected it.

For a Markdown table the problem was worse than awkward: the proposition lives in
the header row *and* the data row, which are never contiguous, so **no valid v1
span existed at all** and a fully correct model still could not pass.

### The fix — evidence policy `aa.ideation.evidence.v2`

Span ownership moved from the model to the server. Each bounded excerpt is parsed
by `aa.ideation.support-units.v1` into registered **support units**; the model
cites `support_unit_ids` and never supplies source text.

This is **stricter than v1**, not looser:

- the span is server-owned and exact, where v1 let the model choose any span in a
  4,000-character excerpt;
- grounding is checked against the specific cited unit, not the whole excerpt;
- a model-supplied `support_span` is now rejected outright;
- a heading alone can never support a claim;
- parsing **fails closed** if any substantive authority line is left uncovered —
  v1 never checked coverage at all.

Supported structures: prose sentence, paragraph block, bullet, numbered item,
multi-line list item, key-value line, table row (bound to its header), block
quote, heading (context only).

Unit identity binds source id, source content hash, unit type, and exact offsets,
so the same text in a different source — or the same source after an edit — is a
different unit. Oversized spans are chunked at whitespace boundaries, never
dropped. A table row's `normalized_text` pairs registered header cells with row
cells and is explicitly **not** quotable; only the raw row and raw header are.

Every prior adversarial protection still holds, verified by test: unsupported
outcomes, revenue/growth/conversion claims, causal language, guarantees,
superiority, category leadership, universals, competitor claims, unsupported
percentages, currencies and ranges, altered quotations, arbitrary support notes,
single-generic-token overlap, unknown/cross-source/cross-cycle references. The
concept-overlap threshold was **not** reduced.

### Live verification result — the remaining blocker

Six controlled live cycles were run against the internal Attract Acquisition
client for 2026-07-31 (a date inside approved Execution authority with no
protected Calendar conflict).

**What the live runs proved works:**

- the parser produces correct units from the real approved authority;
- the model cites `support_unit_ids` correctly;
- **bullet evidence validates and persists live** — three real candidates now
  exist with `evidence_type: paraphrase`, server-derived `support_span` values
  such as `Hidden proof does not create demand.`, and cited unit ids. Under v1
  this client had produced **zero** candidates, ever.

**What still fails:** a *complete* cycle requires all seven techniques to
validate every candidate. Each run still ends with at least one candidate
rejected by `MODEL_OUTPUT_INVALID — Claim lacks proposition-level lexical
support in the cited evidence`. The rejection is correct: the model wrote a field
whose vocabulary does not overlap the unit it cited.

This is a **model-compliance gap, not a validator gap**. Verified locally against
the real units: well-formed fields such as `Operating with real clients and real
delivery, not a startup` pass against the same bullets. The threshold is
reachable; the model does not reliably reach it, most often on the interpretive
`psychological_angle` field.

Prompt work already applied: support-unit registry with raw text, a worked
example, "lightly edit the unit's own words", a 12-word field cap, multi-unit
citation (up to three units from one source), and note-construction rules.

**IDEATION-D1 is therefore NOT marked resolved.** The representation defect is
fixed and proven; the live completion criterion is not met.

## Authority-race closure (deployed)

Migration `20260731000041` replaces `commit_ideation_content` in place — the
deployed Stage 4 migration is never edited. The commit transaction now locks each
recorded authority row `FOR SHARE` (the narrowest lock that blocks a writer while
leaving readers unaffected) and recomputes its content hash inside the
transaction, using sha256 of the full `content_md` exactly as
`reconstructScoringAuthority` does. A content edit that does not bump a version
can no longer slip between preflight and commit.

Proven by a real two-session test: an edit that lands first is detected and fails
the commit closed with zero operational rows; an edit that arrives second waits
for the commit to finish. No authority row is ever mutated, and no lock is taken
on unrelated client authority.

## Story-type decision

Approved Execution authority references story type as a concept but defines **no
deterministic candidate-to-story-type rule**, so deriving one would require
interpretation. `daily` is retained as the neutral canonical default — exactly
Phase 3's own fallback. The choice is recorded in commit provenance as
`story_type_source: neutral_canonical_default`, and a regression test asserts no
stronger type (`sequence`, `poll`, `proof`, `offer`, …) is ever written.

## Backward compatibility

No existing cycle, candidate, evidence record, score, proposal, or commit was
mutated. Historical v1 records remain readable under their original contract:
`validateIdeationCandidateOutput` applies v2 only when a support-unit registry is
supplied. New cycles use v2, and the evidence policy version, parser version, and
support-unit selection configuration all participate in the Stage 1 configuration
hash, so a v1 cycle can never silently reuse the old contract.

## Production state after Stage 5

Zero scoring runs, zero proposals, zero commit runs. Calendar 63, organic master
22, story master 17, ads master 2, briefs 26, assets 75, distribution 25 — all
unchanged. 21/21 Context Files and 11 Execution Files remain approved and
unmodified. Three live candidates were added; no operational content was created.

## Remaining work before Ideation can be marked operational

1. Close the model-compliance gap so a full seven-technique cycle validates.
2. Then run live Stage 2, Stage 3, and Stage 4 verification, with replay checks.
3. Then, and only then, mark IDEATION-D1 resolved and the system operational.

Proof Upload, Website, Ads, and Paid Distribution have not been started.
