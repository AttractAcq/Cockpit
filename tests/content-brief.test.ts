// Programme Stage H — Content Brief, deterministic unit coverage.
// No provider call and no database is touched — validateStructuredBrief,
// renderBriefMarkdown and checkProofGate are all pure.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateStructuredBrief,
  renderBriefMarkdown,
  checkProofGate,
  type StructuredContentBrief,
} from "../supabase/functions/_shared/content-brief.ts";
import { validateStructuredBrief as frontendValidate } from "../src/types/content-brief.ts";

const VALID_RAW = {
  objective: "Book a discovery call",
  audience: "second-crew charter owners",
  platform: "instagram",
  format: "reel",
  organic_or_paid: "organic",
  core_idea: "Proof beats promises",
  core_claim: "One verified testimonial closed a $40k deal",
  hook: "Nobody believes your ads. They believe your clients.",
  belief_before: "Marketing claims are exaggerated",
  belief_after: "This operator's results are real and verifiable",
  proof: "Client X testimonial, verified 2026-07-01",
  proof_required: true,
  narrative_structure: "Hook -> claim -> proof -> CTA",
  copy_or_script_requirements: "Under 30s, captioned",
  visual_direction: "Handheld, on-location",
  asset_inputs: ["testimonial clip"],
  brand_constraints: ["no ZAR pricing", "EUR only"],
  cta: "Book a discovery call",
  approval_rules: "Account manager approval required before publish",
  production_mode: "human",
  required_outputs: ["9:16 video", "caption"],
  quality_checklist: ["proof verified", "brand voice matches"],
};

test("validateStructuredBrief: accepts a well-formed brief", () => {
  const result = validateStructuredBrief(VALID_RAW);
  assert.ok(result);
  assert.equal(result?.objective, VALID_RAW.objective);
  assert.equal(result?.proof_required, true);
});

test("validateStructuredBrief: accepts null core_claim and null proof", () => {
  const result = validateStructuredBrief({ ...VALID_RAW, core_claim: null, proof: null, proof_required: false });
  assert.ok(result);
  assert.equal(result?.core_claim, null);
  assert.equal(result?.proof, null);
});

test("validateStructuredBrief: rejects a missing required string field", () => {
  const { objective: _drop, ...rest } = VALID_RAW;
  assert.equal(validateStructuredBrief(rest), null);
});

test("validateStructuredBrief: rejects an empty required string field", () => {
  assert.equal(validateStructuredBrief({ ...VALID_RAW, hook: "" }), null);
});

test("validateStructuredBrief: rejects a non-array asset_inputs", () => {
  assert.equal(validateStructuredBrief({ ...VALID_RAW, asset_inputs: "testimonial clip" }), null);
});

test("validateStructuredBrief: rejects an invalid organic_or_paid value", () => {
  assert.equal(validateStructuredBrief({ ...VALID_RAW, organic_or_paid: "hybrid" }), null);
});

test("validateStructuredBrief: rejects an invalid production_mode value", () => {
  assert.equal(validateStructuredBrief({ ...VALID_RAW, production_mode: "robot" }), null);
});

test("validateStructuredBrief: rejects a non-boolean proof_required", () => {
  assert.equal(validateStructuredBrief({ ...VALID_RAW, proof_required: "true" }), null);
});

test("validateStructuredBrief: rejects a non-object", () => {
  assert.equal(validateStructuredBrief("not an object"), null);
  assert.equal(validateStructuredBrief(null), null);
});

/* --------------------------------------------------------- parity */

test("parity: Deno and frontend validators agree on a valid brief", () => {
  const deno = validateStructuredBrief(VALID_RAW);
  const frontend = frontendValidate(VALID_RAW);
  assert.deepEqual(deno, frontend);
});

test("parity: Deno and frontend validators agree on a rejected brief", () => {
  assert.equal(validateStructuredBrief({ ...VALID_RAW, format: "" }), null);
  assert.equal(frontendValidate({ ...VALID_RAW, format: "" }), null);
});

/* --------------------------------------------------------- renderBriefMarkdown */

test("renderBriefMarkdown: includes every major section", () => {
  const brief = validateStructuredBrief(VALID_RAW) as StructuredContentBrief;
  const md = renderBriefMarkdown(brief, "Test Item Title");
  for (const heading of ["Objective", "Core idea", "Core claim", "Hook", "Belief shift", "Proof", "Narrative structure", "CTA", "Quality checklist"]) {
    assert.ok(md.includes(heading), `expected markdown to include "${heading}"`);
  }
  assert.ok(md.startsWith("# Test Item Title"));
});

test("renderBriefMarkdown: flags required-but-missing proof distinctly from absent proof", () => {
  const withGap = validateStructuredBrief({ ...VALID_RAW, proof: null, proof_required: true }) as StructuredContentBrief;
  const md = renderBriefMarkdown(withGap, "Item");
  assert.ok(md.includes("Required — not yet attached"));
});

test("renderBriefMarkdown: omits the Proof section entirely when neither present nor required", () => {
  const noProof = validateStructuredBrief({ ...VALID_RAW, proof: null, proof_required: false }) as StructuredContentBrief;
  const md = renderBriefMarkdown(noProof, "Item");
  assert.ok(!md.includes("## Proof"));
});

/* --------------------------------------------------------- checkProofGate */

test("checkProofGate: a brief that doesn't require proof always approves", () => {
  assert.deepEqual(checkProofGate(false, 0), { approvable: true, reason: null });
});

test("checkProofGate: a brief requiring proof with none linked is blocked", () => {
  assert.deepEqual(checkProofGate(true, 0), { approvable: false, reason: "MANDATORY_PROOF_MISSING" });
});

test("checkProofGate: a brief requiring proof with at least one verified link approves", () => {
  assert.deepEqual(checkProofGate(true, 1), { approvable: true, reason: null });
});
