// Cockpit v3 — Knowledge promoted to a real top-level page, combining
// Step 2's rehome (Search) with Step 3's new Documents deliverable
// (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md). Knowledge is legacy
// client_id-scoped (its substrate is Context/Execution Files, keyed to
// clients.id, not businesses.id), so it reads the shared selection through
// selectedClientId -- the same compatibility bridge OpportunitiesPage
// already uses -- with a manual client picker, since a business with no
// linked client has nothing here to show yet.

import { useEffect, useState } from "react";
import { EmptyState } from "@/components/primitives";
import { KnowledgeSearchPanel } from "@/components/client/KnowledgeSearchPanel";
import { DocumentsPanel } from "@/components/knowledge/DocumentsPanel";
import { fetchClients } from "@/lib/api";
import { useBusinessContext } from "@/lib/business-context";
import type { Client } from "@/types/client";

type Tab = "documents" | "search";

const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";

export function KnowledgePage() {
  const { selectedClientId } = useBusinessContext();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [tab, setTab] = useState<Tab>("documents");

  useEffect(() => { void fetchClients().then(setClients); }, []);
  useEffect(() => { if (selectedClientId) setClientId(selectedClientId); }, [selectedClientId]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-medium text-paper">Knowledge</h1>
        <select className={field} value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Select a client…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {!clientId ? (
        <EmptyState icon="library" title="Select a client" body="Pick a client above (or select a business linked to one) to browse its documents and search its knowledge base." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {(["documents", "search"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded px-2 py-1 text-2xs uppercase tracking-cap ${tab === t ? "bg-teal/10 text-teal" : "text-paper-3 hover:text-paper"}`}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === "documents" ? <DocumentsPanel clientId={clientId} /> : <KnowledgeSearchPanel clientId={clientId} />}
        </>
      )}
    </div>
  );
}
