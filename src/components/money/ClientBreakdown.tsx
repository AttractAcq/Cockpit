import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState, Panel, Tag, type TagKind } from "@/components/primitives";
import { api } from "@/lib/api";
import { ROUTES } from "@/lib/constants";
import { fmtZAR } from "@/lib/format";

interface RevenueRow {
  entity_id: string;
  entity_name: string | null;
  mrr_cents: number;
  tier: string | null;
  status: string;
}

const TIER_LABELS: Record<string, string> = {
  proof_sprint: "Proof Sprint",
  proof_brand: "Proof Brand",
  authority_brand: "Authority Brand",
};

const statusTag: Record<string, TagKind> = {
  active: "reply",
  delivering: "approve",
  onboarding: "decision",
};

export function ClientBreakdown() {
  const [rows, setRows] = useState<RevenueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.money.revenueByClient()
      .then((data) => setRows(data as RevenueRow[]))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const totalCents = rows.reduce((acc, r) => acc + r.mrr_cents, 0);
  const total = totalCents / 100;

  return (
    <Panel title="Revenue by client" meta={rows.length > 0 ? fmtZAR(total) + " MRR" : "—"}>
      {error && (
        <div className="px-3 py-2 text-xs text-neg bg-neg-dim border-b border-neg/30">
          Client breakdown load failed: {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="px-3 py-8">
          <EmptyState
            icon="money"
            title="No paying clients yet"
            body="Revenue data will appear once entities are at active or delivering stage."
          />
        </div>
      )}

      {!loading && rows.map((r, i) => {
        const mrr = r.mrr_cents / 100;
        const pct = total > 0 ? (mrr / total) * 100 : 0;
        const tagKind = statusTag[r.status] ?? "muted";
        return (
          <button
            key={r.entity_id}
            onClick={() => navigate(ROUTES.entity(r.entity_id))}
            className={`w-full px-3 py-3 text-left hover:bg-ink-50 transition-colors ${i < rows.length - 1 ? "border-b border-line" : ""}`}
          >
            <div className="flex items-center gap-2.5 mb-1.5">
              <span className="text-sm text-paper flex-1 truncate">{r.entity_name ?? r.entity_id}</span>
              <Tag kind={tagKind}>{r.status}</Tag>
              {r.tier && <span className="text-2xs text-paper-3 font-mono">{TIER_LABELS[r.tier] ?? r.tier}</span>}
              <span className="font-mono text-sm text-paper">{fmtZAR(mrr)}</span>
            </div>
            <div className="h-1 bg-ink-100 rounded-full overflow-hidden">
              <div className="h-full bg-teal rounded-full" style={{ width: `${pct}%` }} />
            </div>
          </button>
        );
      })}
    </Panel>
  );
}
