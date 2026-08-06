// Programme Stage D: deterministic extraction of declared values from the
// approved Execution Markdown.
//
// Why this exists, and why it contains no model call:
//
// The structured execution config is generated from the machine-readable
// "## Ideation Quantity Contract" block (schema aa.ideation.quantity.v1), which
// _shared/ideation/period.ts already parses strictly. If reconciliation then
// compared the config back against that same block it would be circular and
// would prove nothing.
//
// So reconciliation compares the config against the *human-authored* tables in
// the same approved file — Rule 2 (Monthly Slot Targets), Rule 3 (Weekly Theme
// Sequencing) and Rule 4 (Pillar Rotation Requirements). Those are an
// independent expression of the same intent. When an operator edits one
// representation and not the other, the two disagree, reconciliation records a
// blocking failure, and client_execution_configs_approval_check makes approval
// impossible. That is the contradiction check Stage D requires.
//
// Everything here is pure, deterministic and side-effect free so it can be unit
// tested without a database. No value is ever invented: a table that is absent
// yields null, and the caller records that honestly rather than filling a gap.

export type OrganicAssetType = "reel" | "carousel" | "static" | "story";

export interface DeclaredSlotTarget {
  asset_type: OrganicAssetType;
  weekly_target: number;
}

export interface DeclaredAuthorityBase {
  /** Rule 2 per-format weekly targets. Null when the table is absent. */
  slot_targets: DeclaredSlotTarget[] | null;
  /** Rule 2 "Organic total" checksum row, when present. */
  declared_organic_weekly_total: number | null;
  /** Rule 3 weekly themes, in declared week order. Null when absent. */
  weekly_themes: string[] | null;
  /** Rule 4 pillar names. Null when absent. */
  content_pillars: string[] | null;
}

export interface DeclaredAuthority extends DeclaredAuthorityBase {
  /**
   * The primary platform the approved file declares for this month. Null when
   * the file declares none — the caller then falls back to client-level
   * configuration, and fails closed if that is also unset. A platform is never
   * guessed from the formats present.
   */
  primary_platform: string | null;
}

/**
 * Rule 2 labels the formats in plural prose ("Reels"). The quantity contract
 * and the rest of the spine use singular asset types. This is the only place
 * the two vocabularies meet.
 */
const ASSET_LABELS: Record<string, OrganicAssetType> = {
  reel: "reel",
  reels: "reel",
  carousel: "carousel",
  carousels: "carousel",
  static: "static",
  statics: "static",
  story: "story",
  stories: "story",
};

