import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Panel, Tag, type TagKind } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import { ROUTES } from "@/lib/constants";
import { fmtZAR } from "@/lib/format";
import { STAGE_LABELS, TIER_LABELS, type Entity } from "@/types";

const stageTag: Record<string, TagKind> = {
  active: "reply",
  delivering: "approve",
  onboarding: "decision",
  churned: "muted",
};

export function ClientBreakdown() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    mockApi.clients.list().then((all) =>
      setEntities(all.filter((e) => e.mrr > 0).sort((a, b) => b.mrr - a.mrr))
    );
  }, []);

  const total = entities.reduce((acc, e) => acc + e.mrr, 0);

  return (
    <Panel title="Revenue by client" meta={fmtZAR(total) + " MRR"}>
      {entities.length === 0 ? (
        <div className="px-3 py-8 text-center text-xs text-paper-3">
          No paying clients yet.
        </div>
      ) : (
        entities.map((e, i) => {
          const pct = total > 0 ? (e.mrr / total) * 100 : 0;
          const tagKind = stageTag[e.pipeline_stage] ?? "muted";
          return (
            <button
              key={e.id}
              onClick={() => navigate(ROUTES.entity(e.id))}
              className={`w-full px-3 py-3 text-left hover:bg-ink-50 transition-colors ${
                i < entities.length - 1 ? "border-b border-line" : ""
              }`}
            >
              <div className="flex items-center gap-2.5 mb-1.5">
                <span className="text-sm text-paper flex-1 truncate">
                  {e.business_name}
                </span>
                <Tag kind={tagKind}>{STAGE_LABELS[e.pipeline_stage]}</Tag>
                {e.tier && (
                  <span className="text-2xs text-paper-3 font-mono">
                    {TIER_LABELS[e.tier]}
                  </span>
                )}
                <span className="font-mono text-sm text-paper">{fmtZAR(e.mrr)}</span>
              </div>
              <div className="h-1 bg-ink-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-teal rounded-full"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </button>
          );
        })
      )}
    </Panel>
  );
}
