// Programme Stage C: deterministic conflict rules.
//
// Grounded in workspace authority (CLAUDE.md sections 2 and 3), not invented:
// ZAR / South Africa is archive-only, and Proof Brand Lite, Proof Engine
// Buildout and maintenance packages are deprecated offers.
//
// Pure and side-effect free so it can be unit tested without a database.

export interface ConflictFinding {
  conflict_type: string;
  severity: "info" | "warning" | "blocking";
  title: string;
  detail: string;
  left_source_kind: string;
  left_source_ref: string;
}

export const DEPRECATED_OFFERS = [
  "proof brand lite",
  "proof engine buildout",
  "maintenance package",
];

export const ZAR_PATTERN = /\b(zar|rand)\b|\bR\s?\d[\d\s,.]*/i;
export const SA_PATTERN = /\bsouth africa(n)?\b|\bjohannesburg\b|\bcape town\b|\bpretoria\b/i;
export const EUR_PATTERN = /\b(eur|euro)\b|€\s?\d/i;
export const RESULT_PATTERN = /\b\d{1,3}(\.\d+)?\s?%|\b\d+\s?x\b|\bdoubled\b|\btripled\b/i;

/** Same inputs always produce the same findings, in the same order. */
export function detectConflicts(
  fields: Record<string, string | null>,
  hasVerifiedProof: boolean,
): ConflictFinding[] {
  const out: ConflictFinding[] = [];
  for (const [field, valueRaw] of Object.entries(fields)) {
    const value = (valueRaw ?? "").trim();
    if (value.length === 0) continue;
    const lower = value.toLowerCase();

    if (ZAR_PATTERN.test(value) || SA_PATTERN.test(value)) {
      const mixed = EUR_PATTERN.test(value);
      out.push({
        conflict_type: "region_currency",
        severity: mixed ? "blocking" : "warning",
        title: `Legacy region or currency in ${field}`,
        detail: mixed
          ? `${field} mixes ZAR/South Africa signals with EUR. Current commercial authority is Europe/EUR; ZAR is archive only.`
          : `${field} references ZAR or South Africa. Current commercial authority is Europe/EUR; ZAR must not enter current docs.`,
        left_source_kind: "client_input",
        left_source_ref: field,
      });
    }

    for (const offer of DEPRECATED_OFFERS) {
      if (lower.includes(offer)) {
        out.push({
          conflict_type: "offer_superseded",
          severity: "blocking",
          title: `Deprecated offer referenced in ${field}`,
          detail: `${field} references "${offer}", which is not an active offer. Active ladder: Proof Sprint, Proof Brand, Proof Brand Scale.`,
          left_source_kind: "client_input",
          left_source_ref: field,
        });
      }
    }

    if (RESULT_PATTERN.test(value) && !hasVerifiedProof) {
      out.push({
        conflict_type: "unsupported_result",
        severity: "blocking",
        title: `Numeric result claim in ${field} without verified proof`,
        detail: `${field} states a measurable result, but this client has no verified proof item. Unsupported claims must fail closed.`,
        left_source_kind: "client_input",
        left_source_ref: field,
      });
    }
  }
  return out;
}

/** Blocking findings that must prevent Phase 1 approval. */
export function blockingFindings(findings: readonly ConflictFinding[]): ConflictFinding[] {
  return findings.filter((f) => f.severity === "blocking");
}
