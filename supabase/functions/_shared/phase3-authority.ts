export type Phase3AuthorityFormat = "feed_post" | "carousel" | "reel_video" | "story_sequence" | "ad_static";

export interface Phase3AuthorityFile {
  file_number: number | null;
  file_name: string;
  content_md: string | null;
}

export const CTA_GUIDANCE_HEADING = "Low-Confidence CTA Test Guidance";
const TARGET_CONTEXT_FILE_NUMBER = 9;
const TARGET_SECTION_LIMIT = 1_200;

/**
 * Extract one Markdown section, stopping at the next heading of the same or a
 * higher level. Missing/malformed headings return an empty string.
 */
export function extractMarkdownSection(content: string, heading: string, maxChars = TARGET_SECTION_LIMIT): string {
  if (!content || !heading.trim() || maxChars <= 0) return "";
  const lines = content.split(/\r?\n/);
  const wanted = heading.trim().replace(/^#{1,6}\s+/, "").trim();
  let start = -1;
  let level = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match && match[2].trim() === wanted) {
      start = index;
      level = match[1].length;
      break;
    }
  }
  if (start < 0) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match && match[1].length <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim().slice(0, maxChars).trim();
}

export function shouldIncludeCtaGuidance(format: Phase3AuthorityFormat): boolean {
  return format === "feed_post" || format === "carousel";
}

/** Keep the existing bounded general excerpt and append only approved targeted sections. */
export function buildPhase3ContextFileExcerpt(
  file: Phase3AuthorityFile,
  format: Phase3AuthorityFormat | null,
  generalLimit: number,
): string {
  const content = file.content_md ?? "";
  const general = content.slice(0, Math.max(0, generalLimit));
  if (
    file.file_number !== TARGET_CONTEXT_FILE_NUMBER ||
    !format ||
    !shouldIncludeCtaGuidance(format) ||
    general.includes(CTA_GUIDANCE_HEADING)
  ) return general;

  const targeted = extractMarkdownSection(content, CTA_GUIDANCE_HEADING);
  if (!targeted) return general;
  return `${general}\n\n===== TARGETED CONTEXT SECTION FROM ${file.file_name} =====\n${targeted}`;
}
