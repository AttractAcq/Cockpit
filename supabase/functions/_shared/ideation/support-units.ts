// Ideation evidence policy v2 — deterministic Markdown support units.
//
// IDEATION-D1 root cause: the v1 contract required the model to supply a
// support_span that is a verbatim substring of the bounded excerpt. Approved
// Context Files are largely bullets, key-value lines, and tables, so a correct
// model that states a proposition in prose produces a span that is not a
// substring, and the validator correctly rejects it. For a Markdown table the
// situation is worse than awkward: the proposition lives in the header AND the
// data row, which are two non-contiguous lines, so NO valid contiguous span
// exists and a fully correct model still cannot pass.
//
// The fix does not relax grounding — it moves span ownership to the server.
// Each bounded excerpt is parsed into registered support units. The model cites
// a support_unit_id; the server owns the exact raw span and does the grounding
// check against that unit alone. This is strictly stronger than v1, where the
// model chose which part of a 4000-character excerpt to point at.
//
// The parser never rewrites words, never invents prose, never changes numbers,
// and never merges unrelated lines.

import { sha256 } from "./hash.ts";
import type { IdeationEvidenceSource, IdeationEvidenceSourceType } from "./evidence.ts";

export const IDEATION_SUPPORT_UNIT_PARSER_VERSION = "aa.ideation.support-units.v1";
export const IDEATION_EVIDENCE_POLICY_VERSION = "aa.ideation.evidence.v2";

export type IdeationSupportUnitType =
  | "prose_sentence"
  | "paragraph"
  | "bullet"
  | "numbered"
  | "key_value"
  | "table_row"
  | "quote"
  | "heading";

/**
 * Deterministic selection bounds. These participate in the Stage 1
 * configuration hash, so changing any of them invalidates prior cycles rather
 * than silently altering what the model may cite.
 */
export const IDEATION_SUPPORT_UNIT_SELECTION = Object.freeze({
  version: IDEATION_SUPPORT_UNIT_PARSER_VERSION,
  policy_version: IDEATION_EVIDENCE_POLICY_VERSION,
  /** Units are taken in document order; the cap fails closed, never truncates. */
  max_units_per_source: 1000,
  /**
   * Chunk target. A span longer than this is split at whitespace boundaries
   * into consecutive exact substrings — never dropped and never rewritten, so
   * no approved authority can vanish from the prompt.
   */
  max_unit_chars: 600,
  /** A fragment shorter than this carries no citable proposition. */
  min_unit_chars: 8,
  /** Multi-sentence paragraphs also register as one whole-paragraph unit. */
  include_paragraph_units: true,
  /** Headings register so they can supply context, but see heading_can_support. */
  include_heading_units: true,
  /** A heading may only support a claim when the heading itself states it. */
  heading_can_support: false,
  normalization: "nfkc_and_crlf_to_lf_only",
  ordering: "document_order",
});

export interface IdeationSupportUnit {
  support_unit_id: string;
  source_id: string;
  source_ref: string;
  source_type: IdeationEvidenceSourceType;
  source_url: string;
  /** Hash of the source's bounded excerpt, as registered by createEvidenceSource. */
  source_content_hash: string;
  /** Hash of this unit's own raw span, so a unit is individually verifiable. */
  excerpt_hash: string;
  unit_type: IdeationSupportUnitType;
  /** Exact substring of the normalized bounded excerpt. Never rewritten. */
  raw_span: string;
  /**
   * Server-owned comparison text used for paraphrase grounding. For every unit
   * type except table_row this is the raw span with transport whitespace
   * collapsed. For a table row it pairs the registered header cells with the
   * registered row cells. It is NEVER presented as a quotation.
   */
  normalized_text: string;
  start_offset: number;
  end_offset: number;
  /** Nearest preceding Markdown heading, for context only. */
  heading: string | null;
  /** Raw header row and its offsets, for table_row units only. */
  table_header_raw: string | null;
  table_header_start_offset: number | null;
  table_header_end_offset: number | null;
  parser_version: string;
}

