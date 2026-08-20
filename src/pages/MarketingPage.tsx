// Cockpit v3 Step 2 — Marketing rehomed to a real top-level page
// (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md Step 2's last piece). Unlike the
// four prior rehomes (Automations, Team, Knowledge, Finance), each a single
// shared component, Marketing spans the six already-real page groups Stage
// 2 Phase 05 already clustered under a "Marketing" label inside
// ClientDetailPage's own tab pill row (see the group: "Marketing" entries in
// DELIVERY_PAGES there) -- Offer, Campaigns, Ideation, Creation,
// Distribution, Iteration. This page renders the exact same panel
// components with the exact same props ClientDetailPage already passes
// them, reached through a client picker (the selectedClientId compatibility
// bridge, same pattern as Knowledge/Opportunities) instead of a
// ClientDetailPage URL param -- pure recomposition, no new panel logic.
//
// One honest, deliberate gap: ClientDetailPage's Calendar tab also renders
// a "Run Phase 3 — Full Month (legacy)" bulk-generation button
// (renderPhase3Controls) above Phase3CalendarPanel. That control is
// explicitly labelled legacy in its own copy, isn't required for the
// Calendar panel to function, and depends on a large block of
// ClientDetailPage-local generation state (phase3Running/phase3Progress/
// phaseConfirmation and friends) that doesn't belong duplicated into a
// second top-level page. Omitted here; still reachable from the original
// ClientDetailPage route, per hide-before-delete.

import { useEffect, useState } from "react";
import { EmptyState } from "@/components/primitives";
import { OffersPanel } from "@/components/client/OffersPanel";
import { MarketingCampaignsPanel } from "@/components/client/MarketingCampaignsPanel";
import { ContentSupplyPanel } from "@/components/client/ContentSupplyPanel";
import { Phase3CalendarPanel } from "@/components/client/Phase3CalendarPanel";
import { MastersPanel } from "@/components/client/MastersPanel";
import { ContentCreationPanel } from "@/components/client/ContentCreationPanel";
import { ReelStudioPanel } from "@/components/client/ReelStudioPanel";
import { AssetsPanel } from "@/components/client/AssetsPanel";
import { DistributionPanel } from "@/components/client/DistributionPanel";
import { AdStudioPanel } from "@/components/client/AdStudioPanel";
import { AnalyticsPanel } from "@/components/client/AnalyticsPanel";
import { PerformanceIterationPanel } from "@/components/client/PerformanceIterationPanel";
import { fetchClients } from "@/lib/api";
import { currentExecutionMonth } from "@/lib/stage3";
import { useBusinessContext } from "@/lib/business-context";
import type { Client } from "@/types/client";

const GROUPS = ["offer", "campaigns", "ideation", "creation", "distribution", "iteration"] as const;
type Group = (typeof GROUPS)[number];
const GROUP_LABEL: Record<Group, string> = {
  offer: "Offer", campaigns: "Campaigns", ideation: "Ideation", creation: "Creation", distribution: "Distribution", iteration: "Iteration",
};

const GROUP_TABS: Record<Group, string[]> = {
  offer: ["main_offers", "seasonal_offers"],
  campaigns: ["marketing_campaigns"],
  ideation: ["content_supply", "calendar", "content_items"],
  creation: ["content_creation", "reel_studio", "assets"],
  distribution: ["distribution", "paid_distribution"],
  iteration: ["analytics", "performance-iteration"],
};

const TAB_LABEL: Record<string, string> = {
  main_offers: "Main Offers", seasonal_offers: "Seasonal Offers",
  marketing_campaigns: "Campaigns",
  content_supply: "Content Supply", calendar: "Calendar", content_items: "Content Items",
  content_creation: "Content Briefs", reel_studio: "Reel Studio", assets: "Assets",
  distribution: "Organic", paid_distribution: "Paid",
  analytics: "Analytics", "performance-iteration": "Performance & Iteration",
};

const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";

export function MarketingPage() {
  const { selectedClientId } = useBusinessContext();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [group, setGroup] = useState<Group>("offer");
  const [tab, setTab] = useState(GROUP_TABS.offer[0]);

  useEffect(() => { void fetchClients().then(setClients); }, []);
  useEffect(() => { if (selectedClientId) setClientId(selectedClientId); }, [selectedClientId]);

  function selectGroup(next: Group) {
    setGroup(next);
    setTab(GROUP_TABS[next][0]);
  }

  function goToTab(nextGroup: Group, nextTab: string) {
    setGroup(nextGroup);
    setTab(nextTab);
  }

  const month = currentExecutionMonth();

  function renderTab() {
    if (!clientId) return null;
    switch (tab) {
      case "main_offers":
        return <OffersPanel clientId={clientId} offerType="main" />;
      case "seasonal_offers":
        return <OffersPanel clientId={clientId} offerType="seasonal" />;
      case "marketing_campaigns":
        return <MarketingCampaignsPanel clientId={clientId} />;
      case "content_supply":
        return <ContentSupplyPanel clientId={clientId} executionMonth={month} />;
      case "calendar":
        return <Phase3CalendarPanel clientId={clientId} executionMonth={month} />;
      case "content_items":
        return <MastersPanel clientId={clientId} executionMonth={month} />;
      case "content_creation":
        return <ContentCreationPanel clientId={clientId} executionMonth={month} onViewAssets={() => goToTab("creation", "assets")} />;
      case "reel_studio":
        return <ReelStudioPanel clientId={clientId} />;
      case "assets":
        return <AssetsPanel clientId={clientId} executionMonth={month} onViewProductionBrief={() => goToTab("creation", "content_creation")} />;
      case "distribution":
        return <DistributionPanel clientId={clientId} executionMonth={month} onViewAssets={() => goToTab("creation", "assets")} />;
      case "paid_distribution":
        return <AdStudioPanel clientId={clientId} />;
      case "analytics":
        return <AnalyticsPanel clientId={clientId} executionMonth={month} />;
      case "performance-iteration":
        return <PerformanceIterationPanel clientId={clientId} executionMonth={month} />;
      default:
        return null;
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-medium text-paper">Marketing</h1>
        <select className={field} value={clientId} onChange={(e) => { setClientId(e.target.value); }}>
          <option value="">Select a client…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {!clientId ? (
        <EmptyState icon="library" title="Select a client" body="Pick a client above (or select a business linked to one) to work its Offer, Campaigns, Ideation, Creation, Distribution and Iteration." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-line pb-2">
            {GROUPS.map((g) => (
              <button
                key={g}
                onClick={() => selectGroup(g)}
                className={`rounded px-2 py-1 text-2xs ${group === g ? "bg-teal/10 text-teal" : "text-paper-3 hover:text-paper"}`}
              >
                {GROUP_LABEL[g]}
              </button>
            ))}
          </div>
          {GROUP_TABS[group].length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              {GROUP_TABS[group].map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded px-2 py-1 text-2xs uppercase tracking-cap ${tab === t ? "bg-teal/10 text-teal" : "text-paper-3 hover:text-paper"}`}
                >
                  {TAB_LABEL[t]}
                </button>
              ))}
            </div>
          )}
          {renderTab()}
        </>
      )}
    </div>
  );
}
