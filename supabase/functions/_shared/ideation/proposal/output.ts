// Ideation Stage 3 — proposal assignment output validation.
//
// The model may only pair a registered candidate with a registered slot. It owns
// no dates, no asset types, no scores, no ranks, and no approval. Any attempt to
// supply one is a contract violation, rejected rather than silently ignored.

import {
  IDEATION_PROPOSAL_TEXT_LIMITS,
  IDEATION_PROPOSAL_WARNING_CODES,
} from "./config.ts";
import type { IdeationAssetType } from "./slot-planner.ts";

export interface ValidatedProposalAssignment {
  proposal_slot_key: string;
  candidate_id: string;
  placement_rationale: string;
  authority_references: string[];
  evidence_references: string[];
  warnings: string[];
}

export type ProposalOutputValidation =
  | { ok: true; assignments: ValidatedProposalAssignment[] }
  | { ok: false; error: string };

const ALLOWED_KEYS = new Set<string>([
  "proposal_slot_key",
  "candidate_id",
  "placement_rationale",
  "authority_references",
  "evidence_references",
  "warnings",
]);

// Keys the server owns outright. Their presence means the model tried to decide
// something it must never decide.
const SERVER_OWNED_KEYS = new Set<string>([
  "proposed_date",
  "date",
  "date_slot_ordinal",
  "required_asset_type",
  "asset_type",
  "rank",
  "score",
  "overall_score",
  "priority_band",
  "conflict_status",
  "status",
  "approved",
  "approved_at",
  "calendar_cell_id",
  "calendar_id",
  "master_ref",
  "organic_master_id",
  "ref",
  "working_title",
  "hook",
  "core_message",
  "cta",
  "commit",
]);

export function extractProposalJson(text: string): Record<string, unknown> | null {
  const attempt = (candidate: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  };
  const direct = attempt(text.trim());
  if (direct) return direct;
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fenced) {
    const parsed = attempt(fenced[1]);
    if (parsed) return parsed;
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return attempt(text.slice(start, end + 1));
  return null;
}

function boundedString(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxChars) return null;
  return trimmed;
}

function referenceList(
  value: unknown,
  allowed: Set<string>,
  maximum: number,
): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, ids: [] };
  if (!Array.isArray(value)) return { ok: false, error: "must be an array" };
  if (value.length > maximum) return { ok: false, error: "exceeds its bound" };
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      return { ok: false, error: "contains a non-string entry" };
    }
    const id = entry.trim();
    if (!allowed.has(id)) return { ok: false, error: "contains an unregistered identifier" };
    if (ids.includes(id)) return { ok: false, error: "contains a duplicate identifier" };
    ids.push(id);
  }
  return { ok: true, ids };
}

export interface ExpectedProposalSlot {
  proposal_slot_key: string;
  required_asset_type: IdeationAssetType;
  proposed_date: string;
}

export interface ExpectedProposalCandidate {
  candidate_id: string;
  asset_type: IdeationAssetType;
  evidence_source_ids: string[];
}

/**
 * Validates one assignment batch against its exact expected slot and candidate
 * sets. A batch that assigns only some of its slots is a failure, never a
 * partial success.
 */
export function validateProposalBatchOutput(
  value: Record<string, unknown>,
  expectedSlots: ExpectedProposalSlot[],
  expectedCandidates: ExpectedProposalCandidate[],
  allowedAuthorityIds: string[],
  period: { start: string; end: string },
): ProposalOutputValidation {
  const rows = value.assignments;
  if (!Array.isArray(rows)) {
    return { ok: false, error: "Proposal output must contain an assignments array." };
  }
  if (rows.length !== expectedSlots.length) {
    return {
      ok: false,
      error: `Proposal batch returned ${rows.length} assignments for ${expectedSlots.length} slots.`,
    };
  }

  const slotByKey = new Map(expectedSlots.map((slot) => [slot.proposal_slot_key, slot]));
  const candidateById = new Map(expectedCandidates.map((candidate) => [candidate.candidate_id, candidate]));
  const authorityIds = new Set(allowedAuthorityIds);
  const seenSlots = new Set<string>();
  const seenCandidates = new Set<string>();
  const assignments: ValidatedProposalAssignment[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, error: "Proposal output contains a malformed assignment." };
    }
    const entry = row as Record<string, unknown>;
    for (const key of Object.keys(entry)) {
      if (SERVER_OWNED_KEYS.has(key)) {
        return { ok: false, error: `Proposal output must not supply the server-owned field ${key}.` };
      }
      if (!ALLOWED_KEYS.has(key)) {
        return { ok: false, error: `Proposal output contains the unexpected field ${key}.` };
      }
    }

    const slotKey = typeof entry.proposal_slot_key === "string" ? entry.proposal_slot_key.trim() : "";
    if (!slotKey) return { ok: false, error: "Proposal output is missing a proposal_slot_key." };
    const slot = slotByKey.get(slotKey);
    if (!slot) return { ok: false, error: "Proposal output references an unregistered slot." };
    if (seenSlots.has(slotKey)) {
      return { ok: false, error: "Proposal output assigns the same slot more than once." };
    }
    seenSlots.add(slotKey);

    // Defence in depth: the slot's own date must still sit inside the period.
    if (slot.proposed_date < period.start || slot.proposed_date > period.end) {
      return { ok: false, error: "A proposed slot date lies outside the Ideation period." };
    }

    const candidateId = typeof entry.candidate_id === "string" ? entry.candidate_id.trim() : "";
    if (!candidateId) return { ok: false, error: "Proposal output is missing a candidate_id." };
    const candidate = candidateById.get(candidateId);
    if (!candidate) return { ok: false, error: "Proposal output references an unregistered candidate." };
    if (seenCandidates.has(candidateId)) {
      return { ok: false, error: "Proposal output assigns the same candidate more than once." };
    }
    seenCandidates.add(candidateId);

    if (candidate.asset_type !== slot.required_asset_type) {
      return {
        ok: false,
        error: "Proposal output placed a candidate in a slot requiring a different asset type.",
      };
    }

    const rationale = boundedString(
      entry.placement_rationale,
      IDEATION_PROPOSAL_TEXT_LIMITS.rationale_max_chars,
    );
    if (!rationale) {
      return { ok: false, error: "Placement rationale is missing or exceeds its bound." };
    }

    const authority = referenceList(
      entry.authority_references,
      authorityIds,
      IDEATION_PROPOSAL_TEXT_LIMITS.authority_references_maximum,
    );
    if (!authority.ok) return { ok: false, error: `Authority references: ${authority.error}.` };
    const evidence = referenceList(
      entry.evidence_references,
      new Set(candidate.evidence_source_ids),
      IDEATION_PROPOSAL_TEXT_LIMITS.evidence_references_maximum,
    );
    if (!evidence.ok) return { ok: false, error: `Evidence references: ${evidence.error}.` };

    const warnings = referenceList(
      entry.warnings,
      new Set(IDEATION_PROPOSAL_WARNING_CODES),
      IDEATION_PROPOSAL_TEXT_LIMITS.warnings_maximum,
    );
    if (!warnings.ok) return { ok: false, error: `Warnings: ${warnings.error}.` };

    assignments.push({
      proposal_slot_key: slotKey,
      candidate_id: candidateId,
      placement_rationale: rationale,
      authority_references: authority.ids,
      evidence_references: evidence.ids,
      warnings: warnings.ids,
    });
  }

  if (seenSlots.size !== expectedSlots.length || seenCandidates.size !== expectedSlots.length) {
    return { ok: false, error: "Proposal batch did not cover every slot and candidate exactly once." };
  }
  return { ok: true, assignments };
}
