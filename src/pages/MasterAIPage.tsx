// Cockpit v3 Step 5 — Master AI promoted to a real top-level page
// (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md Step 5). MasterAIPanel itself is
// untouched, reused exactly as ClientDetailPage's "Master AI" tab already
// does -- this page's own job is the business-context panel alongside it
// and reading the client through BusinessContext's compatibility bridge
// (selectedClientId), the same legacy-client_id pattern OpportunitiesPage
// and the Knowledge/Documents page already use, since client_jarvis_settings
// and client_agent_runs are client_id-scoped, not business_id-native.

import { EmptyState } from "@/components/primitives";
import { useBusinessContext } from "@/lib/business-context";
import { MasterAIPanel } from "@/components/client/MasterAIPanel";
import { BusinessContextPanel } from "@/components/master-ai/BusinessContextPanel";

export function MasterAIPage() {
  const { selectedBusiness, selectedClientId } = useBusinessContext();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <h1 className="text-sm font-medium text-paper">Master AI</h1>
      {!selectedClientId ? (
        <EmptyState
          icon="search"
          title="No linked client"
          body={
            selectedBusiness
              ? `${selectedBusiness.name} has no linked client yet, so there's nothing for Master AI to reason over. Link one from the Business page, or select a different business.`
              : "Select a business with a linked client from the top bar to use Master AI."
          }
        />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
          <div className="min-h-0 overflow-y-auto rounded-[10px] border border-line bg-ink-200 p-3">
            <BusinessContextPanel clientId={selectedClientId} />
          </div>
          <div className="min-h-0 rounded-[10px] border border-line bg-ink-200">
            <MasterAIPanel clientId={selectedClientId} />
          </div>
        </div>
      )}
    </div>
  );
}
