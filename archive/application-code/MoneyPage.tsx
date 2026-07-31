import { useState } from "react";
import { Button } from "@/components/primitives";
import { KPIGrid, RevenueChart, ClientBreakdown } from "@/components/money";
import { invokeFn } from "@/lib/supabase";

type RecalcState = "idle" | "running" | "done" | "error";

export function MoneyPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [recalcState, setRecalcState] = useState<RecalcState>("idle");

  async function handleRecalc() {
    setRecalcState("running");
    try {
      await invokeFn("mrr-calc", {});
      setRefreshKey((k) => k + 1);
      setRecalcState("done");
      setTimeout(() => setRecalcState("idle"), 3000);
    } catch {
      setRecalcState("error");
      setTimeout(() => setRecalcState("idle"), 4000);
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3.5">
      <div className="flex items-center justify-between">
        <div className="text-2xs text-paper-3 font-mono uppercase tracking-cap">Money</div>
        <div className="flex items-center gap-2">
          {recalcState === "done" && (
            <span className="text-2xs text-teal font-mono">✓ MRR recalculated</span>
          )}
          {recalcState === "error" && (
            <span className="text-2xs text-neg font-mono">✗ Recalc failed</span>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRecalc}
            disabled={recalcState === "running"}
            className={recalcState === "running" ? "opacity-50 cursor-not-allowed" : ""}
          >
            {recalcState === "running" ? "Recalculating…" : "Recalculate MRR"}
          </Button>
        </div>
      </div>

      <KPIGrid key={`kpi-${refreshKey}`} />
      <div className="grid grid-cols-[1fr_1fr] gap-3.5">
        <RevenueChart key={`rev-${refreshKey}`} />
        <ClientBreakdown key={`cb-${refreshKey}`} />
      </div>
    </div>
  );
}
