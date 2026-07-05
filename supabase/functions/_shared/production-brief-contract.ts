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
