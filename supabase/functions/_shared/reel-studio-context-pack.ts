// Reel Studio storyboard context assembly.
//
// Replaces the previous `value.slice(0, 6000)` truncation of the production
// brief with deliberate, section-aware assembly over the *approved* context
// authority that already exists in the database.
//
// Two rules govern everything here:
//   1. Only approved authority is admitted. Context files must be `approved`
//      and execution files must be `review_state = 'approved'`, both scoped to
//      the project's own client_id. Nothing else is read.
//   2. Budgeting never blindly cuts the head of a document. Sections are
//      admitted whole, in priority order, and a section that does not fit is
//      either dropped whole or trimmed at a paragraph boundary — and either
//      way the outcome is recorded in the pack's provenance so a later quality
//      problem is diagnosable.

export const CONTEXT_PACK_VERSION = "reel-storyboard-context-pack@2";

/** Approved Client Context OS files that bear on a Reel. Others are excluded. */
export const REEL_RELEVANT_CONTEXT_FILE_NUMBERS = [2, 3, 4, 6, 7, 9, 10] as const;

/** Execution-file types that bear on a Reel's message. Others are excluded. */
export const REEL_RELEVANT_EXECUTION_FILE_PATTERN = /story|content|proof|angle|hook/i;

export interface ContextFileRow {
  id: string;
  client_id: string;
  file_number: number;
  file_name: string;
  content_md: string | null;
  status: string;
  version: number;
}

export interface ExecutionFileRow {
  id: string;
  client_id: string;
  file_name: string;
  file_type: string | null;
  content_md: string | null;
  review_state: string;
  version: number;
  month: string;
}

export interface BrandBlockRow {
  id: string;
  version: number;
  grade_block: string | null;
  lens_block: string | null;
  mood_block: string | null;
  motion_block: string | null;
  negative_block: string | null;
}

export interface MarkdownSection {
  heading: string;
  body: string;
}

export interface ContextSlice {
  /** Where this text came from, for provenance. */
  origin: string;
  heading: string;
  text: string;
  /** True when the section was trimmed at a paragraph boundary to fit budget. */
  trimmed: boolean;
}

export type ContextCategory =
  | "content_strategy"
  | "source_content"
  | "audience"
  | "offer_and_proof"
  | "script_and_message"
  | "brand_voice"
  | "visual_brand"
  | "avatar_os"
  | "production_constraints"
  | "storytelling_rules";

export const CONTEXT_CATEGORIES: ContextCategory[] = [
  "content_strategy",
  "source_content",
  "audience",
  "offer_and_proof",
  "script_and_message",
  "brand_voice",
  "visual_brand",
  "avatar_os",
  "production_constraints",
  "storytelling_rules",
];

/**
 * Categories the storyboard cannot be honestly generated without. A pack that
 * is missing one of these is reported, not silently degraded.
 */
export const MANDATORY_CATEGORIES: ContextCategory[] = [
  "script_and_message",
  "visual_brand",
  "source_content",
];

/**
 * Per-category character budgets. Deliberately generous for the bound brief's
 * own script/message content (the single highest-authority input) and tight for
 * supporting context, so a long avatar document can never crowd out the CTA.
 */
export const CATEGORY_BUDGETS: Record<ContextCategory, number> = {
  content_strategy: 3500,
  source_content: 1200,
  audience: 3000,
  offer_and_proof: 3500,
  script_and_message: 9000,
  brand_voice: 2000,
  visual_brand: 2500,
  avatar_os: 4500,
  production_constraints: 1500,
  storytelling_rules: 2500,
};

/** Headings inside the production brief that carry the script and the message. */
const SCRIPT_HEADING = /script|voice ?over|vo\b|caption|hook|cta|call to action|copy|message|narration/i;
/** Headings inside the production brief that carry production direction. */
const PRODUCTION_HEADING = /production|edit|deliverable|spec|format|duration|shot|visual|b-?roll|direction/i;
/** Headings inside the production brief that carry strategy. */
const STRATEGY_HEADING = /strateg|objective|goal|angle|positioning|awareness|audience|why/i;

export interface ContextPack {
  categories: Record<ContextCategory, ContextSlice[]>;
  /** Categories that resolved to zero admitted text. */
  missing: ContextCategory[];
  /** Mandatory categories that resolved to zero admitted text. */
  missingMandatory: ContextCategory[];
  provenance: ContextPackProvenance;
}

