// Stage 2 Phase 04 — Knowledge (thin). A pure, client-side search/cross-
// reference layer over content already fetched from the real
// client_context_files / client_execution_files tables -- no new schema, no
// new capture mechanism, no separate index to keep in sync. Splits each
// file's content_md into its markdown sections so a match points at the
// specific heading that answers the question, not just "somewhere in this
// 7KB file."

export interface KnowledgeSection {
  sourceKind: "context" | "execution";
  fileName: string;
  fileNumber: number | null;
  heading: string;
  body: string;
}

export interface KnowledgeSearchResult extends KnowledgeSection {
  score: number;
  snippet: string;
}

interface KnowledgeFileLike {
  file_name: string;
  file_number: number | null;
  content_md: string | null;
}

/** Splits a markdown document into (heading, body) sections at each `#`-`###` heading. Content before the first heading becomes one section titled with the file name. */
export function splitIntoSections(fileName: string, contentMd: string): Array<{ heading: string; body: string }> {
  const lines = contentMd.split("\n");
  const sections: Array<{ heading: string; body: string[] }> = [{ heading: fileName, body: [] }];
  for (const line of lines) {
    const match = /^#{1,3}\s+(.+)$/.exec(line);
    if (match) {
      sections.push({ heading: match[1].trim(), body: [] });
    } else {
      sections[sections.length - 1].body.push(line);
    }
  }
  return sections
    .map((s) => ({ heading: s.heading, body: s.body.join("\n").trim() }))
    .filter((s) => s.body.length > 0);
}

export function buildKnowledgeIndex(
  contextFiles: readonly KnowledgeFileLike[],
  executionFiles: readonly KnowledgeFileLike[],
): KnowledgeSection[] {
  const index: KnowledgeSection[] = [];
  for (const file of contextFiles) {
    if (!file.content_md) continue;
    for (const section of splitIntoSections(file.file_name, file.content_md)) {
      index.push({ sourceKind: "context", fileName: file.file_name, fileNumber: file.file_number, ...section });
    }
  }
  for (const file of executionFiles) {
    if (!file.content_md) continue;
    for (const section of splitIntoSections(file.file_name, file.content_md)) {
      index.push({ sourceKind: "execution", fileName: file.file_name, fileNumber: file.file_number, ...section });
    }
  }
  return index;
}

function snippetAround(body: string, terms: string[], radius = 160): string {
  const lower = body.toLowerCase();
  const hitIndex = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (hitIndex === undefined) return body.slice(0, radius * 2).trim();
  const start = Math.max(0, hitIndex - radius);
  const end = Math.min(body.length, hitIndex + radius);
  return `${start > 0 ? "…" : ""}${body.slice(start, end).trim()}${end < body.length ? "…" : ""}`;
}

/** Ranks sections by term-occurrence count across heading + body. Deterministic, no external ranking service. */
export function searchKnowledge(index: readonly KnowledgeSection[], query: string): KnowledgeSearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (terms.length === 0) return [];
  const results: KnowledgeSearchResult[] = [];
  for (const section of index) {
    const haystack = `${section.heading}\n${section.body}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      let from = 0;
      for (;;) {
        const at = haystack.indexOf(term, from);
        if (at === -1) break;
        score += 1;
        from = at + term.length;
      }
    }
    if (score > 0) results.push({ ...section, score, snippet: snippetAround(section.body, terms) });
  }
  return results.sort((a, b) => b.score - a.score);
}
