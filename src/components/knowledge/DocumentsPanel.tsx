// Cockpit v3 Step 3 — Documents. The folder repository over the already-real
// Context/Execution Files (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md Step 3),
// plus the first real UI activation of the client_source_documents /
// client_context_file_citations provenance layer (Phase 04's own finding:
// wired but never exercised). Full content viewing/editing routes into the
// already-built Context Files / Execution Files panels rather than
// duplicating that UI here -- this is a browse/index layer, not a new editor.

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, Panel, Tag } from "@/components/primitives";
import { fetchClientContextFiles, fetchClientExecutionFiles } from "@/lib/api";
import { fetchClientSourceDocuments, fetchContextFileCitations } from "@/lib/documents";
import { groupContextFilesByFolder } from "@/lib/document-folders";
import { citationCountsByFile } from "@/lib/document-citations";
import { currentExecutionMonth } from "@/lib/stage3";
import { CONTEXT_FILE_STATUS_LABEL, CONTEXT_FILE_STATUS_COLOUR } from "@/types/phase";
import type { ClientContextFile, ClientExecutionFile } from "@/types/phase";
import type { ClientSourceDocument } from "@/types/phase1-intelligence";
import { ROUTES } from "@/lib/constants";
import { fmtRelative } from "@/lib/format";

const SOURCE_KIND_LABEL: Record<ClientSourceDocument["source_kind"], string> = {
  client_form: "Client Form",
  uploaded_document: "Uploaded Document",
  website_page: "Website Page",
  service_page: "Service Page",
  review: "Review",
  existing_marketing: "Existing Marketing",
  sales_document: "Sales Document",
  offer_document: "Offer Document",
  brand_document: "Brand Document",
  competitor_reference: "Competitor Reference",
  project_proof: "Project Proof",
};

const PROCESSING_STATUS_COLOUR: Record<ClientSourceDocument["processing_status"], string> = {
  pending: "text-paper-3",
  extracting: "text-warn",
  extracted: "text-teal",
  failed: "text-neg",
  skipped: "text-paper-3",
};

export function DocumentsPanel({ clientId }: { clientId: string }) {
  const [contextFiles, setContextFiles] = useState<ClientContextFile[]>([]);
  const [executionFiles, setExecutionFiles] = useState<ClientExecutionFile[]>([]);
  const [sourceDocuments, setSourceDocuments] = useState<ClientSourceDocument[]>([]);
  const [citationCounts, setCitationCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [ctx, exec, sources, citations] = await Promise.all([
        fetchClientContextFiles(clientId),
        fetchClientExecutionFiles(clientId, currentExecutionMonth()),
        fetchClientSourceDocuments(clientId),
        fetchContextFileCitations(clientId),
      ]);
      setContextFiles(ctx);
      setExecutionFiles(exec);
      setSourceDocuments(sources);
      setCitationCounts(citationCountsByFile(citations));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className="p-4 text-2xs text-paper-3">Loading…</p>;
  if (error) return <p className="p-4 text-2xs text-neg">{error}</p>;

  const folders = groupContextFilesByFolder(contextFiles);

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-2xs text-paper-3">
        Every approved Context File grouped into a real folder taxonomy, plus this month's Execution Files and any raw source documents on record. Click through to view or edit the full content.
      </p>

      {folders.map(({ folder, contextFiles: files }) => (
        files.length === 0 ? null : (
          <Panel key={folder.key} title={folder.label} meta={`${files.length}`}>
            <div className="space-y-1 p-2">
              {files.map((f) => {
                const citations = citationCounts[f.id] ?? 0;
                return (
                  <Link
                    key={f.id}
                    to={ROUTES.clientSection(clientId, "context_files")}
                    className="flex flex-wrap items-center gap-2 rounded border border-line bg-ink p-2 text-2xs hover:bg-ink-100 transition-colors"
                  >
                    <span className="text-paper font-medium">{f.file_name}</span>
                    <span className={`font-mono ${CONTEXT_FILE_STATUS_COLOUR[f.status]}`}>{CONTEXT_FILE_STATUS_LABEL[f.status]}</span>
                    <span className="text-paper-3 ml-auto">{citations > 0 ? `${citations} citation${citations === 1 ? "" : "s"}` : "No citations yet"}</span>
                  </Link>
                );
              })}
            </div>
          </Panel>
        )
      ))}

      <Panel title="Execution" meta={`${executionFiles.length}`}>
        {executionFiles.length === 0 ? (
          <p className="p-3 text-2xs text-paper-3">No Execution Files for {currentExecutionMonth()} yet.</p>
        ) : (
          <div className="space-y-1 p-2">
            {executionFiles.map((f) => (
              <Link
                key={f.id}
                to={ROUTES.clientSection(clientId, "execution_files")}
                className="flex flex-wrap items-center gap-2 rounded border border-line bg-ink p-2 text-2xs hover:bg-ink-100 transition-colors"
              >
                <span className="text-paper font-medium">{f.file_name}</span>
                <span className="text-paper-3 font-mono ml-auto">{f.month}</span>
              </Link>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Source Documents" meta={`${sourceDocuments.length}`}>
        {sourceDocuments.length === 0 ? (
          <EmptyState icon="library" title="No source documents on record" body="Raw ingested files (uploads, website pages, reviews, and similar) will appear here once ingested." />
        ) : (
          <div className="space-y-1 p-2">
            {sourceDocuments.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-2 rounded border border-line bg-ink p-2 text-2xs">
                <span className="text-paper font-medium">{d.original_filename ?? d.source_url ?? d.id}</span>
                <Tag kind="muted">{SOURCE_KIND_LABEL[d.source_kind]}</Tag>
                <span className={`font-mono ${PROCESSING_STATUS_COLOUR[d.processing_status]}`}>{d.processing_status}</span>
                <span className="text-paper-3 font-mono ml-auto">{fmtRelative(d.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
