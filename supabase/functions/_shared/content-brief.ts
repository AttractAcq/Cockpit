// Programme Stage H — the structured Content Brief contract, its Markdown
// renderer, schema validation, and the mandatory-proof approval gate.
//
// All pure/testable — no database or network dependency — matching this
// repo's convention of thin production adapters over a testable core.

export interface StructuredContentBrief {
  objective: string;
  audience: string;
  platform: string;
  format: string;
  organic_or_paid: "organic" | "paid";
  core_idea: string;
  core_claim: string | null;
  hook: string;
  belief_before: string;
  belief_after: string;
  proof: string | null;
  /** True only if this Brief's claims actually require verified Proof to approve. */
  proof_required: boolean;
  narrative_structure: string;
  copy_or_script_requirements: string;
  visual_direction: string;
  asset_inputs: string[];
  brand_constraints: string[];
  cta: string;
  approval_rules: string;
  production_mode: "ai" | "human" | "hybrid";
  required_outputs: string[];
  quality_checklist: string[];
}

const REQUIRED_STRING_FIELDS: readonly (keyof StructuredContentBrief)[] = [
  "objective", "audience", "platform", "format", "core_idea", "hook",
  "belief_before", "belief_after", "narrative_structure",
  "copy_or_script_requirements", "visual_direction", "cta", "approval_rules",
];

const REQUIRED_ARRAY_FIELDS: readonly (keyof StructuredContentBrief)[] = [
  "asset_inputs", "brand_constraints", "required_outputs", "quality_checklist",
];

/** Strict validation — a malformed brief is rejected, never coerced or guessed. */
export function validateStructuredBrief(raw: unknown): StructuredContentBrief | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;

  for (const field of REQUIRED_STRING_FIELDS) {
    const v = row[field];
    if (typeof v !== "string" || v.trim().length === 0) return null;
  }
  for (const field of REQUIRED_ARRAY_FIELDS) {
    const v = row[field];
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) return null;
  }
  if (row.organic_or_paid !== "organic" && row.organic_or_paid !== "paid") return null;
  if (row.production_mode !== "ai" && row.production_mode !== "human" && row.production_mode !== "hybrid") return null;
  if (typeof row.proof_required !== "boolean") return null;
  if (row.core_claim !== null && typeof row.core_claim !== "string") return null;
  if (row.proof !== null && typeof row.proof !== "string") return null;

  return {
    objective: row.objective as string,
    audience: row.audience as string,
    platform: row.platform as string,
    format: row.format as string,
    organic_or_paid: row.organic_or_paid,
    core_idea: row.core_idea as string,
    core_claim: (row.core_claim as string | null) ?? null,
    hook: row.hook as string,
    belief_before: row.belief_before as string,
    belief_after: row.belief_after as string,
    proof: (row.proof as string | null) ?? null,
    proof_required: row.proof_required,
    narrative_structure: row.narrative_structure as string,
    copy_or_script_requirements: row.copy_or_script_requirements as string,
    visual_direction: row.visual_direction as string,
    asset_inputs: row.asset_inputs as string[],
    brand_constraints: row.brand_constraints as string[],
    cta: row.cta as string,
    approval_rules: row.approval_rules as string,
    production_mode: row.production_mode,
    required_outputs: row.required_outputs as string[],
    quality_checklist: row.quality_checklist as string[],
  };
}

/** Renders the structured contract into the human-reviewable Markdown Stage H requires. */
export function renderBriefMarkdown(brief: StructuredContentBrief, title: string): string {
  const list = (items: readonly string[]): string => items.map((i) => `- ${i}`).join("\n");
  return `# ${title}

**Objective:** ${brief.objective}
**Audience:** ${brief.audience}
**Platform:** ${brief.platform} · **Format:** ${brief.format} · **${brief.organic_or_paid === "paid" ? "Paid" : "Organic"}**
**Production mode:** ${brief.production_mode}

## Core idea
${brief.core_idea}

${brief.core_claim ? `## Core claim\n${brief.core_claim}\n\n` : ""}## Hook
${brief.hook}

## Belief shift
Before: ${brief.belief_before}
After: ${brief.belief_after}

${brief.proof ? `## Proof\n${brief.proof}\n\n` : brief.proof_required ? "## Proof\n_Required — not yet attached. This Brief cannot be approved until verified Proof is linked._\n\n" : ""}## Narrative structure
${brief.narrative_structure}

## Copy / script requirements
${brief.copy_or_script_requirements}

## Visual direction
${brief.visual_direction}

## Asset inputs
${list(brief.asset_inputs) || "_None specified._"}

## Brand constraints
${list(brief.brand_constraints) || "_None specified._"}

## CTA
${brief.cta}

## Approval rules
${brief.approval_rules}

## Required outputs
${list(brief.required_outputs) || "_None specified._"}

## Quality checklist
${list(brief.quality_checklist) || "_None specified._"}
`;
}

export interface ProofGateResult {
  approvable: boolean;
  reason: string | null;
}

/**
 * "Brief cannot be approved when mandatory Proof is missing" — approval gate.
 * A Brief that doesn't require Proof (proof_required: false) always passes.
 * One that does requires at least one linked, verified proof_item.
 */
export function checkProofGate(
  proofRequired: boolean,
  linkedVerifiedProofCount: number,
): ProofGateResult {
  if (!proofRequired) return { approvable: true, reason: null };
  if (linkedVerifiedProofCount > 0) return { approvable: true, reason: null };
  return { approvable: false, reason: "MANDATORY_PROOF_MISSING" };
}
