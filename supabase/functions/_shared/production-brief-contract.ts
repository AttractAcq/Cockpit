export const ASSET_FORMATS = ["ad_static", "reel_video", "story_sequence", "carousel", "feed_post"] as const;
export type AssetFormat = typeof ASSET_FORMATS[number];
export type ProductionSourceTable = "organic_master" | "story_master" | "ads_master";

export interface ProductionBriefFormatContract {
  label: string;
  aspectRatio: string;
  output: string;
  humanOnly: boolean;
  requiredSections: readonly string[];
}

const COMMON_SECTIONS = ["Source and Objective", "Brand and Creative Direction", "Proof and Claim Boundaries", "Call to Action", "Production Checklist"] as const;

export const PRODUCTION_BRIEF_CONTRACTS: Record<AssetFormat, ProductionBriefFormatContract> = {
  feed_post: {
    label: "Instagram Feed Post", aspectRatio: "4:5", output: "One static image", humanOnly: false,
    requiredSections: [...COMMON_SECTIONS, "Hook and Copy Direction", "Visual Hierarchy"],
  },
  carousel: {
    label: "Instagram Carousel", aspectRatio: "4:5 per slide", output: "Multi-slide carousel", humanOnly: false,
    requiredSections: [...COMMON_SECTIONS, "Slide-by-Slide Structure", "Cover Slide", "CTA Slide", "Design System Notes"],
  },
  story_sequence: {
    label: "Instagram Story Sequence", aspectRatio: "9:16", output: "Multi-frame story sequence", humanOnly: false,
    requiredSections: [...COMMON_SECTIONS, "Frame-by-Frame Structure", "Tap-Forward Logic", "Interactive Elements", "CTA Frame"],
  },
  reel_video: {
    label: "Instagram Reel", aspectRatio: "9:16", output: "Short-form video", humanOnly: true,
    requiredSections: [...COMMON_SECTIONS, "Video Length and Hook", "Shot List", "Voiceover and Script Direction", "B-Roll Direction", "Captions and Editing Rhythm", "Human Production Only"],
  },
  ad_static: {
    label: "Instagram Static Image Ad", aspectRatio: "4:5 unless the approved execution plan specifies otherwise", output: "One static image ad", humanOnly: false,
    requiredSections: [...COMMON_SECTIONS, "Campaign Lane and Audience", "Visual Concept", "Headline and Primary Text Direction", "Compliance Notes"],
  },
};

function normalized(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replaceAll("_", " ").replaceAll("-", " ") : "";
}

export function resolveAssetFormat(sourceTable: ProductionSourceTable, row: Record<string, unknown>): AssetFormat {
  if (sourceTable === "story_master") return "story_sequence";
  if (sourceTable === "ads_master") return "ad_static";
  const type = normalized(row.content_type);
  if (type.includes("reel") || type === "rl") return "reel_video";
  if (type.includes("carousel") || type === "cr") return "carousel";
  if (type.includes("feed") || type.includes("static") || type.includes("post") || type === "fp") return "feed_post";
  throw new Error(`Unsupported organic content_type: ${String(row.content_type ?? "missing")}`);
}

export function missingBriefSections(markdown: string, format: AssetFormat): string[] {
  const headings = new Set([...markdown.matchAll(/^#{1,4}\s+(.+)$/gm)].map((match) => match[1].trim().toLowerCase()));
  return PRODUCTION_BRIEF_CONTRACTS[format].requiredSections.filter((section) => !headings.has(section.toLowerCase()));
}

// ── Multi-image count resolution (shared by the UI and the edge generator) ────
// Single source of truth so the Produce confirmation and the generator agree on
// how many slides/frames a carousel/story brief requires. Resolves in priority
// order and NEVER silently defaults — an unresolved count returns `ambiguous`,
// which the UI must confirm and the generator must reject.
export type MultiImageCountSource = "metadata" | "count_field" | "phrase" | "enumerated" | "single" | "ambiguous";

export interface MultiImageCount {
  /** null only when source is "ambiguous" (or a reel). */
  count: number | null;
  source: MultiImageCountSource;
  label: "slide" | "frame" | "image";
  maxItems: number;
}

const MULTI_IMAGE_MAX: Record<AssetFormat, number> = {
  feed_post: 1, ad_static: 1, carousel: 10, story_sequence: 12, reel_video: 0,
};

const WORD_NUMBERS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

export function resolveMultiImageCount(
  brief: { asset_format: AssetFormat; content_md: string; metadata?: Record<string, unknown> | null },
): MultiImageCount {
  const format = brief.asset_format;
  if (format === "feed_post" || format === "ad_static") return { count: 1, source: "single", label: "image", maxItems: 1 };
  if (format === "reel_video") return { count: null, source: "ambiguous", label: "image", maxItems: 0 };

  const label: "slide" | "frame" = format === "carousel" ? "slide" : "frame";
  const maxItems = MULTI_IMAGE_MAX[format];
  const md = brief.content_md ?? "";
  const meta = (brief.metadata ?? {}) as Record<string, unknown>;
  const clamp = (n: number): number => Math.max(0, Math.min(maxItems, Math.trunc(n)));

  // 1. Structured metadata — authoritative when present.
  for (const key of [`${label}_count`, "expected_output_count", "slide_count", "frame_count"]) {
    const value = meta[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 1) return { count: clamp(value), source: "metadata", label, maxItems };
  }

  // 2. Explicit "Slide Count" / "Frame Count" field (e.g. table row "| Slide Count | 6 |").
  const fieldMatch = md.match(new RegExp(`${label}\\s*count\\s*[:|]?\\s*(\\d{1,2})`, "i"));
  if (fieldMatch) return { count: clamp(Number(fieldMatch[1])), source: "count_field", label, maxItems };

  // 3. Count phrases: "6-slide carousel", "6 slides", "six frames".
  const digitPhrase = md.match(new RegExp(`(\\d{1,2})[-\\s]*${label}s?\\b`, "i"));
  if (digitPhrase) return { count: clamp(Number(digitPhrase[1])), source: "phrase", label, maxItems };
  const wordPhrase = md.match(new RegExp(`\\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\\s+${label}s\\b`, "i"));
  if (wordPhrase) {
    const n = WORD_NUMBERS[wordPhrase[1].toLowerCase()];
    if (n) return { count: clamp(n), source: "phrase", label, maxItems };
  }

  // 4. Enumerated headings ("Slide 1", "Slide 2 of 6", …) — highest index seen.
  const enumerated = [...md.matchAll(new RegExp(`\\b${label}\\s*(\\d{1,2})\\b`, "gi"))]
    .map((match) => Number(match[1])).filter((n) => n >= 1 && n <= maxItems);
  if (enumerated.length) {
    const max = Math.max(...enumerated);
    if (max >= 2) return { count: max, source: "enumerated", label, maxItems };
  }

  // Could not determine confidently — caller must confirm; generator must reject.
  return { count: null, source: "ambiguous", label, maxItems };
}

export const MULTI_IMAGE_SOURCE_LABEL: Record<MultiImageCountSource, string> = {
  metadata: "from structured brief metadata",
  count_field: "from the brief's Slide/Frame Count field",
  phrase: "from the brief text",
  enumerated: "from the enumerated slide/frame headings",
  single: "single image",
  ambiguous: "could not be determined from the brief",
};
