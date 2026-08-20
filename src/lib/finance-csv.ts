// Stage 2 Phase 08 — Finance. Pure CSV parsing for bulk cost-entry import.
// Deliberately thin: comma-separated, no quoted-field support, columns
// cost_category,amount,occurred_at[,notes] with an optional header row.
// Validation mirrors import_cost_entries' own server-side checks exactly,
// so a row that passes here is never rejected by the RPC for a reason the
// user wasn't already told about client-side.

import { COST_CATEGORIES, type CostCategory } from "../types/operations.ts";

export interface ParsedCostEntry {
  cost_category: CostCategory;
  amount: number;
  occurred_at: string;
  notes?: string;
}

export interface CsvParseResult {
  rows: ParsedCostEntry[];
  errors: string[];
}

const VALID_CATEGORIES = new Set<string>(COST_CATEGORIES);
const HEADER_FIRST_CELLS = new Set(["cost_category", "category"]);

export function parseCostEntriesCsv(csvText: string): CsvParseResult {
  const rows: ParsedCostEntry[] = [];
  const errors: string[] = [];
  const lines = csvText.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const lineNo = index + 1;
    const cells = line.split(",").map((c) => c.trim());

    if (lineNo === 1 && HEADER_FIRST_CELLS.has(cells[0]?.toLowerCase() ?? "")) return;

    const [category, amountStr, occurredAtStr, notes] = cells;
    if (!category || !amountStr || !occurredAtStr) {
      errors.push(`Line ${lineNo}: expected cost_category,amount,occurred_at[,notes], got "${line}"`);
      return;
    }
    if (!VALID_CATEGORIES.has(category)) {
      errors.push(`Line ${lineNo}: unknown cost_category "${category}" (must be one of ${COST_CATEGORIES.join(", ")})`);
      return;
    }
    const amount = Number(amountStr);
    if (!Number.isFinite(amount) || amount < 0) {
      errors.push(`Line ${lineNo}: amount "${amountStr}" must be a non-negative number`);
      return;
    }
    const occurredAt = new Date(occurredAtStr);
    if (Number.isNaN(occurredAt.getTime())) {
      errors.push(`Line ${lineNo}: occurred_at "${occurredAtStr}" is not a parseable date`);
      return;
    }

    rows.push({
      cost_category: category as CostCategory,
      amount,
      occurred_at: occurredAt.toISOString(),
      notes: notes || undefined,
    });
  });

  return { rows, errors };
}