export interface ContextPackProvenance {
  context_pack_version: string;
  production_brief_id: string;
  source_master_id: string;
  source_table: string;
  context_file_ids: string[];
  context_file_names: string[];
  execution_file_ids: string[];
  execution_file_names: string[];
  brand_prompt_block_id: string;
  brand_prompt_block_version: number;
  avatar_release_id?: string | null;
  avatar_asset_ids?: string[];
  excluded_unapproved_context_files: number;
  excluded_unapproved_execution_files: number;
  trimmed_sections: string[];
  dropped_sections: string[];
  category_chars: Record<string, number>;
}

/**
 * Split a markdown document into `##`/`###` sections. Text before the first
 * heading is returned under a synthetic "(preamble)" heading so a document with
 * no headings is still usable rather than silently dropped.
 */
export function splitMarkdownSections(markdown: string): MarkdownSection[] {
  const text = (markdown ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const lines = text.split("\n");
  const sections: MarkdownSection[] = [];
  let heading = "(preamble)";
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body) sections.push({ heading, body });
    buffer = [];
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      flush();
      heading = match[2].trim() || "(untitled)";
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * Trim to a paragraph boundary at or under `limit`, falling back to a sentence
 * boundary, and only then to a hard cut. Never returns more than `limit`.
 * This is the one place a cut may happen, and callers record that it did.
 */
export function trimAtBoundary(text: string, limit: number): { text: string; trimmed: boolean } {
  const clean = text.trim();
  if (clean.length <= limit) return { text: clean, trimmed: false };
  if (limit <= 0) return { text: "", trimmed: true };

  const window = clean.slice(0, limit);
  const paragraph = window.lastIndexOf("\n\n");
  if (paragraph >= limit * 0.4) {
    return { text: window.slice(0, paragraph).trim(), trimmed: true };
  }
  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf(".\n"),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );
  if (sentence >= limit * 0.4) {
    return { text: window.slice(0, sentence + 1).trim(), trimmed: true };
  }
  return { text: window.trim(), trimmed: true };
}

/**
 * Admit sections into a category until the budget is exhausted. Sections are
 * whole-or-trimmed, never head-sliced across the document, and every trim or
 * drop is reported to the caller.
 */
export function admitSections(
  slices: Array<{ origin: string; heading: string; text: string }>,
  budget: number,
): { admitted: ContextSlice[]; trimmed: string[]; dropped: string[] } {
  const admitted: ContextSlice[] = [];
  const trimmed: string[] = [];
  const dropped: string[] = [];
  let remaining = budget;

  for (const slice of slices) {
    const body = slice.text.trim();
    if (!body) continue;
    const label = `${slice.origin} :: ${slice.heading}`;

    if (remaining <= 0) {
      dropped.push(label);
      continue;
    }
    if (body.length <= remaining) {
      admitted.push({ ...slice, text: body, trimmed: false });
      remaining -= body.length;
      continue;
    }
    // Only worth trimming if a useful amount survives; otherwise drop whole.
    if (remaining < 400) {
      dropped.push(label);
      continue;
    }
    const cut = trimAtBoundary(body, remaining);
    if (!cut.text) {
      dropped.push(label);
      continue;
    }
    admitted.push({ ...slice, text: cut.text, trimmed: cut.trimmed });
    if (cut.trimmed) trimmed.push(label);
    remaining -= cut.text.length;
  }

  return { admitted, trimmed, dropped };
}

function contextFileCategory(fileNumber: number): ContextCategory | null {
  switch (fileNumber) {
    case 2:
    case 6:
      return "audience";
    case 3:
    case 4:
      return "offer_and_proof";
    case 7:
      return "brand_voice";
    case 9:
      return "content_strategy";
    case 10:
      return "storytelling_rules";
    default:
      return null;
  }
}

export interface BuildContextPackInput {
  brief: { id: string; title: string; content_md: string | null; source_ref: string; source_table: string };
  sourceRowId: string;
  project: {
    title: string;
    archetype: string;
    awareness_stage: string;
    target_duration_sec: number;
  };
  brand: BrandBlockRow;
  contextFiles: ContextFileRow[];
  executionFiles: ExecutionFileRow[];
  clientId: string;
  avatarReferencePayload?: Record<string, unknown> | null;
}

/**
 * Assemble the storyboard context pack from approved authority only.
 *
 * Callers pass raw rows; this function performs the approval and tenancy
 * filtering itself so the rule cannot be bypassed by a careless query.
 */
