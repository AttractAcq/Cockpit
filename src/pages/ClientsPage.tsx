import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState, Icon } from "@/components/primitives";
import { Button } from "@/components/primitives";
import { fetchClients, createClient, generateSlug } from "@/lib/api";
import type { Client, PackageTier } from "@/types/client";
import { ROUTES } from "@/lib/constants";
import { TIER_LABELS as TL } from "@/types/client";

const TIERS: PackageTier[] = ["proof_sprint", "proof_brand", "proof_brand_scale"];

function StagePill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    not_run:  "bg-ink-100 text-paper-3",
    running:  "bg-warn/10 text-warn",
    complete: "bg-teal/10 text-teal",
    error:    "bg-neg/10 text-neg",
  };
  const labels: Record<string, string> = {
    not_run: "Not Run", running: "Running", complete: "Complete", error: "Error",
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
  const [filterS1, setFilterS1]   = useState<"all" | "not_run" | "complete">("all");

  useEffect(() => {
    fetchClients()
      .then(setClients)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = clients.filter((c) => {
    if (filterTier !== "all" && c.package_tier !== filterTier) return false;
    if (filterS1   !== "all" && c.stage1_status !== filterS1)  return false;
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
        <div className="flex items-center gap-3">
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
          <select
            value={filterS1}
            onChange={(e) => setFilterS1(e.target.value as "all" | "not_run" | "complete")}
            className="bg-ink-200 border border-line rounded px-2 py-1 text-xs text-paper outline-none"
          >
            <option value="all">All Stage 1</option>
            <option value="not_run">Stage 1 Not Run</option>
            <option value="complete">Stage 1 Complete</option>
          </select>
        </div>

        {/* Table */}
        {filtered.length === 0 ? (
          <EmptyState
            icon="users"
            title="No clients found"
            body={clients.length === 0 ? "Create your first client." : "No clients match the current filters."}
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
                  {["Name", "Tier", "Stage 1", "Stage 2", "Health", "Status"].map((h) => (
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
                    <td className="px-3 py-2.5">
                      <span className={`font-mono text-xs ${
                        c.health_score >= 70 ? "text-teal" : c.health_score >= 40 ? "text-warn" : "text-neg"
                      }`}>{c.health_score}</span>
                    </td>
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
