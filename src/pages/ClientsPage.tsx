import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState, Icon } from "@/components/primitives";
import { Button } from "@/components/primitives";
import { fetchClients, createClient, generateSlug, fetchStage3StatusMap } from "@/lib/api";
import type { Client, PackageTier } from "@/types/client";
import { ROUTES } from "@/lib/constants";
import { TIER_LABELS as TL } from "@/types/client";
import { currentExecutionMonth, type Stage3Status } from "@/lib/stage3";

const TIERS: PackageTier[] = ["proof_sprint", "proof_brand", "proof_brand_scale"];

function StagePill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    not_run:  "bg-ink-100 text-paper-3",
    not_started: "bg-ink-100 text-paper-3",
    running:  "bg-warn/10 text-warn",
    in_progress: "bg-warn/10 text-warn",
    partial: "bg-warn/10 text-warn",
    complete: "bg-teal/10 text-teal",
    error:    "bg-neg/10 text-neg",
    failed: "bg-neg/10 text-neg",
    needs_review: "bg-warn/10 text-warn",
  };
  const labels: Record<string, string> = {
    not_run: "Not Run", not_started: "Not started", running: "Running", in_progress: "In progress", complete: "Complete", partial: "Partial", failed: "Failed", error: "Error", needs_review: "Needs review",
  };
  return (
    <span className={`text-2xs font-mono px-1.5 py-0.5 rounded ${styles[status] ?? "bg-ink-100 text-paper-3"}`}>
      {labels[status] ?? status}
    </span>
  );
}

interface CreateModalProps {
  onClose: () => void;
  onCreated: (client: Client) => void;
}

