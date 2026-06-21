import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, Icon, Tag, type TagKind, Tabs } from "@/components/primitives";
import { AssetCard } from "./AssetCard";
import { api } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import type { Asset, AssetKind } from "@/types";

// SOP-13 asset naming convention
const NAMING_CONVENTION = "TYPE_ClientName_YYYY-MM-DD[_v#]  e.g. MJR_VascoJoinery_2026-06-03";
const NAMING_REGEX = /^[A-Z0-9]+_[A-Za-z0-9]+_\d{4}-\d{2}-\d{2}/;

// The DB kind column may use "mjr" (edge fn) as well as "mjr_report" (type)
const isKindMJR = (k: string) => k === "mjr_report" || k === "mjr";
const isKindBrief = (k: string) => k === "reel_brief" || k === "content_brief";

type TopTab = "assets" | "briefs";
type GenKind = "mjr" | "brief" | null;
type GenState = "idle" | "running" | "done" | "error";

interface BriefRow {
  id: string;
  entity_id: string | null;
  entity_name: string | null;
  ref_code: string | null;
  title: string | null;
  body: string | null;
  status: string | null;
  created_at: string;
}

function SkeletonCard() {
  return (
    <div className="bg-ink-200 border border-line rounded-[10px] overflow-hidden animate-pulse">
      <div className="aspect-video bg-ink-100" />
      <div className="px-3 py-2.5 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="h-4 w-12 bg-ink-100 rounded" />
          <div className="h-3 w-16 bg-ink-100 rounded" />
        </div>
        <div className="h-4 w-full bg-ink-100 rounded" />
        <div className="h-3 w-20 bg-ink-100 rounded" />
      </div>
    </div>
  );
}

const briefStatusTag: Record<string, TagKind> = {
  draft: "muted",
  review: "decision",
  approved: "reply",
  archived: "muted",
};

