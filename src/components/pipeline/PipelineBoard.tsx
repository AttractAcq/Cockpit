import { useEffect, useState } from "react";
import { StageColumn } from "./StageColumn";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/primitives";
import { PIPELINE_STAGES, type Entity, type PipelineStage } from "@/types";

interface OnboardingGate {
  entityId: string;
  entityName: string;
}

interface PipelineBoardProps {
  filterStage?: PipelineStage;
}

export function PipelineBoard({ filterStage }: PipelineBoardProps) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<OnboardingGate | null>(null);
  const [gateAmount, setGateAmount] = useState("12500");
  const [gateTier, setGateTier] = useState("proof_brand");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.entities.byStage()
      .then((rows) => {
        setEntities(rows as Entity[]);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setEntities([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const stages = filterStage ? [filterStage] : PIPELINE_STAGES;

  async function handleDrop(entityId: string, targetStage: PipelineStage) {
    const entity = entities.find((e) => e.id === entityId);
    if (!entity || entity.stage === targetStage) return;

    // Deposit gate: moving into onboarding requires the onboarding edge function
    if (targetStage === "onboarding") {
      setGate({ entityId, entityName: entity.business_name });
      return;
    }

    // Optimistic update
    setEntities((prev) => prev.map((e) => e.id === entityId ? { ...e, stage: targetStage } : e));
    try {
      await api.entities.advanceStage(entityId, targetStage);
    } catch {
      // Revert on error
      setEntities((prev) => prev.map((e) => e.id === entityId ? { ...e, stage: entity.stage } : e));
    }
  }

  async function confirmOnboarding() {
    if (!gate) return;
    setSaving(true);
    try {
      await api.onboarding.start({
        entity_id: gate.entityId,
        amount_cents: Math.round(parseFloat(gateAmount) * 100),
        tier: gateTier,
      });
      setEntities((prev) => prev.map((e) => e.id === gate.entityId ? { ...e, stage: "onboarding" as PipelineStage } : e));
      setGate(null);
    } catch (err) {
      alert("Failed to start onboarding: " + String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden px-4 py-3 relative">
      {loading && (
        <div className="text-xs text-paper-3 font-mono px-1 py-2">Loading live pipeline…</div>
      )}
      {error && (
        <div className="mb-3 px-3 py-2 text-xs text-neg bg-neg-dim border border-neg/30 rounded-md">
          Pipeline read failed: {error}
        </div>
      )}
      {!loading && !error && entities.length === 0 && (
        <EmptyState
          icon="users"
          title="No entities in pipeline"
          body="Live Supabase is connected, but no prospects or clients are visible to this user."
        />
      )}
      <div className="flex gap-3 h-full min-w-max">
        {stages.map((stage) => {
          const stageEntities = entities.filter((e) => e.stage === stage);
          return (
            <StageColumn
              key={stage}
              stage={stage}
              entities={stageEntities}
              onDrop={handleDrop}
            />
          );
        })}
      </div>

      {/* Onboarding deposit gate dialog */}
      {gate && (
        <div className="fixed inset-0 bg-ink/80 flex items-center justify-center z-50">
          <div className="bg-ink-200 border border-line rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="font-serif text-lg text-paper mb-1">Start onboarding</h2>
            <p className="text-sm text-paper-3 mb-4">
              Moving <strong className="text-paper">{gate.entityName}</strong> to onboarding.
              This runs the deposit gate via the onboarding edge function.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-paper-3 uppercase tracking-cap block mb-1">Deposit amount (R)</label>
                <input
                  type="number"
                  value={gateAmount}
                  onChange={(e) => setGateAmount(e.target.value)}
                  className="w-full bg-ink-100 rounded-lg px-3 py-2 text-paper text-sm ring-1 ring-ink-50 focus:ring-teal outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-paper-3 uppercase tracking-cap block mb-1">Tier</label>
                <select
                  value={gateTier}
                  onChange={(e) => setGateTier(e.target.value)}
                  className="w-full bg-ink-100 rounded-lg px-3 py-2 text-paper text-sm ring-1 ring-ink-50 focus:ring-teal outline-none"
                >
                  <option value="proof_sprint">Proof Sprint</option>
                  <option value="proof_brand">Proof Brand</option>
                  <option value="authority_brand">Authority Brand</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={confirmOnboarding}
                disabled={saving}
                className="flex-1 bg-teal rounded-lg py-2 text-ink font-medium text-sm disabled:opacity-50"
              >
                {saving ? "Starting…" : "Confirm & start"}
              </button>
              <button
                onClick={() => setGate(null)}
                className="px-4 py-2 text-paper-3 text-sm hover:text-paper"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
