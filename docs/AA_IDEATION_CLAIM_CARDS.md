# AA Ideation — Server-owned claim cards

Status: **implemented, validated, deployed, and merged. Live verification
deferred: the Anthropic account has no credits.**
Branch: `fix/ideation-stage5-server-owned-claims`. Base: `008acb3`.

## What was still wrong

Evidence policy v2 and candidate-fields v2 both worked: support units made
bullets and tables citable, and separating creative framing from facts removed
that entire failure class. But the **model still authored the factual layer**.
It could select perfectly valid evidence and then write one unsupported word
into a proposition — and because every candidate must pass exactly, one stray
word failed the whole cycle.

The last two live cycles failed exactly that way:

| Cycle | Technique | Asset | Result |
| --- | --- | --- | --- |
| 2addb34b | review-mined-pain-language | carousel | `grounded_propositions.P1`: high-risk claim lacking direct support |
| 2addb34b | competitor-objections | story | **complete** |
| df3cab8e | review-mined-pain-language | carousel | `grounded_propositions.P2`: unsupported numerical outcome `1` |
| df3cab8e | competitor-objections | story | **complete** |

No creative field and no psychological angle failed in either run. The failure
was confined to model-authored proposition text.

### Where the unsupported "1" came from

From the model's own proposition wording, not from metadata. `numericalTokens`
only ever scanned the proposition text, so a candidate index, a proposition id
(`P1`), a schema version, or an array position could not have produced it. The
technique is "Review-Mined Pain Language", and the natural phrasing for it —
"the number 1 pain", "the #1 objection" — trips both the numeric rule and the
leadership rule. The bounded repair could not safely fix it, because rewriting a
factual claim is exactly the authorship the model should not have had.

## The fix — `aa.ideation.claim-cards.v1`

Factual authorship is removed from the model entirely.

1. The server parses authority into support units (evidence v2, unchanged).
2. The server converts cardable units into **claim cards**.
3. Each card carries server-owned canonical text and a permission ledger.
4. The model selects card ids and writes creative copy only.
5. The server validates every field against the selected cards' permissions.

The model cannot introduce a fact because it never writes the factual layer.

### Card types

- **direct** — one prose, bullet, numbered, key-value, or quote unit. Canonical
  text is the registered source text with Markdown transport markers removed
  deterministically. Vocabulary, numbers, and order are never changed.
- **table_fact** — one table row, bound to its registered header. Canonical text
  is the header/value pairing evidence v2 already owns. It is labelled MEANING
  and is **never quotable**; only the raw row and raw header are.
- **support_bundle** — two or three cards from the **same source**. A collection
  of independently registered facts, never a new conclusion: no causal or
  outcome relationship is created, and permissions are only the union of the
  components' own.
- **derived** — deliberately disabled. No deterministic derivation exists that
  adds meaning without risking an unsupported outcome or causal link.

Headings never become cards. Card identity binds construction version, source
id, source content hash, card type, unit ids, and canonical text, so the same
text in another source — or the same source after an edit — is a different card.

### Permission ledger — `aa.ideation.claim-permissions.v1`

Per card: exact numbers, named entities, audience terms, and which of the 11
high-risk categories the card's own registered content carries. Permissions are
computed **only** from the card's canonical text and its registered raw spans.

**Number-origin isolation.** Nothing outside registered source can grant a
permission. A candidate index, a card id suffix, a schema version, a proposition
id, or an array position is never scanned. Tests assert specifically that the
digit `1` in `candidate_index: 1`, `P1`, `cc_…1`, and `v1` authorizes nothing.

### Model output contract — `aa.ideation.candidate-output.v3`

`claim_card_ids` (1–3, one source) plus five creative fields. Supplying
`grounded_propositions`, `propositions`, `evidence_references`, `support_span`,
`support_unit_ids`, `support_note`, `quoted_text`, or `source_ids` is rejected
outright with "the server owns the factual layer".

### Field validation

- `working_title` / `hook` / `cta` — ordinary creative language, but no number,
  high-risk category, or named entity the selected cards do not permit, and they
  must be recognisably about those cards (one generic word is still not enough).
- `core_message` — full proposition-level grounding against the cards.
- `psychological_angle` — code-owned taxonomy, technique-compatible, server-owned
  label, deterministic per-technique fallback.

Every prior adversarial rejection still holds unchanged.

### Repair

One bounded call. It may fix creative fields and the angle code, and may
reselect cards only if the selection itself was rejected. It may **never**
author or modify a claim, create a card, add evidence, or change allocation.

## Backward compatibility

No migration. The persisted candidate shape Stages 2–4 consume is unchanged:
five strings plus a non-empty `evidence_references`. Claim-card provenance —
card ids, card hashes, support unit ids, permitted numbers and categories,
canonical text, and all policy versions — travels in `draft_payload`. Historical
candidates are untouched.

All new versions participate in the Stage 1 configuration hash, so a claim-card
cycle can never replay an evidence-v1, evidence-v2, or proposition-authored
cycle.

## Live verification — deferred

A fresh cycle was attempted twice for Attract Acquisition, one day, 2026-07-31.
Both attempts failed in ~3 seconds with:

```
ANTHROPIC_HTTP_ERROR — HTTP 400: Your credit balance is too low to access the
Anthropic API.
```

This is an external account condition, not a compliance failure: no model
response was produced, so no candidate, claim card, or field was evaluated. It
is **not** `MODEL_OUTPUT_INVALID`.

**Therefore the claim-card path has not yet been exercised against a live
provider response.** What is proven is structural and deterministic: the model
can no longer author factual text, because the output contract has no field for
it and the server rejects any attempt to supply one.

## Production state

15 cycles (0 completed), 5 candidates, 0 scoring runs, 0 proposals, 0 commits.
Calendar 63, organic 22, story 17, ads 2, briefs 26, assets 75, distribution 25
— all unchanged. 21/21 Context and 11 Execution files approved and unmodified.

## Remaining work

1. Restore Anthropic API credits, then run one live cycle.
2. Then the Stage 2 read-only eligibility preflight.
3. The full live Stage 2→4 walkthrough remains an operational pilot, not a code
   gate — those stages are accepted through deterministic fixtures, exact-schema
   validation, adversarial and concurrency testing.

Proof Upload, Website, Ads, and Paid Distribution have not been started.
