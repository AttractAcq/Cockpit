import type {
  IntelligenceDomain,
  IntelligenceRecord,
  IntelligenceRelease,
  IntelligenceWorkspace,
} from "@/types/intelligence";

const DOMAIN_LABELS: Record<IntelligenceDomain, string> = {
  market_os: "Market OS",
  avatar_os: "Avatar OS",
  competitor_os: "Competitor OS",
  association_os: "Association OS",
  brand_strategist: "Brand Strategist",
};

export interface IntelligenceExportInput {
  clientName: string;
  workspace: IntelligenceWorkspace;
}

function selectedRelease(workspace: IntelligenceWorkspace): IntelligenceRelease | null {
  return workspace.latestRelease ?? workspace.activeRelease;
}

function readable(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isoDate(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toISOString();
}

function displayDate(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "long" }).format(date);
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function markdownText(value: string): string {
  return value.replaceAll("\r\n", "\n").trim();
}

function valueToText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not declared";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(valueToText).join(", ");
  return JSON.stringify(value, null, 2);
}

function recordDetails(record: IntelligenceRecord): Array<{ label: string; value: string }> {
  const explicit = record.payload.details;
  if (Array.isArray(explicit)) {
    const details = explicit.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as { label?: unknown; value?: unknown };
      return typeof candidate.label === "string"
        ? [{ label: candidate.label, value: valueToText(candidate.value) }]
        : [];
    });
    if (details.length) return details;
  }

  const clientFacingKeys = new Set([
    "record_kind",
    "recommendation_type",
    "priority",
    "rationale",
    "expected_impact",
    "dependencies",
    "risks",
    "trade_offs",
    "contradictions",
    "downstream_owner",
    "proposed_next_action",
    "validation_needed",
  ]);
  return Object.entries(record.payload)
    .filter(([key]) => clientFacingKeys.has(key))
    .map(([key, value]) => ({ label: readable(key), value: valueToText(value) }));
}

