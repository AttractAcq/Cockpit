import { useState } from "react";
import { Button } from "@/components/primitives";
import {
  downloadIntelligenceMarkdown,
  downloadIntelligencePdf,
} from "@/lib/intelligence-export";
import type { IntelligenceWorkspace } from "@/types/intelligence";

interface IntelligenceExportActionsProps {
  clientName: string;
  workspace: IntelligenceWorkspace | null;
}

export function IntelligenceExportActions({ clientName, workspace }: IntelligenceExportActionsProps) {
  const [pdfWorking, setPdfWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const release = workspace?.latestRelease ?? workspace?.activeRelease ?? null;
  const runComplete = workspace?.latestRun?.status === "completed" || workspace?.latestRun?.status === "completed_partial";
  const exportable = Boolean(release && workspace?.records.length && (release.status !== "draft" || runComplete));

  if (!workspace || !release || !exportable) return null;

  async function exportPdf() {
    setPdfWorking(true);
    setError(null);
    try {
      await downloadIntelligencePdf({ clientName, workspace: workspace! });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPdfWorking(false);
    }
  }

  function exportMarkdown() {
    setError(null);
    try {
      downloadIntelligenceMarkdown({ clientName, workspace: workspace! });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        disabled={pdfWorking}
        onClick={() => void exportPdf()}
        title="Download a polished client-facing document"
      >
        {pdfWorking ? "Preparing PDF…" : "Export PDF"}
      </Button>
      <Button
        variant="subtle"
        disabled={pdfWorking}
        onClick={exportMarkdown}
        title="Download full structured context, evidence and authority metadata"
      >
        Export .md
      </Button>
      {error && <span className="max-w-64 text-2xs leading-4 text-neg">Export failed: {error}</span>}
    </div>
  );
}