export function AssetGrid() {
  const [topTab, setTopTab] = useState<TopTab>("assets");
  const [assetKindTab, setAssetKindTab] = useState<AssetKind | "all">("all");

  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [assetsError, setAssetsError] = useState<string | null>(null);

  const [briefs, setBriefs] = useState<BriefRow[]>([]);
  const [briefsLoading, setBriefsLoading] = useState(false);
  const [briefsError, setBriefsError] = useState<string | null>(null);

  // Generation panel state
  const [genKind, setGenKind] = useState<GenKind>(null);
  const [genEntityId, setGenEntityId] = useState("");
  const [genTopic, setGenTopic] = useState("");
  const [genState, setGenState] = useState<GenState>("idle");
  const [genMsg, setGenMsg] = useState("");

  const loadAssets = useCallback(async () => {
    setAssetsLoading(true);
    setAssetsError(null);
    try {
      setAssets((await api.assets.list()) as Asset[]);
    } catch (err) {
      setAssetsError(err instanceof Error ? err.message : String(err));
    } finally {
      setAssetsLoading(false);
    }
  }, []);

  const loadBriefs = useCallback(async () => {
    setBriefsLoading(true);
    setBriefsError(null);
    try {
      setBriefs((await api.briefs.list()) as BriefRow[]);
    } catch (err) {
      setBriefsError(err instanceof Error ? err.message : String(err));
    } finally {
      setBriefsLoading(false);
    }
  }, []);

  useEffect(() => { void loadAssets(); }, [loadAssets]);
  useEffect(() => { if (topTab === "briefs") void loadBriefs(); }, [topTab, loadBriefs]);

  async function handleApprove(id: string) {
    await api.assets.approve(id);
    setAssets((prev) => prev.map((a) => a.id === id ? { ...a, status: "approved" } : a));
  }

  async function handleReject(id: string) {
    await api.assets.reject(id);
    setAssets((prev) => prev.map((a) => a.id === id ? { ...a, status: "draft" } : a));
  }

  async function handleGenSubmit() {
    if (!genEntityId.trim() || !genKind) return;
    setGenState("running");
    try {
      if (genKind === "mjr") {
        await api.mjr.generate({ entity_id: genEntityId.trim() });
        setGenMsg("MJR generation triggered — will appear in list once the agent completes.");
      } else {
        await api.briefs.generate({ entity_id: genEntityId.trim(), topic: genTopic.trim() || undefined });
        setGenMsg("Brief generation triggered — will appear in Briefs tab once done.");
      }
      setGenState("done");
      // Refresh the relevant list after a brief delay to let DB write complete
      setTimeout(() => {
        if (genKind === "mjr") void loadAssets();
        else void loadBriefs();
      }, 1500);
      setTimeout(() => { setGenState("idle"); setGenKind(null); setGenEntityId(""); setGenTopic(""); }, 5000);
    } catch (e) {
      setGenState("error");
      setGenMsg(e instanceof Error ? e.message : String(e));
      setTimeout(() => setGenState("idle"), 5000);
    }
  }

  // Filter assets
  const filteredAssets = assetKindTab === "all"
    ? assets
    : assets.filter((a) => {
        if (assetKindTab === "mjr_report") return isKindMJR(a.kind);
        if (assetKindTab === "reel_brief") return isKindBrief(a.kind);
        return a.kind === assetKindTab;
      });

  const counts: Record<string, number> = { all: assets.length };
  for (const a of assets) {
    const normKind = isKindMJR(a.kind) ? "mjr_report" : isKindBrief(a.kind) ? "reel_brief" : a.kind;
    counts[normKind] = (counts[normKind] ?? 0) + 1;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 px-4 py-3">
      {/* SOP-13 naming convention banner */}
      <div className="mb-3 px-3 py-2 bg-ink-200 border border-line rounded-lg text-2xs text-paper-3 font-mono flex items-center gap-2">
        <span className="text-paper-2 font-medium flex-shrink-0">SOP-13 naming:</span>
        <span>{NAMING_CONVENTION}</span>
      </div>

      {/* Top-level Assets / Briefs switch + action buttons */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex gap-2">
          {(["assets", "briefs"] as TopTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTopTab(t)}
              className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                topTab === t
                  ? "bg-ink-100 border-line-2 text-paper"
                  : "border-transparent text-paper-3 hover:text-paper-2"
              }`}
            >
              {t === "assets" ? `Assets (${assets.length})` : `Briefs (${briefs.length})`}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { setGenKind("mjr"); setGenState("idle"); }}
            disabled={genState === "running"}
          >
            <Icon name="library" size={11} className="inline mr-1" />
            Gen MJR
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { setGenKind("brief"); setGenState("idle"); }}
            disabled={genState === "running"}
          >
            Gen brief
          </Button>
        </div>
      </div>

      {/* Inline generation panel */}
      {genKind && (
        <div className="mb-3 bg-ink-200 border border-line rounded-lg px-3 py-3 flex flex-col gap-2.5">
          <div className="text-xs text-paper-2 font-medium">
            {genKind === "mjr" ? "Generate MJR" : "Generate brief"}
            {" — "}
            <span className="font-mono text-paper-3">output will follow SOP-13 naming</span>
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-ink-100 border border-line rounded px-2.5 py-1.5 text-xs text-paper placeholder:text-paper-3 focus:outline-none focus:border-line-2"
              placeholder="Entity ID (UUID)"
              value={genEntityId}
              onChange={(e) => setGenEntityId(e.target.value)}
              disabled={genState === "running"}
            />
            {genKind === "brief" && (
              <input
                className="flex-1 bg-ink-100 border border-line rounded px-2.5 py-1.5 text-xs text-paper placeholder:text-paper-3 focus:outline-none focus:border-line-2"
                placeholder="Topic (optional)"
                value={genTopic}
                onChange={(e) => setGenTopic(e.target.value)}
                disabled={genState === "running"}
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={handleGenSubmit}
              disabled={!genEntityId.trim() || genState === "running"}
              className={(!genEntityId.trim() || genState === "running") ? "opacity-50 cursor-not-allowed" : ""}
            >
              {genState === "running" ? "Running…" : "Generate"}
            </Button>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => { setGenKind(null); setGenState("idle"); }}
              disabled={genState === "running"}
            >
              Cancel
            </Button>
            {genState === "done" && (
              <span className="text-xs text-teal font-mono">✓ {genMsg}</span>
            )}
            {genState === "error" && (
              <span className="text-xs text-neg font-mono truncate">✗ {genMsg}</span>
            )}
          </div>
        </div>
      )}

      {/* ASSETS tab */}
      {topTab === "assets" && (
        <>
          <div className="mb-3">
            <Tabs
              active={assetKindTab}
              onChange={(v) => setAssetKindTab(v as AssetKind | "all")}
              tabs={[
                { id: "all", label: "All", count: counts.all },
                { id: "mjr_report", label: "MJRs", count: counts.mjr_report ?? 0 },
                { id: "reel_brief", label: "Briefs", count: (counts.reel_brief ?? 0) },
                { id: "ad_creative", label: "Creatives", count: counts.ad_creative ?? 0 },
                { id: "onboarding_doc", label: "Onboarding", count: counts.onboarding_doc ?? 0 },
              ]}
            />
          </div>

          {assetsError && (
            <div className="mb-3 px-3 py-2 text-xs text-neg bg-neg-dim border border-neg/30 rounded-lg">
              Failed to load assets: {assetsError}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto">
            {assetsLoading ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
              </div>
            ) : filteredAssets.length === 0 ? (
              <EmptyState
                icon="library"
                title={assetKindTab === "all" ? "No assets yet" : "No assets in this category"}
                body="Generate one using the buttons above, or upload manually."
              />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {filteredAssets.map((a) => (
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
        </>
      )}

      {/* BRIEFS tab */}
      {topTab === "briefs" && (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0">
          {briefsError && (
            <div className="mb-3 px-3 py-2 text-xs text-neg bg-neg-dim border border-neg/30 rounded-lg">
              Failed to load briefs: {briefsError}
            </div>
          )}
          {briefsLoading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 bg-ink-200 border border-line rounded-lg animate-pulse" />
              ))}
            </div>
          ) : briefs.length === 0 ? (
            <EmptyState
              icon="library"
              title="No briefs yet"
              body="Use 'Gen brief' above to generate the first brief for a client."
            />
          ) : (
            <div className="bg-ink-200 border border-line rounded-[10px] overflow-hidden">
              {briefs.map((b, i) => (
                <div
                  key={b.id}
                  className={`px-3 py-3 flex items-start gap-3 ${i < briefs.length - 1 ? "border-b border-line" : ""}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Tag kind={briefStatusTag[b.status ?? ""] ?? "muted"}>
                        {b.status ?? "draft"}
                      </Tag>
                      {b.entity_name && (
                        <span className="text-2xs text-paper-3 font-mono truncate">{b.entity_name}</span>
                      )}
                      {b.ref_code && (
                        <span className="text-2xs text-paper-3 font-mono">{b.ref_code}</span>
                      )}
                    </div>
                    <div className="text-sm text-paper font-medium truncate">{b.title ?? "(untitled)"}</div>
                    {b.body && (
                      <div className="text-xs text-paper-3 mt-0.5 line-clamp-1">{b.body}</div>
                    )}
                  </div>
                  <span className="font-mono text-2xs text-paper-3 flex-shrink-0 mt-0.5">
                    {fmtAgo(b.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
