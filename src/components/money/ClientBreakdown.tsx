import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Panel, Tag, type TagKind } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import { ROUTES } from "@/lib/constants";
import { fmtZAR } from "@/lib/format";

interface RevenueRow {
  entity_id: string;
  entity_name: string | null;
  mrr_cents: number;
  tier: string | null;
  status: string;
}

const DEMO_ROWS: RevenueRow[] = [
  { entity_id: "demo-1", entity_name: "Newlands Window Cleaning", mrr_cents: 850000, tier: "proof_sprint", status: "active" },
  { entity_id: "demo-2", entity_name: "Tile & Grout Studio", mrr_cents: 420000, tier: "proof_brand", status: "active" },
  { entity_id: "demo-3", entity_name: "Cape Coast Joinery", mrr_cents: 420000, tier: "proof_brand", status: "active" },
];

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
  const [isDemo, setIsDemo] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    mockApi.money.revenueByClient()
      .then((data) => {
        if (data.length === 0) { setRows(DEMO_ROWS); setIsDemo(true); }
        else { setRows(data as RevenueRow[]); setIsDemo(false); }
      })
      .catch(() => { setRows(DEMO_ROWS); setIsDemo(true); });
  }, []);

  const totalCents = rows.reduce((acc, r) => acc + r.mrr_cents, 0);
  const total = totalCents / 100;

  return (
    <Panel title={`Revenue by client${isDemo ? " · demo" : ""}`} meta={fmtZAR(total) + " MRR"}>
      {rows.length === 0 ? (
        <div className="px-3 py-8 text-center text-xs text-paper-3">No paying clients yet.</div>
      ) : (
        rows.map((r, i) => {
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
        })
      )}
    </Panel>
  );
}
