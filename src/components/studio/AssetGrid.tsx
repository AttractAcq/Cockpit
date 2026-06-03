import { useEffect, useState } from "react";
import { Button, EmptyState, Icon, Tabs } from "@/components/primitives";
import { AssetCard } from "./AssetCard";
import { mockApi } from "@/lib/mock";
import type { Asset, AssetKind } from "@/types";

const DEMO_ASSETS: Asset[] = [
  { id: "d-a1", kind: "mjr_report", title: "Missed Jobs Report — Vasco Joinery", description: "14 competitors mapped, R 84k/mo gap identified", entity_id: null, entity_name: "Vasco Joinery", file_name: "MJR_VascoJoinery.pdf", file_size_bytes: 2_400_000, file_type: "application/pdf", thumbnail_url: null, status: "ready", generated_by: "agent", agent_name: "OpenClaw", created_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(), updated_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(), tags: ["mjr"] },
  { id: "d-a2", kind: "reel_brief", title: "Reel brief #024 — Before/after kitchen install", description: "22s vertical · faceless · Luke Davis style", entity_id: null, entity_name: null, file_name: "Brief_024_Kitchen.pdf", file_size_bytes: 480_000, file_type: "application/pdf", thumbnail_url: null, status: "ready", generated_by: "human", agent_name: null, created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), updated_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), tags: ["reel", "brief"] },
  { id: "d-a3", kind: "ad_creative", title: "Hook B — Tile & Grout (winning variant)", description: "9:16 · 12s · CTR 1.6%", entity_id: null, entity_name: "Tile & Grout Studio", file_name: "HookB_TileGrout_v3.mp4", file_size_bytes: 8_900_000, file_type: "video/mp4", thumbnail_url: null, status: "shipped", generated_by: "human", agent_name: null, created_at: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(), updated_at: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(), tags: ["creative"] },
];

// SOP-13 asset naming convention
const NAMING_CONVENTION = "TYPE_ClientName_YYYY-MM-DD[_v#]  e.g. MJR_VascoJoinery_2026-06-03";
const NAMING_REGEX = /^[A-Z0-9]+_[A-Za-z0-9]+_\d{4}-\d{2}-\d{2}/;

export function AssetGrid() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [tab, setTab] = useState<AssetKind | "all">("all");
  const [generating, setGenerating] = useState<string | null>(null);

  useEffect(() => {
    mockApi.assets.list()
      .then((rows) => {
        if (rows.length === 0) { setAssets(DEMO_ASSETS); setIsDemo(true); }
        else { setAssets(rows as Asset[]); setIsDemo(false); }
      })
      .catch(() => { setAssets(DEMO_ASSETS); setIsDemo(true); });
  }, []);

  async function handleApprove(id: string) {
    await mockApi.assets.approve(id);
    setAssets((prev) => prev.map((a) => a.id === id ? { ...a, status: "approved" } : a));
  }

  async function handleReject(id: string) {
    await mockApi.assets.reject(id);
    setAssets((prev) => prev.map((a) => a.id === id ? { ...a, status: "draft" } : a));
  }

  async function handleGenerateMJR() {
    const entityId = prompt("Entity ID for MJR generation:");
    if (!entityId) return;
    setGenerating("mjr");
    try {
      await mockApi.mjr.generate({ entity_id: entityId });
      alert("MJR generation triggered — check the agent trail for progress.");
    } catch (e) {
      alert("Failed: " + String(e));
    } finally {
      setGenerating(null);
    }
  }

  async function handleGenerateBrief() {
    const entityId = prompt("Entity ID for brief generation:");
    if (!entityId) return;
    const topic = prompt("Brief topic (optional):") ?? undefined;
    setGenerating("brief");
    try {
      await mockApi.briefs.generate({ entity_id: entityId, topic });
      alert("Brief generation triggered — check the agent trail for progress.");
    } catch (e) {
      alert("Failed: " + String(e));
    } finally {
      setGenerating(null);
    }
  }

  const filtered = tab === "all" ? assets : assets.filter((a) => a.kind === tab);

  const counts: Record<string, number> = { all: assets.length };
  for (const a of assets) { counts[a.kind] = (counts[a.kind] ?? 0) + 1; }

  return (
    <div className="flex-1 flex flex-col min-h-0 px-4 py-3">
      {/* SOP-13 naming convention banner */}
      <div className="mb-2 px-3 py-2 bg-ink-200 border border-line rounded-lg text-2xs text-paper-3 font-mono">
        <span className="text-paper-2 font-medium">SOP-13 naming:</span> {NAMING_CONVENTION}
      </div>

      <div className="flex items-center justify-between mb-3 gap-2">
        <Tabs
          active={tab}
          onChange={(v) => setTab(v as AssetKind | "all")}
          tabs={[
            { id: "all", label: "All", count: counts.all },
            { id: "mjr_report", label: "MJRs", count: counts.mjr_report ?? 0 },
            { id: "reel_brief", label: "Briefs", count: (counts.reel_brief ?? 0) + (counts.content_brief ?? 0) },
            { id: "ad_creative", label: "Creatives", count: counts.ad_creative ?? 0 },
            { id: "onboarding_doc", label: "Onboarding", count: counts.onboarding_doc ?? 0 },
          ]}
        />
        <div className="flex gap-1.5 flex-shrink-0">
          <Button variant="secondary" size="sm" onClick={handleGenerateMJR} disabled={!!generating}>
            {generating === "mjr" ? "…" : "Gen MJR"}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleGenerateBrief} disabled={!!generating}>
            {generating === "brief" ? "…" : "Gen brief"}
          </Button>
        </div>
      </div>

      {isDemo && (
        <div className="mb-2 text-[10px] font-mono uppercase tracking-cap text-paper-3 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-warn" /> demo data
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyState icon="library" title="No assets in this category" body="Generate one with the agent or upload manually." />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {filtered.map((a) => (
              <AssetCard
                key={a.id}
                asset={a}
                namingRegex={NAMING_REGEX}
                onApprove={() => handleApprove(a.id)}
                onReject={() => handleReject(a.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
