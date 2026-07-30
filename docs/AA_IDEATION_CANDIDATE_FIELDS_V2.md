# AA Ideation — Candidate-field policy v2 (claim-first contract)

Status: **implemented, validated, deployed, and merged. Live Stage 1 cycle still
does not complete.**
Branch: `fix/ideation-stage5-model-compliance`. Base: `3194c8c`.

**Ideation is not yet marked operational.** See "Live verification" below.

## What was wrong

IDEATION-D1's *representation* defect was already fixed by evidence policy v2:
bullets and tables became citable through server-owned support units, and live
candidates began persisting for the first time.

The remaining blocker was different. The v1 candidate contract graded all five
candidate fields as if each were a factual proposition, but the five fields are
three different kinds of thing:

| Field | What it actually is |
| --- | --- |
| `core_message`, evidence claims | factual proposition |
| `working_title`, `hook`, `cta` | creative framing |
| `psychological_angle` | strategic classification |

Requiring a creative hook, or a strategy label, to share source vocabulary made
every field an independent chance to fail. A fully correct candidate was
rejected for wording that asserted nothing.

### Six-cycle failure matrix (pre-fix)

| Cycle | Technique | Asset | Result |
| --- | --- | --- | --- |
| 8075776e | review-mined-pain-language | reel | v1 span defect (pre-v2) |
| 8075776e | competitor-objections | story | claim lacks lexical support |
| 0ce260a3 | review-mined-pain-language | carousel | evidence metadata high-risk |
| 0ce260a3 | competitor-objections | story | claim lacks lexical support |
| 30208a11 | review-mined-pain-language | carousel | **complete** |
| 30208a11 | competitor-objections | story | claim lacks lexical support |
| 406c835e | review-mined-pain-language | carousel | **complete** |
| 406c835e | competitor-objections | story | claim lacks lexical support |
| c3845d92 | review-mined-pain-language | carousel | claim lacks lexical support |
| c3845d92 | competitor-objections | story | **complete** |
| f3d48daf | review-mined-pain-language | carousel | claim lacks lexical support |
| f3d48daf | competitor-objections | story | high-risk claim unsupported |

Both techniques succeeded at least once, so no technique was structurally
impossible — the failures were per-field and stochastic, which is exactly what a
contract that grades creative copy as fact produces.

## The fix

`aa.ideation.candidate-fields.v2` — a claim-first contract.

1. The model selects registered support units.
2. It writes bounded **grounded propositions** from those units.
3. The server validates every proposition independently, under the unchanged
   evidence-policy-v2 rules.
4. Candidate fields then reference validated propositions by id.
5. Creative fields may frame those propositions in ordinary marketing language.
6. `psychological_angle` is a code from a code-owned taxonomy.

Versions: proposition schema `aa.ideation.grounded-propositions.v1`, angle
taxonomy `aa.ideation.psychological-angles.v1`, field repair
`aa.ideation.field-repair.v1`. All participate in the Stage 1 configuration hash,
so a v2 cycle can never replay a semantically different older cycle.

### Grounding was not lowered

Every number, outcome, causal statement, guarantee, comparison, superlative,
universal, and competitor claim must still be carried by a validated
proposition. A creative field is checked for:

- every number appearing in its cited propositions;
- every high-risk category it introduces being present in those propositions;
- the existing direct-support rule still holding;
- being recognisably about its propositions.

The only calibration: **aboutness** for creative fields requires at least one
shared *distinctive* concept rather than the scaled proposition threshold.
Generic vocabulary (buyer, business, client, content, market, service…) is
dropped before that check, so a single generic overlap still counts for nothing.
`core_message` keeps the full proposition threshold unchanged.

### Psychological-angle taxonomy

15 codes: `proof_visibility`, `objection_resolution`, `risk_reversal`,
`loss_aversion`, `authority_signal`, `contrast`, `specificity`,
`identity_alignment`, `curiosity_gap`, `trigger_event`, `problem_agitation`,
`practical_utility`, `misconception_correction`, `behind_the_scenes`,
`trust_transfer`. Each carries a canonical code, operator-facing label,
definition, and allowed techniques.

The model returns a code only. The server owns the label, validates technique
compatibility, and records code plus taxonomy version in provenance. A
classification asserts no client fact, so it is deliberately not required to
appear in client authority — and it has nowhere to put prose, so it cannot
smuggle a claim.

Where a code is missing, unknown, or technique-incompatible, a deterministic
per-technique default applies. This fallback exists **only** for the strategic
classification field — never for a title, hook, core message, CTA, number, or
outcome.

### Bounded field repair

One repair call per model response. It receives only the failing field names,
their typed reasons, the current text of those fields, the already-validated
propositions, and the allowed angle codes — never unrelated authority, never
excerpt bodies. It may restate a rejected proposition's text inside its
already-cited units, but may not change candidate index, asset type, technique,
citations, or any field that passed. The result is re-validated identically. A
failed repair stays `MODEL_OUTPUT_INVALID`; there is no second repair.

## Backward compatibility

No migration was required — existing `draft_payload` provenance sufficed. The
persisted candidate shape Stages 2–4 consume is unchanged: five strings plus
`evidence_references`. Claim-first structure (proposition mapping, angle code,
taxonomy version, policy versions, repair provenance) travels in `draft_payload`.
Historical candidates are untouched and still readable.

## Live verification

One fresh cycle plus one controlled retry were run for the internal Attract
Acquisition client, one day, 2026-07-31.

**What improved, measurably:** `competitor-objections` (story) now completes on
both runs. Under the old contract it failed five times out of six. No creative
field and no psychological angle failed in either run — the three-category
separation removed that entire failure class.

**What still fails:** `review-mined-pain-language` (carousel) failed at the
proposition layer both times — once for a high-risk claim lacking direct support,
once for a number its cited unit does not carry. Both are correct validator
behaviour: the model asserted something its evidence does not say.

The cycle therefore did not complete, and **Ideation is not marked operational.**

## Production state

Zero scoring runs, zero proposals, zero commit runs. Calendar 63, organic master
22, story master 17, ads master 2, briefs 26, assets 75, distribution 25 — all
unchanged. 21/21 Context and 11 Execution files approved and unmodified. Live
candidates grew 3 → 5; no operational content was created.

## Remaining work

1. Close the remaining proposition-level compliance gap so a full cycle validates.
2. Then run the live Stage 2 read-only eligibility preflight.
3. The full live Stage 2→4 walkthrough remains an operational pilot, not a code
   gate — those stages are already accepted through deterministic fixtures,
   exact-schema validation, adversarial and concurrency testing.

Proof Upload, Website, Ads, and Paid Distribution have not been started.