/** Strips markdown emphasis and surrounding whitespace from one table cell. */
function cleanCell(cell: string): string {
  return cell.replace(/\*\*/g, "").replace(/`/g, "").trim();
}

/** Splits one markdown table row into cleaned cells. */
function rowCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return [];
  return trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map(cleanCell);
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")));
}

/**
 * Returns the body of a section introduced by the given heading, stopping at
 * the next heading of the same or higher level. Returns null when the heading
 * does not appear exactly once — ambiguity must not be resolved silently.
 */
export function sectionBody(content: string, headingPattern: RegExp): string | null {
  const normalized = content.replace(/\r\n?/g, "\n");
  const matches = [...normalized.matchAll(headingPattern)];
  if (matches.length !== 1) return null;
  const match = matches[0];
  const start = (match.index ?? 0) + match[0].length;
  const rest = normalized.slice(start);
  // Stop at the next heading of level 1-3, whatever level this one was.
  const next = rest.search(/^#{1,3}[ \t]+/m);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
}

/** Parses the first markdown table in a section body into cleaned rows. */
function tableRows(body: string): string[][] {
  const rows: string[][] = [];
  let started = false;
  for (const line of body.split("\n")) {
    const cells = rowCells(line);
    if (cells.length === 0) {
      if (started) break; // table ended
      continue;
    }
    if (isSeparatorRow(cells)) continue;
    rows.push(cells);
    started = true;
  }
  return rows;
}

/** Parses "4", "~16", "1-2", "—" into a number, or null when not a number. */
function parseCount(raw: string): number | null {
  const value = raw.replace(/[~≈]/g, "").trim();
  if (value === "" || value === "—" || value === "-") return null;
  const match = /^(\d+)/.exec(value);
  if (!match) return null;
  return Number(match[1]);
}

/**
 * Rule 2 — Monthly Slot Targets.
 * Expects a table whose first column is a format label and which carries a
 * "Weekly Target" column. Monthly figures in this table are explicitly
 * approximate ("~16") in the authored document, so only the exact weekly
 * figures are extracted for reconciliation.
 */
export function parseSlotTargets(content: string): {
  targets: DeclaredSlotTarget[] | null;
  organic_weekly_total: number | null;
} {
  const body = sectionBody(content, /^#{2,4}[ \t]+Rule 2[^\n]*$/gim);
  if (!body) return { targets: null, organic_weekly_total: null };

  const rows = tableRows(body);
  if (rows.length < 2) return { targets: null, organic_weekly_total: null };

  const header = rows[0].map((c) => c.toLowerCase());
  const weeklyIndex = header.findIndex((c) => c.includes("weekly"));
  if (weeklyIndex < 0) return { targets: null, organic_weekly_total: null };

  const targets: DeclaredSlotTarget[] = [];
  let organicTotal: number | null = null;
  const seen = new Set<OrganicAssetType>();

  for (const cells of rows.slice(1)) {
    if (cells.length <= weeklyIndex) continue;
    const label = cells[0].toLowerCase();
    const weekly = parseCount(cells[weeklyIndex]);

    if (label.includes("organic total")) {
      organicTotal = weekly;
      continue;
    }
    const assetType = ASSET_LABELS[label];
    if (!assetType || weekly === null) continue; // paid stints, notes, blanks
    if (seen.has(assetType)) continue; // a duplicate row is not silently merged
    seen.add(assetType);
    targets.push({ asset_type: assetType, weekly_target: weekly });
  }

  return {
    targets: targets.length > 0 ? targets : null,
    organic_weekly_total: organicTotal,
  };
}

/**
 * Rule 3 — Weekly Theme Sequencing. Returns the declared themes in week order.
 * These become the objective vocabulary: an objective is never invented, it is
 * the theme the approved file declares for that week.
 */
export function parseWeeklyThemes(content: string): string[] | null {
  const body = sectionBody(content, /^#{2,4}[ \t]+Rule 3[^\n]*$/gim);
  if (!body) return null;
  const rows = tableRows(body);
  if (rows.length < 2) return null;

  const header = rows[0].map((c) => c.toLowerCase());
  const themeIndex = header.findIndex((c) => c.includes("theme"));
  if (themeIndex < 0) return null;

  const themes: string[] = [];
  for (const cells of rows.slice(1)) {
    if (cells.length <= themeIndex) continue;
    const theme = cells[themeIndex];
    if (theme.length > 0) themes.push(theme);
  }
  return themes.length > 0 ? themes : null;
}

/**
 * Rule 4 — Pillar Rotation Requirements. Returns declared pillar names.
 * The rule text also caps any single pillar at 50 percent of organic slots;
 * that cap is enforced by the caller as a reconciliation check, not here.
 */
export function parseContentPillars(content: string): string[] | null {
  const body = sectionBody(content, /^#{2,4}[ \t]+Rule 4[^\n]*$/gim);
  if (!body) return null;
  const rows = tableRows(body);
  if (rows.length < 2) return null;

  const header = rows[0].map((c) => c.toLowerCase());
  const nameIndex = header.findIndex((c) => c.includes("pillar name"));
  if (nameIndex < 0) return null;

  const pillars: string[] = [];
  for (const cells of rows.slice(1)) {
    if (cells.length <= nameIndex) continue;
    const name = cells[nameIndex];
    if (name.length > 0 && !pillars.includes(name)) pillars.push(name);
  }
  return pillars.length > 0 ? pillars : null;
}

/**
 * Spreads a monthly quantity across the declared weekly themes as evenly as
 * possible, with the remainder going to the earlier weeks. Deterministic, and
 * the counts always sum to the quantity — which validateExecutionConfig
 * requires. The theme names come from the approved file, so no objective is
 * ever invented; only the distribution across them is computed here.
 */
export function objectiveMixFromThemes(
  quantity: number,
  themes: readonly string[],
): Record<string, number> {
  if (themes.length === 0) throw new Error("at least one declared theme is required");
  const mix: Record<string, number> = {};
  const base = Math.floor(quantity / themes.length);
  const remainder = quantity % themes.length;
  themes.forEach((theme, index) => {
    mix[theme] = base + (index < remainder ? 1 : 0);
  });
  return mix;
}

/**
 * The declared primary platform, from a "**Primary platform:** X" line inside
 * the Platform section. The declared value is often qualified with the formats
 * it carries ("Instagram — Reels, Carousels, ..."); only the platform name
 * before that qualifier is taken. Returns null rather than guessing when the
 * section or the line is absent, or when the value is an explicit non-answer
 * such as "Unresolved" or "TBC".
 */
export function parsePrimaryPlatform(content: string): string | null {
  const body = sectionBody(content, /^#{2,4}[ \t]+Platform[ \t]*$/gim);
  if (!body) return null;

  const match = /^[-*][ \t]*\*\*Primary platform:\*\*[ \t]*(.+)$/im.exec(body);
  if (!match) return null;

  // Cut at the first qualifier: em dash, en dash, hyphen-space, comma or colon.
  const raw = match[1].split(/\s+[—–]\s+|\s+-\s+|[,:]/)[0].trim().replace(/\*\*/g, "");
  if (raw.length === 0) return null;

  const normalized = raw.toLowerCase();
  const nonAnswers = new Set(["unresolved", "tbc", "tbd", "none", "pending", "unknown", "n/a"]);
  if (nonAnswers.has(normalized)) return null;
  return normalized;
}

/** Extracts everything Stage D reconciles against, from one execution file. */
export function extractDeclaredAuthority(content: string): DeclaredAuthority {
  const { targets, organic_weekly_total } = parseSlotTargets(content);
  return {
    slot_targets: targets,
    declared_organic_weekly_total: organic_weekly_total,
    weekly_themes: parseWeeklyThemes(content),
    content_pillars: parseContentPillars(content),
    primary_platform: parsePrimaryPlatform(content),
  };
}