/**
 * Transport normalization only: Unicode NFKC and CRLF to LF. No whitespace
 * collapsing, because every offset and raw span is expressed against this
 * exact string and must remain byte-faithful to it.
 */
export function normalizeExcerptForUnits(value: string): string {
  return value.normalize("NFKC").replace(/\r\n?/g, "\n");
}

/** Comparison-text whitespace folding. Applied only to normalized_text. */
function foldWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

interface RawLine {
  text: string;
  start: number;
  end: number;
}

function splitLines(excerpt: string): RawLine[] {
  const lines: RawLine[] = [];
  let start = 0;
  for (let index = 0; index <= excerpt.length; index += 1) {
    if (index === excerpt.length || excerpt[index] === "\n") {
      lines.push({ text: excerpt.slice(start, index), start, end: index });
      start = index + 1;
    }
  }
  return lines;
}

const HEADING = /^\s{0,3}(#{1,6})\s+(\S.*)$/;
const BULLET = /^(\s*)([-*+])\s+(\S.*)$/;
const NUMBERED = /^(\s*)(\d{1,3})[.)]\s+(\S.*)$/;
const QUOTE = /^(\s*)>\s?(\S.*)$/;
// A key-value line: a short key, a colon, then a value. Excludes list markers,
// headings, and table rows, which are recognised first.
const KEY_VALUE = /^\s*(?:\*\*)?([^|#:\n]{1,80}?)(?:\*\*)?\s*:\s+(\S.*)$/;
const TABLE_LINE = /\|/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function isListItem(line: string): boolean {
  return BULLET.test(line) || NUMBERED.test(line);
}

function isStructural(line: string): boolean {
  return HEADING.test(line) || isListItem(line) || QUOTE.test(line)
    || TABLE_DELIMITER.test(line) || line.trim() === "";
}

/** Splits a Markdown table line into trimmed cells, dropping the outer pipes. */
function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

/**
 * A table needs a header row, a delimiter row, and at least one data row. A
 * line that merely contains a pipe is not a table and falls through to prose.
 */
function looksLikeTableStart(lines: RawLine[], index: number): boolean {
  const header = lines[index];
  const delimiter = lines[index + 1];
  if (!header || !delimiter) return false;
  if (!TABLE_LINE.test(header.text) || header.text.trim() === "") return false;
  if (!TABLE_DELIMITER.test(delimiter.text) || !TABLE_LINE.test(delimiter.text)) return false;
  return tableCells(header.text).length >= 2
    && tableCells(delimiter.text).length === tableCells(header.text).length;
}

function sentenceSpans(text: string, baseOffset: number): Array<{ raw: string; start: number; end: number }> {
  const spans: Array<{ raw: string; start: number; end: number }> = [];
  const pattern = /[^.!?]+(?:[.!?]+|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    spans.push({
      raw: trimmed,
      start: baseOffset + match.index + leading,
      end: baseOffset + match.index + leading + trimmed.length,
    });
  }
  return spans;
}

interface DraftUnit {
  unit_type: IdeationSupportUnitType;
  raw_span: string;
  normalized_text: string;
  start_offset: number;
  end_offset: number;
  heading: string | null;
  table_header_raw: string | null;
  table_header_start_offset: number | null;
  table_header_end_offset: number | null;
}

/**
 * Parses one already-normalized bounded excerpt into draft units, in document
 * order. Pure and synchronous so it is trivially testable; identity hashing is
 * applied separately.
 */
export function parseSupportUnitDrafts(normalizedExcerpt: string): DraftUnit[] {
  const lines = splitLines(normalizedExcerpt);
  const drafts: DraftUnit[] = [];
  let heading: string | null = null;
  let index = 0;

  /**
   * Splits an oversized span into consecutive exact substrings at whitespace
   * boundaries. Every chunk keeps true offsets, so the union of chunks still
   * covers the original span exactly — nothing is dropped or rewritten.
   */
  const chunkOversized = (draft: DraftUnit): DraftUnit[] => {
    const limit = IDEATION_SUPPORT_UNIT_SELECTION.max_unit_chars;
    if (draft.raw_span.length <= limit) return [draft];
    const chunks: DraftUnit[] = [];
    let offset = 0;
    while (offset < draft.raw_span.length) {
      let take = Math.min(limit, draft.raw_span.length - offset);
      if (offset + take < draft.raw_span.length) {
        const window = draft.raw_span.slice(offset, offset + take);
        const lastBreak = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\n"));
        if (lastBreak > limit / 2) take = lastBreak + 1;
      }
      const rawChunk = draft.raw_span.slice(offset, offset + take);
      const leading = rawChunk.length - rawChunk.trimStart().length;
      const trimmed = rawChunk.trim();
      if (trimmed) {
        chunks.push({
          ...draft,
          raw_span: trimmed,
          normalized_text: trimmed,
          start_offset: draft.start_offset + offset + leading,
          end_offset: draft.start_offset + offset + leading + trimmed.length,
        });
      }
      offset += take;
    }
    return chunks;
  };

  const push = (draft: DraftUnit) => {
    for (const chunk of chunkOversized(draft)) {
      const folded = foldWhitespace(chunk.normalized_text);
      if (folded.length < IDEATION_SUPPORT_UNIT_SELECTION.min_unit_chars) continue;
      drafts.push({ ...chunk, normalized_text: folded });
    }
  };

  while (index < lines.length) {
    const line = lines[index];
    const text = line.text;

    if (text.trim() === "") {
      index += 1;
      continue;
    }

    const headingMatch = text.match(HEADING);
    if (headingMatch) {
      heading = headingMatch[2].trim();
      if (IDEATION_SUPPORT_UNIT_SELECTION.include_heading_units) {
        const start = line.start + text.indexOf(headingMatch[2]);
        push({
          unit_type: "heading",
          raw_span: headingMatch[2].trim(),
          normalized_text: headingMatch[2].trim(),
          start_offset: start,
          end_offset: start + headingMatch[2].trim().length,
          heading: null,
          table_header_raw: null,
          table_header_start_offset: null,
          table_header_end_offset: null,
        });
      }
      index += 1;
      continue;
    }

    // Tables first: a data row's proposition depends on its header row.
    if (looksLikeTableStart(lines, index)) {
      const headerLine = lines[index];
      const headerCells = tableCells(headerLine.text);
      let cursor = index + 2;
      while (cursor < lines.length) {
        const rowLine = lines[cursor];
        if (rowLine.text.trim() === "" || !TABLE_LINE.test(rowLine.text)) break;
        const cells = tableCells(rowLine.text);
        // Pair each registered header cell with its registered row cell. Empty
        // cells are skipped rather than invented.
        const paired = headerCells
          .map((header, position) => {
            const cell = cells[position] ?? "";
            if (!cell) return "";
            return header ? `${header}: ${cell}` : cell;
          })
          .filter(Boolean)
          .join(" | ");
        const rowRaw = rowLine.text.trim();
        const rowStart = rowLine.start + (rowLine.text.length - rowLine.text.trimStart().length);
        push({
          unit_type: "table_row",
          raw_span: rowRaw,
          normalized_text: paired,
          start_offset: rowStart,
          end_offset: rowStart + rowRaw.length,
          heading,
          table_header_raw: headerLine.text.trim(),
          table_header_start_offset: headerLine.start
            + (headerLine.text.length - headerLine.text.trimStart().length),
          table_header_end_offset: headerLine.start
            + (headerLine.text.length - headerLine.text.trimStart().length)
            + headerLine.text.trim().length,
        });
        cursor += 1;
      }
      index = cursor;
      continue;
    }

    const listMatch = text.match(BULLET) ?? text.match(NUMBERED);
    if (listMatch) {
      const unitType: IdeationSupportUnitType = BULLET.test(text) ? "bullet" : "numbered";
      const bodyStart = line.start + text.indexOf(listMatch[3]);
      let end = line.end;
      let cursor = index + 1;
      // Continuation lines: indented, non-blank, and not the start of anything
      // else. They stay part of the same bounded unit.
      while (cursor < lines.length) {
        const next = lines[cursor];
        if (next.text.trim() === "" || isStructural(next.text)) break;
        if (!/^\s{2,}/.test(next.text)) break;
        if (TABLE_LINE.test(next.text) && looksLikeTableStart(lines, cursor)) break;
        end = next.end;
        cursor += 1;
      }
      const raw = normalizedExcerpt.slice(bodyStart, end);
      push({
        unit_type: unitType,
        raw_span: raw,
        normalized_text: raw,
        start_offset: bodyStart,
        end_offset: end,
        heading,
        table_header_raw: null,
        table_header_start_offset: null,
        table_header_end_offset: null,
      });
      index = cursor;
      continue;
    }

    const quoteMatch = text.match(QUOTE);
    if (quoteMatch) {
      const bodyStart = line.start + text.indexOf(quoteMatch[2]);
      push({
        unit_type: "quote",
        raw_span: quoteMatch[2].trim(),
        normalized_text: quoteMatch[2].trim(),
        start_offset: bodyStart,
        end_offset: bodyStart + quoteMatch[2].trim().length,
        heading,
        table_header_raw: null,
        table_header_start_offset: null,
        table_header_end_offset: null,
      });
      index += 1;
      continue;
    }

    const keyValueMatch = !TABLE_LINE.test(text) ? text.match(KEY_VALUE) : null;
    if (keyValueMatch) {
      const trimmed = text.trim();
      const start = line.start + (text.length - text.trimStart().length);
      push({
        unit_type: "key_value",
        raw_span: trimmed,
        normalized_text: trimmed,
        start_offset: start,
        end_offset: start + trimmed.length,
        heading,
        table_header_raw: null,
        table_header_start_offset: null,
        table_header_end_offset: null,
      });
      index += 1;
      continue;
    }

    // Prose paragraph: consecutive non-structural lines.
    let end = line.end;
    let cursor = index + 1;
    while (cursor < lines.length) {
      const next = lines[cursor];
      if (next.text.trim() === "" || isStructural(next.text)) break;
      if (looksLikeTableStart(lines, cursor)) break;
      if (!TABLE_LINE.test(next.text) && KEY_VALUE.test(next.text)) break;
      end = next.end;
      cursor += 1;
    }
    const paragraphStart = line.start + (text.length - text.trimStart().length);
    const paragraphRaw = normalizedExcerpt.slice(paragraphStart, end).trimEnd();
    const spans = sentenceSpans(paragraphRaw, paragraphStart);
    for (const span of spans) {
      push({
        unit_type: "prose_sentence",
        raw_span: span.raw,
        normalized_text: span.raw,
        start_offset: span.start,
        end_offset: span.end,
        heading,
        table_header_raw: null,
        table_header_start_offset: null,
        table_header_end_offset: null,
      });
    }
    if (IDEATION_SUPPORT_UNIT_SELECTION.include_paragraph_units && spans.length > 1) {
      push({
        unit_type: "paragraph",
        raw_span: paragraphRaw,
        normalized_text: paragraphRaw,
        start_offset: paragraphStart,
        end_offset: paragraphStart + paragraphRaw.length,
        heading,
        table_header_raw: null,
        table_header_start_offset: null,
        table_header_end_offset: null,
      });
    }
    index = cursor;
  }

  if (drafts.length > IDEATION_SUPPORT_UNIT_SELECTION.max_units_per_source) {
    // Fail closed. Silently keeping the first N units would drop approved
    // authority from the prompt without anyone noticing.
    throw new Error(
      `A bounded excerpt produced ${drafts.length} support units, above the configured maximum of ${IDEATION_SUPPORT_UNIT_SELECTION.max_units_per_source}.`,
    );
  }
  return drafts;
}

/**
 * Substantive source lines that no support unit covers.
 *
 * Structural scaffolding carries no proposition and is intentionally not
 * citable: blank lines, table delimiter rows, and list or quote markers. Every
 * other line must be reachable through at least one registered unit, or the
 * prompt would be quietly missing approved authority.
 */
export function uncoveredSubstantiveText(
  normalizedExcerpt: string,
  units: Array<{
    start_offset: number;
    end_offset: number;
    table_header_start_offset?: number | null;
    table_header_end_offset?: number | null;
  }>,
): string[] {
  const covered = new Set<number>();
  for (const unit of units) {
    for (let index = unit.start_offset; index < unit.end_offset; index += 1) covered.add(index);
    // A table header is registered authority too: it is bound to every row of
    // its table and is quotable through them.
    if (unit.table_header_start_offset !== null && unit.table_header_start_offset !== undefined
      && unit.table_header_end_offset !== null && unit.table_header_end_offset !== undefined) {
      for (let index = unit.table_header_start_offset; index < unit.table_header_end_offset; index += 1) {
        covered.add(index);
      }
    }
  }
  const uncovered: string[] = [];
  for (const line of splitLines(normalizedExcerpt)) {
    const trimmed = line.text.trim();
    if (!trimmed) continue;
    if (TABLE_DELIMITER.test(line.text)) continue;
    let missing = "";
    for (let index = line.start; index < line.end; index += 1) {
      if (!covered.has(index)) missing += normalizedExcerpt[index];
    }
    // Markers and punctuation left over from a covered line are not authority.
    const residue = missing.replace(/^[\s\-*+>#\d.)|]+/, "").replace(/[\s|]+$/, "").trim();
    if (foldWhitespace(residue).length >= IDEATION_SUPPORT_UNIT_SELECTION.min_unit_chars) {
      uncovered.push(residue);
    }
  }
  return uncovered;
}

/**
 * Builds the registered support units for one evidence source.
 *
 * The identity of a unit binds its source, that source's content hash, its
 * type, and its exact offsets, so the same text in a different source — or the
 * same source after an edit — is a different unit.
 */
export async function buildSupportUnits(
  source: IdeationEvidenceSource,
): Promise<IdeationSupportUnit[]> {
  const normalized = normalizeExcerptForUnits(source.bounded_excerpt);
  const drafts = parseSupportUnitDrafts(normalized);
  const units: IdeationSupportUnit[] = [];
  for (const draft of drafts) {
    // Defence in depth: a unit that is not an exact substring of the normalized
    // excerpt is a parser defect and is dropped rather than registered.
    if (normalized.slice(draft.start_offset, draft.end_offset) !== draft.raw_span) continue;
    const identity = [
      source.source_id,
      source.content_hash,
      draft.unit_type,
      String(draft.start_offset),
      String(draft.end_offset),
      draft.raw_span,
    ].join(" ");
    units.push({
      support_unit_id: `su_${(await sha256(identity)).slice(0, 16)}`,
      source_id: source.source_id,
      source_ref: source.source_ref,
      source_type: source.source_type,
      source_url: source.source_url,
      source_content_hash: source.content_hash,
      excerpt_hash: await sha256(draft.raw_span),
      unit_type: draft.unit_type,
      raw_span: draft.raw_span,
      normalized_text: draft.normalized_text,
      start_offset: draft.start_offset,
      end_offset: draft.end_offset,
      heading: draft.heading,
      table_header_raw: draft.table_header_raw,
      table_header_start_offset: draft.table_header_start_offset,
      table_header_end_offset: draft.table_header_end_offset,
      parser_version: IDEATION_SUPPORT_UNIT_PARSER_VERSION,
    });
  }

  // No approved authority may be silently omitted from the prompt. This is a
  // stronger guarantee than the v1 contract, which never checked coverage.
  const uncovered = uncoveredSubstantiveText(normalized, units);
  if (uncovered.length > 0) {
    throw new Error(
      `Support-unit parsing left ${uncovered.length} substantive line(s) of ${source.source_id} uncovered.`,
    );
  }
  return units;
}

export async function buildSupportUnitRegistry(
  sources: IdeationEvidenceSource[],
): Promise<IdeationSupportUnit[]> {
  const all: IdeationSupportUnit[] = [];
  for (const source of sources) all.push(...await buildSupportUnits(source));
  return all;
}

/**
 * The text a paraphrase is grounded against. A heading never establishes a
 * proposition on its own, so it contributes no support text.
 */
export function supportTextForUnit(unit: IdeationSupportUnit): string {
  if (unit.unit_type === "heading" && !IDEATION_SUPPORT_UNIT_SELECTION.heading_can_support) {
    return "";
  }
  return unit.normalized_text;
}

/**
 * Text an exact quotation must appear verbatim inside. For a table row both the
 * registered raw row and the registered raw header are quotable, because both
 * are exact source spans; the paired comparison text is not.
 */
export function quotableSpansForUnit(unit: IdeationSupportUnit): string[] {
  return unit.table_header_raw
    ? [unit.raw_span, unit.table_header_raw]
    : [unit.raw_span];
}

/** One support unit, rendered for the prompt. */
function serializeUnit(unit: IdeationSupportUnit): string {
  const parts = [`UNIT_ID: ${unit.support_unit_id}`, `TYPE: ${unit.unit_type}`];
  if (unit.heading) parts.push(`SECTION: ${unit.heading}`);
  if (unit.table_header_raw) parts.push(`TABLE_HEADER: ${unit.table_header_raw}`);
  return `  ${parts.join(" | ")}\n    RAW: ${unit.raw_span.replace(/\n/g, "\n         ")}${
    unit.unit_type === "table_row" ? `\n    MEANING: ${unit.normalized_text}` : ""
  }`;
}

/**
 * Serializes one trust-classified group of sources as addressable units.
 *
 * This REPLACES the v1 bounded-excerpt block rather than adding to it. Every
 * character of approved authority still reaches the model exactly once — now
 * split into citable units instead of one opaque excerpt — so the compaction
 * invariant is strengthened, not relaxed: no excerpt is ever printed twice, and
 * no authority text is dropped.
 */
export function serializeSourceUnitSection(
  sources: IdeationEvidenceSource[],
  units: IdeationSupportUnit[],
): string {
  return sources.map((source) => {
    const own = units.filter((unit) => unit.source_id === source.source_id);
    const header = [
      `SOURCE_ID: ${source.source_id}`,
      `SOURCE_REF: ${source.source_ref}`,
      `SOURCE_TYPE: ${source.source_type}`,
      `SOURCE_URL: ${source.source_url}`,
      `CONTENT_HASH: ${source.content_hash}`,
    ].join("\n");
    const body = own.length
      ? own.map(serializeUnit).join("\n")
      : "  (no citable support unit was derived from this source)";
    return `${header}\n${body}`;
  }).join("\n\n");
}

/** Frozen manifest hashed into the Stage 1 configuration snapshot. */
export const IDEATION_SUPPORT_UNIT_MANIFEST = Object.freeze({
  evidence_policy_version: IDEATION_EVIDENCE_POLICY_VERSION,
  parser_version: IDEATION_SUPPORT_UNIT_PARSER_VERSION,
  selection: IDEATION_SUPPORT_UNIT_SELECTION,
  unit_types: [
    "prose_sentence", "paragraph", "bullet", "numbered",
    "key_value", "table_row", "quote", "heading",
  ],
  raw_span_is_exact_source_substring: true,
  server_owns_support_span: true,
  heading_alone_cannot_support_a_claim: true,
  table_row_binds_its_header: true,
  normalized_text_is_not_a_quotation: true,
});