export function buildContextPack(input: BuildContextPackInput): ContextPack {
  const categories = Object.fromEntries(
    CONTEXT_CATEGORIES.map((c) => [c, [] as ContextSlice[]]),
  ) as Record<ContextCategory, ContextSlice[]>;

  const trimmedSections: string[] = [];
  const droppedSections: string[] = [];

  // --- Approved-authority filtering -----------------------------------------
  const approvedContext = input.contextFiles.filter(
    (f) =>
      f.client_id === input.clientId &&
      f.status === "approved" &&
      (REEL_RELEVANT_CONTEXT_FILE_NUMBERS as readonly number[]).includes(f.file_number) &&
      (f.content_md ?? "").trim().length > 0,
  );
  const excludedContext = input.contextFiles.length - approvedContext.length;

  const approvedExecution = input.executionFiles.filter(
    (f) =>
      f.client_id === input.clientId &&
      f.review_state === "approved" &&
      REEL_RELEVANT_EXECUTION_FILE_PATTERN.test(`${f.file_name} ${f.file_type ?? ""}`) &&
      (f.content_md ?? "").trim().length > 0,
  );
  const excludedExecution = input.executionFiles.length - approvedExecution.length;

  // --- The bound production brief (highest authority) ------------------------
  const briefSections = splitMarkdownSections(input.brief.content_md ?? "");
  const briefOrigin = `production_brief:${input.brief.source_ref}`;

  const scriptSections = briefSections.filter((s) => SCRIPT_HEADING.test(s.heading));
  const productionSections = briefSections.filter(
    (s) => !SCRIPT_HEADING.test(s.heading) && PRODUCTION_HEADING.test(s.heading),
  );
  const strategySections = briefSections.filter(
    (s) =>
      !SCRIPT_HEADING.test(s.heading) &&
      !PRODUCTION_HEADING.test(s.heading) &&
      STRATEGY_HEADING.test(s.heading),
  );
  const otherBriefSections = briefSections.filter(
    (s) =>
      !SCRIPT_HEADING.test(s.heading) &&
      !PRODUCTION_HEADING.test(s.heading) &&
      !STRATEGY_HEADING.test(s.heading),
  );

  // A brief with no recognised headings must still deliver its message, so the
  // unclassified remainder backs the script category rather than being dropped.
  const scriptCandidates = scriptSections.length ? scriptSections : otherBriefSections;

  const admit = (
    category: ContextCategory,
    slices: Array<{ origin: string; heading: string; text: string }>,
  ) => {
    const used = categories[category].reduce((sum, s) => sum + s.text.length, 0);
    const result = admitSections(slices, CATEGORY_BUDGETS[category] - used);
    categories[category].push(...result.admitted);
    trimmedSections.push(...result.trimmed);
    droppedSections.push(...result.dropped);
  };

  admit(
    "script_and_message",
    scriptCandidates.map((s) => ({ origin: briefOrigin, heading: s.heading, text: s.body })),
  );
  admit(
    "production_constraints",
    productionSections.map((s) => ({ origin: briefOrigin, heading: s.heading, text: s.body })),
  );
  admit(
    "content_strategy",
    strategySections.map((s) => ({ origin: briefOrigin, heading: s.heading, text: s.body })),
  );
  // Any brief remainder not already used as the script backs strategy.
  if (scriptSections.length) {
    admit(
      "content_strategy",
      otherBriefSections.map((s) => ({ origin: briefOrigin, heading: s.heading, text: s.body })),
    );
  }

  // --- Source identity -------------------------------------------------------
  admit("source_content", [
    {
      origin: briefOrigin,
      heading: "Source row",
      text: [
        `Source: ${input.brief.source_table}/${input.brief.source_ref}`,
        `Brief title: ${input.brief.title}`,
        `Project title: ${input.project.title}`,
      ].join("\n"),
    },
  ]);

  // --- Project constraints ---------------------------------------------------
  admit("production_constraints", [
    {
      origin: "video_project",
      heading: "Project constraints",
      text: [
        `Archetype: ${input.project.archetype}`,
        `Audience awareness: ${input.project.awareness_stage.replaceAll("_", " ")}`,
        `Target duration: ${input.project.target_duration_sec}s`,
        input.avatarReferencePayload && Object.keys(input.avatarReferencePayload).length > 0
          ? "Format: vertical 9:16 avatar-led Instagram Reel using approved Avatar OS references only."
          : "Format: vertical 9:16 faceless Instagram Reel.",
      ].join("\n"),
    },
  ]);

  // --- Approved Client Context OS files -------------------------------------
  for (const file of [...approvedContext].sort((a, b) => a.file_number - b.file_number)) {
    const category = contextFileCategory(file.file_number);
    if (!category) continue;
    const sections = splitMarkdownSections(file.content_md ?? "");
    admit(
      category,
      sections.map((s) => ({
        origin: `context_file:${file.file_name}`,
        heading: s.heading,
        text: s.body,
      })),
    );
  }

  // --- Approved execution files ---------------------------------------------
  for (const file of approvedExecution) {
    const sections = splitMarkdownSections(file.content_md ?? "");
    admit(
      "content_strategy",
      sections.map((s) => ({
        origin: `execution_file:${file.file_name}`,
        heading: s.heading,
        text: s.body,
      })),
    );
  }

  // --- Visual brand (the only brand authority that exists) -------------------
  const brandLines = [
    input.brand.grade_block && `Grade: ${input.brand.grade_block}`,
    input.brand.lens_block && `Lens: ${input.brand.lens_block}`,
    input.brand.mood_block && `Mood: ${input.brand.mood_block}`,
    input.brand.motion_block && `Motion guidance: ${input.brand.motion_block}`,
    input.brand.negative_block && `Negative requirements: ${input.brand.negative_block}`,
  ].filter(Boolean) as string[];
  admit("visual_brand", [
    {
      origin: `brand_prompt_block:${input.brand.id}@v${input.brand.version}`,
      heading: "Brand DNA",
      text: brandLines.join("\n"),
    },
  ]);

  if (input.avatarReferencePayload && Object.keys(input.avatarReferencePayload).length > 0) {
    const release = input.avatarReferencePayload.avatar_release;
    const components = input.avatarReferencePayload.components;
    const assets = input.avatarReferencePayload.approved_assets;
    const guardrails = input.avatarReferencePayload.guardrails;
    const text = [
      "Approved Avatar OS reference pack. Use only this approved avatar authority when the production mode is avatar_led.",
      `Release: ${JSON.stringify(release ?? {})}`,
      `Components: ${JSON.stringify(components ?? {})}`,
      `Approved assets and prompt packs: ${JSON.stringify(assets ?? [])}`,
      `Guardrails: ${JSON.stringify(guardrails ?? [])}`,
    ].join("\n");
    admit("avatar_os", [{
      origin: "avatar_os:active_approved_release",
      heading: "Avatar OS production references",
      text,
    }]);
  }

  const missing = CONTEXT_CATEGORIES.filter((c) => categories[c].length === 0);
  const missingMandatory = MANDATORY_CATEGORIES.filter((c) => categories[c].length === 0);

  const categoryChars: Record<string, number> = {};
  for (const c of CONTEXT_CATEGORIES) {
    categoryChars[c] = categories[c].reduce((sum, s) => sum + s.text.length, 0);
  }

  return {
    categories,
    missing,
    missingMandatory,
    provenance: {
      context_pack_version: CONTEXT_PACK_VERSION,
      production_brief_id: input.brief.id,
      source_master_id: input.sourceRowId,
      source_table: input.brief.source_table,
      context_file_ids: approvedContext.map((f) => f.id),
      context_file_names: approvedContext.map((f) => f.file_name),
      execution_file_ids: approvedExecution.map((f) => f.id),
      execution_file_names: approvedExecution.map((f) => f.file_name),
      brand_prompt_block_id: input.brand.id,
      brand_prompt_block_version: input.brand.version,
      avatar_release_id: typeof input.avatarReferencePayload?.avatar_release === "object" && input.avatarReferencePayload.avatar_release !== null
        ? String((input.avatarReferencePayload.avatar_release as Record<string, unknown>).id ?? "")
        : null,
      avatar_asset_ids: Array.isArray(input.avatarReferencePayload?.approved_assets)
        ? input.avatarReferencePayload.approved_assets
          .map((asset) => typeof asset === "object" && asset !== null ? String((asset as Record<string, unknown>).id ?? "") : "")
          .filter(Boolean)
        : [],
      excluded_unapproved_context_files: excludedContext,
      excluded_unapproved_execution_files: excludedExecution,
      trimmed_sections: trimmedSections,
      dropped_sections: droppedSections,
      category_chars: categoryChars,
    },
  };
}

/** Render a pack as the prompt-facing text block, in a stable category order. */
export function renderContextPack(pack: ContextPack): string {
  const parts: string[] = [];
  for (const category of CONTEXT_CATEGORIES) {
    const slices = pack.categories[category];
    if (!slices.length) continue;
    const body = slices
      .map((s) => `[${s.origin} — ${s.heading}${s.trimmed ? " (trimmed at boundary)" : ""}]\n${s.text}`)
      .join("\n\n");
    parts.push(`### ${category.toUpperCase()}\n${body}`);
  }
  if (pack.missing.length) {
    parts.push(
      `### CONTEXT GAPS\nNo approved authority was available for: ${pack.missing.join(", ")}. ` +
        "Do not invent facts to fill these gaps; work only from what is supplied above.",
    );
  }
  return parts.join("\n\n");
}