function jsonFence(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

export function intelligenceExportFilename(input: IntelligenceExportInput, extension: "pdf" | "md"): string {
  const release = selectedRelease(input.workspace);
  const slug = `${input.clientName}-${DOMAIN_LABELS[input.workspace.domain]}-v${release?.version ?? 0}`
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "intelligence-export"}.${extension}`;
}

export function buildIntelligenceMarkdown(input: IntelligenceExportInput): string {
  const { clientName, workspace } = input;
  const release = selectedRelease(workspace);
  if (!release) throw new Error(`${DOMAIN_LABELS[workspace.domain]} has not been built yet.`);

  const lines: string[] = [
    "---",
    `document_type: ${yamlString("intelligence_context_export")}`,
    `client: ${yamlString(clientName)}`,
    `intelligence_domain: ${yamlString(workspace.domain)}`,
    `release_id: ${yamlString(release.id)}`,
    `version: ${release.version}`,
    `release_status: ${yamlString(release.status)}`,
    `is_active_authority: ${workspace.activeRelease?.id === release.id}`,
    `generated_at: ${yamlString(isoDate(release.generated_at ?? release.created_at))}`,
    `exported_at: ${yamlString(new Date().toISOString())}`,
    `freshness: ${yamlString(workspace.freshness)}`,
    `next_refresh_at: ${workspace.nextRefreshAt ? yamlString(isoDate(workspace.nextRefreshAt)) : "null"}`,
    "---",
    "",
    `# ${clientName} - ${DOMAIN_LABELS[workspace.domain]}`,
    "",
    "> Context export. This document preserves structured intelligence, evidence and release authority for downstream AI and operator use.",
    "",
    "## Release",
    "",
    `- **Title:** ${release.title}`,
    `- **Version:** ${release.version}`,
    `- **Status:** ${readable(release.status)}`,
    `- **Active authority:** ${workspace.activeRelease?.id === release.id ? "Yes" : "No"}`,
    `- **Generated:** ${isoDate(release.generated_at ?? release.created_at)}`,
    `- **Approved:** ${isoDate(release.approved_at)}`,
    `- **Freshness:** ${readable(workspace.freshness)}`,
    "",
    "## Executive summary",
    "",
    markdownText(release.summary) || "No release summary was supplied.",
    "",
    "## Structured intelligence",
    "",
  ];

  if (!workspace.records.length) lines.push("No structured records were produced.", "");
  workspace.records.forEach((record, index) => {
    lines.push(`### ${index + 1}. ${record.title}`, "", `**Type:** ${readable(record.record_type)}`, "");
    if (record.summary) lines.push(markdownText(record.summary), "");
    const details = recordDetails(record);
    if (details.length) {
      details.forEach((detail) => lines.push(`- **${detail.label}:** ${markdownText(detail.value)}`));
      lines.push("");
    }
    lines.push("<details>", "<summary>Structured record payload</summary>", "", jsonFence(record.payload), "", "</details>", "");
  });

  lines.push("## Findings", "");
  if (!workspace.findings.length) lines.push("No atomic findings were linked to this release.", "");
  workspace.findings.forEach((finding, index) => {
    lines.push(
      `### Finding ${index + 1}`,
      "",
      markdownText(finding.claim),
      "",
      `- **Disposition:** ${readable(finding.disposition)}`,
      `- **Confidence:** ${finding.confidence_level ? readable(finding.confidence_level) : "Not applicable"}`,
      `- **Contradiction status:** ${readable(finding.contradiction_status)}`,
    );
    if (finding.rationale) lines.push(`- **Rationale:** ${markdownText(finding.rationale)}`);
    if (Object.keys(finding.metadata).length) lines.push("", jsonFence(finding.metadata));
    lines.push("");
  });

  lines.push("## Evidence", "");
  if (!workspace.evidence.length) lines.push("No evidence records were linked to this release.", "");
  workspace.evidence.forEach((evidence, index) => {
    lines.push(
      `### Evidence ${index + 1}`,
      "",
      markdownText(evidence.evidence_text),
      "",
      `- **Kind:** ${readable(evidence.evidence_kind)}`,
      `- **Source type:** ${readable(evidence.source_type)}`,
      `- **Source quality:** ${readable(evidence.source_quality)}`,
      `- **Inspectable:** ${evidence.inspectable ? "Yes" : "No"}`,
      `- **Observed:** ${isoDate(evidence.observed_at)}`,
    );
    if (Object.keys(evidence.locator).length) lines.push("", "**Locator**", "", jsonFence(evidence.locator));
    lines.push("");
  });

  lines.push("## Sources", "");
  if (!workspace.sources.length) lines.push("No inspectable research sources were linked to this release.", "");
  workspace.sources.forEach((source, index) => {
    lines.push(
      `${index + 1}. **${source.title || source.publisher || source.url}**`,
      `   - URL: ${source.url}`,
      `   - Publisher: ${source.publisher ?? "Not recorded"}`,
      `   - Quality: ${readable(source.source_quality)}`,
      `   - Retrieved: ${isoDate(source.retrieved_at)}`,
      `   - Inspectable: ${source.inspectable ? "Yes" : "No"}`,
    );
  });

  lines.push(
    "",
    "## Authority snapshot",
    "",
    jsonFence(release.authority_snapshot),
    "",
    "## Release payload",
    "",
    jsonFence(release.content),
    "",
  );
  return `${lines.join("\n")}\n`;
}

function pdfText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "-")
    // eslint-disable-next-line no-control-regex -- intentional allowlist: keeps tab/LF/CR plus printable ASCII, strips everything else for PDF-safe output.
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

