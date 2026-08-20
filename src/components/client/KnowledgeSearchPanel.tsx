// Stage 2 Phase 04 — Knowledge (thin). Search across a client's own
// Context Files and Execution Files -- the real, already-approved
// substrate -- without a separate index or a new capture mechanism.
// Deliberately not AI-inferred: this is direct retrieval over real content,
// the same "human trusted before a model" discipline Phase 01 used for
// Bottlenecks & Priorities.

import { useCallback, useEffect, useState } from "react";
import { EmptyState, Panel } from "@/components/primitives";
import { fetchClientContextFiles, fetchClientExecutionFiles } from "@/lib/api";
import { currentExecutionMonth } from "@/lib/stage3";
import { buildKnowledgeIndex, searchKnowledge, type KnowledgeSearchResult } from "@/lib/knowledge-search";

const SOURCE_LABEL: Record<KnowledgeSearchResult["sourceKind"], string> = { context: "Context File", execution: "Execution File" };

export function KnowledgeSearchPanel({ clientId }: { clientId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState<ReturnType<typeof buildKnowledgeIndex>>([]);
  const [fileCount, setFileCount] = useState(0);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [contextFiles, executionFiles] = await Promise.all([
        fetchClientContextFiles(clientId),
        fetchClientExecutionFiles(clientId, currentExecutionMonth()),
      ]);
      setIndex(buildKnowledgeIndex(contextFiles, executionFiles));
      setFileCount(contextFiles.length + executionFiles.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  const results: KnowledgeSearchResult[] = query.trim().length > 1 ? searchKnowledge(index, query).slice(0, 20) : [];

  if (loading) return <p className="p-4 text-2xs text-paper-3">Loading…</p>;
  if (error) return <p className="p-4 text-2xs text-neg">{error}</p>;

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-2xs text-paper-3">
        Searches {fileCount} approved Context and Execution Files directly — no separate index, no AI inference. Ask a real question in your own words.
      </p>
      <input
        autoFocus
        className="rounded border border-line bg-ink px-3 py-2 text-sm text-paper outline-none focus:border-teal/50"
        placeholder="e.g. what is our brand voice?"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim().length > 1 && results.length === 0 && (
        <EmptyState icon="search" title="No matches" body="Try different words, or check the file exists and is approved." />
      )}
      <div className="space-y-2">
        {results.map((r, i) => (
          <Panel key={`${r.fileName}-${r.heading}-${i}`} title={r.heading} meta={SOURCE_LABEL[r.sourceKind]}>
            <div className="p-3 text-xs">
              <p className="mb-1 text-2xs font-mono text-paper-3">{r.fileName}</p>
              <p className="whitespace-pre-line text-paper-2">{r.snippet}</p>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