function CreateClientModal({ onClose, onCreated }: CreateModalProps) {
  const [name, setName]         = useState("");
  const [tier, setTier]         = useState<PackageTier>("proof_sprint");
  const [geography, setGeo]     = useState("");
  const [platform, setPlatform] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const client = await createClient({
        name: name.trim(),
        slug: generateSlug(name.trim()),
        package_tier: tier,
        geography: geography || undefined,
        primary_platform: platform || undefined,
      });
      onCreated(client);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create client");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
      <div className="bg-ink-200 border border-line rounded-xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-medium text-paper">New Client</h2>
          <button onClick={onClose} className="text-paper-3 hover:text-paper transition-colors">
            <Icon name="x" size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-2xs uppercase tracking-cap text-paper-3">Client Name *</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Grouting Heroes Ltd"
              className="bg-ink border border-line rounded-lg px-3 py-2 text-xs text-paper placeholder:text-paper-3 outline-none focus:border-line-2"
              required
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-2xs uppercase tracking-cap text-paper-3">Package Tier *</span>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value as PackageTier)}
              className="bg-ink border border-line rounded-lg px-3 py-2 text-xs text-paper outline-none focus:border-line-2"
            >
              {TIERS.map((t) => <option key={t} value={t}>{TL[t]}</option>)}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-2xs uppercase tracking-cap text-paper-3">Geography</span>
              <input
                value={geography}
                onChange={(e) => setGeo(e.target.value)}
                placeholder="e.g. Netherlands"
                className="bg-ink border border-line rounded-lg px-3 py-2 text-xs text-paper placeholder:text-paper-3 outline-none focus:border-line-2"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-2xs uppercase tracking-cap text-paper-3">Primary Platform</span>
              <input
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                placeholder="e.g. LinkedIn"
                className="bg-ink border border-line rounded-lg px-3 py-2 text-xs text-paper placeholder:text-paper-3 outline-none focus:border-line-2"
              />
            </label>
          </div>

          {error && <p className="text-2xs text-neg">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="subtle" size="sm" type="button" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={!name.trim() || loading}
            >
              {loading ? "Creating…" : "Create Client"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ClientsPage() {
  const navigate = useNavigate();
  const [clients, setClients]     = useState<Client[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filterTier, setFilterTier] = useState<PackageTier | "all">("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [stage3Statuses, setStage3Statuses] = useState<Record<string, Stage3Status>>({});
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Clients is the essential query; the stage-3 status map is an enhancement.
    // allSettled keeps the table rendering even if the status map drops.
    const [clientsResult, stage3Result] = await Promise.allSettled([fetchClients(), fetchStage3StatusMap(currentExecutionMonth())]);
    if (clientsResult.status === "fulfilled") setClients(clientsResult.value);
    else setError(clientsResult.reason instanceof Error ? clientsResult.reason.message : String(clientsResult.reason));
    setStage3Statuses(stage3Result.status === "fulfilled" ? stage3Result.value : {});
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    function reload() { void load(); }
    window.addEventListener("aa:reload", reload);
    return () => window.removeEventListener("aa:reload", reload);
  }, [load]);

  const filtered = clients.filter((c) => {
    if (filterTier !== "all" && c.package_tier !== filterTier) return false;
    const stage3 = stage3Statuses[c.id] ?? "not_started";
    if (stageFilter === "stage1_not_run" && c.stage1_status !== "not_run") return false;
    if (stageFilter === "stage1_complete" && c.stage1_status !== "complete") return false;
    if (stageFilter === "stage2_not_run" && c.stage2_status !== "not_run") return false;
    if (stageFilter === "stage2_complete" && c.stage2_status !== "complete") return false;
    if (stageFilter === "stage3_not_run" && stage3 !== "not_started") return false;
    if (stageFilter === "stage3_needs_review" && stage3 !== "needs_review") return false;
    if (stageFilter === "stage3_complete" && stage3 !== "complete") return false;
    const needle = query.trim().toLocaleLowerCase();
    if (needle) {
      const searchable = [
        c.name, c.slug, c.status, TL[c.package_tier], c.geography,
        c.primary_platform, c.secondary_platform, c.stage1_status, c.stage2_status, stage3,
      ].filter(Boolean).join(" ").toLocaleLowerCase();
      if (!searchable.includes(needle)) return false;
    }
    return true;
  });

  if (loading) return <div className="flex-1 flex items-center justify-center text-paper-3 text-xs">Loading…</div>;
  if (error)   return <div className="flex-1 flex items-center justify-center text-neg text-xs">{error}</div>;

  return (
    <>
      {showCreate && (
        <CreateClientModal
          onClose={() => setShowCreate(false)}
          onCreated={(client) => {
            setClients((prev) => [...prev, client]);
            setShowCreate(false);
            navigate(ROUTES.client(client.id));
          }}
        />
      )}

      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-medium text-paper">
            Clients
            <span className="ml-2 text-paper-3 font-normal text-2xs font-mono">
              {filtered.length} shown
            </span>
          </h1>
          <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
            + New Client
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Icon name="filter" size={12} className="text-paper-3" />
            <span className="text-2xs text-paper-3 uppercase tracking-cap">Filter</span>
          </div>
          <select
            value={filterTier}
            onChange={(e) => setFilterTier(e.target.value as PackageTier | "all")}
            className="bg-ink-200 border border-line rounded px-2 py-1 text-xs text-paper outline-none"
          >
            <option value="all">All Tiers</option>
            {TIERS.map((t) => <option key={t} value={t}>{TL[t]}</option>)}
          </select>
          <label className="relative ml-auto min-w-[240px] max-w-sm flex-1">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-paper-3"><Icon name="search" size={12} /></span>
            <input
              aria-label="Search client list"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, status, offer, geography…"
              className="w-full rounded border border-line bg-ink-200 py-1 pl-8 pr-7 text-xs text-paper outline-none placeholder:text-paper-3 focus:border-line-2"
            />
            {query && <button aria-label="Clear client search" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-paper-3 hover:text-paper">×</button>}
          </label>
          <select
            aria-label="Filter clients by stage"
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="bg-ink-200 border border-line rounded px-2 py-1 text-xs text-paper outline-none"
          >
            <option value="all">All Clients</option>
            <option value="stage1_not_run">Stage 1 Not Run</option>
            <option value="stage1_complete">Stage 1 Complete</option>
            <option value="stage2_not_run">Stage 2 Not Run</option>
            <option value="stage2_complete">Stage 2 Complete</option>
            <option value="stage3_not_run">Stage 3 Not Run</option>
            <option value="stage3_needs_review">Stage 3 Needs Review</option>
            <option value="stage3_complete">Stage 3 Complete</option>
          </select>
        </div>

        {/* Table */}
        {filtered.length === 0 ? (
          <EmptyState
            icon="users"
            title="No clients found"
            body={clients.length === 0 ? "Create your first client." : "No clients match the current search and filters."}
            action={
              clients.length === 0 ? (
                <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
                  Create First Client
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="bg-ink-200 border border-line rounded-[10px] overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line">
                  {["Name", "Tier", "Stage 1", "Stage 2", "Stage 3", "Status"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left text-2xs uppercase tracking-cap text-paper-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => navigate(ROUTES.client(c.id))}
                    className="border-b border-line last:border-b-0 hover:bg-ink-100 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2.5 text-paper font-medium">
                      {c.name}
                      {c.is_internal_client && (
                        <span className="ml-2 text-2xs text-teal font-mono bg-teal/10 rounded px-1">internal</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-paper-2 text-2xs">{TL[c.package_tier]}</td>
                    <td className="px-3 py-2.5"><StagePill status={c.stage1_status} /></td>
                    <td className="px-3 py-2.5"><StagePill status={c.stage2_status} /></td>
                    <td className="px-3 py-2.5"><button className="rounded hover:bg-teal/10 focus:outline-none focus:ring-1 focus:ring-teal/50" onClick={(event) => { event.stopPropagation(); navigate(ROUTES.clientSection(c.id, "calendar")); }} title="Open Phase 3 calendar"><StagePill status={stage3Statuses[c.id] ?? "not_started"} /></button></td>
                    <td className="px-3 py-2.5">
                      <span className={`text-2xs capitalize ${
                        c.status === "active" ? "text-teal" : c.status === "churned" ? "text-neg" : "text-paper-3"
                      }`}>{c.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