export async function buildIntelligencePdf(input: IntelligenceExportInput): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const { clientName, workspace } = input;
  const release = selectedRelease(workspace);
  if (!release) throw new Error(`${DOMAIN_LABELS[workspace.domain]} has not been built yet.`);

  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 52;
  const contentWidth = pageWidth - margin * 2;
  const teal: [number, number, number] = [14, 168, 146];
  const ink: [number, number, number] = [24, 31, 35];
  const muted: [number, number, number] = [90, 101, 106];
  let y = 0;

  const addPage = () => {
    doc.addPage();
    y = margin;
  };
  const ensure = (height: number) => {
    if (y + height > pageHeight - 58) addPage();
  };
  const paragraph = (text: string, options?: { size?: number; color?: [number, number, number]; indent?: number; gap?: number }) => {
    const size = options?.size ?? 10;
    const indent = options?.indent ?? 0;
    const lines = doc.splitTextToSize(pdfText(text), contentWidth - indent);
    const lineHeight = size * 1.45;
    ensure(lines.length * lineHeight + (options?.gap ?? 8));
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...(options?.color ?? ink));
    doc.text(lines, margin + indent, y, { lineHeightFactor: 1.45 });
    y += lines.length * lineHeight + (options?.gap ?? 8);
  };
  const heading = (text: string, level: 1 | 2) => {
    const size = level === 1 ? 18 : 12;
    ensure(size + 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(...(level === 1 ? ink : teal));
    doc.text(pdfText(text), margin, y);
    y += size + (level === 1 ? 12 : 8);
  };
  const labelledDetail = (label: string, value: string) => {
    const size = 9.5;
    const indent = 12;
    const lines = doc.splitTextToSize(pdfText(value), contentWidth - indent);
    const lineHeight = size * 1.45;
    ensure(13 + lines.length * lineHeight + 9);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...ink);
    doc.text(pdfText(label.toUpperCase()), margin + indent, y);
    y += 13;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...muted);
    doc.text(lines, margin + indent, y, { lineHeightFactor: 1.45 });
    y += lines.length * lineHeight + 9;
  };

  doc.setFillColor(...ink);
  doc.rect(0, 0, pageWidth, 220, "F");
  doc.setFillColor(...teal);
  doc.rect(0, 0, 8, 220, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...teal);
  doc.text("ATTRACT ACQUISITION", margin, 62);
  doc.setFontSize(28);
  doc.setTextColor(255, 255, 255);
  doc.text(pdfText(DOMAIN_LABELS[workspace.domain]), margin, 112);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(16);
  doc.text(pdfText(clientName), margin, 140);
  doc.setFontSize(9);
  doc.setTextColor(196, 204, 207);
  doc.text(`VERSION ${release.version}  |  ${readable(release.status).toUpperCase()}  |  ${displayDate(release.generated_at ?? release.created_at).toUpperCase()}`, margin, 184);
  y = 268;

  if (release.status !== "approved") {
    doc.setFillColor(255, 245, 214);
    doc.roundedRect(margin, y - 17, contentWidth, 30, 4, 4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(132, 85, 13);
    doc.text("DRAFT - HUMAN APPROVAL REQUIRED BEFORE CLIENT DISTRIBUTION", margin + 12, y + 2);
    y += 36;
  }

  heading("Executive summary", 1);
  paragraph(release.summary || "No executive summary was supplied.", { size: 11, color: muted, gap: 20 });

  if (workspace.records.length) {
    heading("Intelligence", 1);
    workspace.records.forEach((record, index) => {
      const details = recordDetails(record);
      const summaryLines = record.summary ? doc.splitTextToSize(pdfText(record.summary), contentWidth).length : 0;
      const detailHeight = details.reduce((height, detail) => {
        const valueLines = doc.splitTextToSize(pdfText(detail.value), contentWidth - 12).length;
        return height + 13 + valueLines * 9.5 * 1.45 + 9;
      }, 0);
      const recordHeight = 18 + 20 + summaryLines * 10 * 1.45 + (record.summary ? 8 : 0) + detailHeight + 28;
      ensure(Math.min(recordHeight, pageHeight - margin * 2 - 40));
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...teal);
      doc.text(`${String(index + 1).padStart(2, "0")}  ${readable(record.record_type).toUpperCase()}`, margin, y);
      y += 18;
      heading(record.title, 2);
      if (record.summary) paragraph(record.summary, { color: muted, gap: 8 });
      details.forEach((detail) => {
        labelledDetail(detail.label, detail.value);
      });
      y += 8;
      if (index < workspace.records.length - 1) {
        doc.setDrawColor(222, 226, 228);
        doc.line(margin, y, pageWidth - margin, y);
        y += 20;
      }
    });
  }

  if (workspace.sources.length) {
    addPage();
    heading("Evidence base", 1);
    paragraph(
      `This release draws on ${workspace.findings.length} findings, ${workspace.evidence.length} evidence records and ${workspace.sources.length} inspectable sources.`,
      { color: muted, gap: 16 },
    );
    workspace.sources.forEach((source, index) => {
      ensure(50);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...ink);
      const titleLines = doc.splitTextToSize(pdfText(`${index + 1}. ${source.title || source.publisher || "Research source"}`), contentWidth);
      doc.text(titleLines, margin, y, { lineHeightFactor: 1.35 });
      y += titleLines.length * 13;
      paragraph([source.publisher, source.url].filter(Boolean).join(" - "), { size: 8.5, color: muted, gap: 10 });
    });
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(222, 226, 228);
    doc.line(margin, pageHeight - 38, pageWidth - margin, pageHeight - 38);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text("Prepared by Attract Acquisition", margin, pageHeight - 22);
    doc.text(`${page} / ${pages}`, pageWidth - margin, pageHeight - 22, { align: "right" });
  }

  return doc.output("arraybuffer");
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function downloadIntelligenceMarkdown(input: IntelligenceExportInput): void {
  downloadBlob(
    new Blob([buildIntelligenceMarkdown(input)], { type: "text/markdown;charset=utf-8" }),
    intelligenceExportFilename(input, "md"),
  );
}

export async function downloadIntelligencePdf(input: IntelligenceExportInput): Promise<void> {
  const buffer = await buildIntelligencePdf(input);
  downloadBlob(new Blob([buffer], { type: "application/pdf" }), intelligenceExportFilename(input, "pdf"));
}
