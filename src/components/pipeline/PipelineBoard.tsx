import { useEffect, useState } from "react";
import { StageColumn } from "./StageColumn";
import { mockApi } from "@/lib/mock";
import { PIPELINE_STAGES, type Entity, type PipelineStage } from "@/types";

// Demo fallback shown when the DB is empty — clearly labelled.
const DEMO_ENTITIES: Entity[] = [
  { id: "demo-1", business_name: "Vasco Joinery", kind: "prospect", stage: "engaged", contact_name: "Vasco Botha", niche: "Joinery", city: "Cape Town", icp_fit_score: 88, agent_score: 0.74, source: "apify_maps", last_channel: "whatsapp", last_message_preview: "Sharp, I'll have a look tonight 🙏", last_contact_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(), created_at: "", updated_at: "", notes: null, tier: null, whatsapp_number: null, instagram_handle: null, email: null, website: null },
  { id: "demo-2", business_name: "Roofworx CT", kind: "prospect", stage: "engaged", contact_name: "Mike Daniels", niche: "Roofing", city: "Cape Town", icp_fit_score: 92, agent_score: 0.84, source: "inbound_dm", last_channel: "instagram", last_message_preview: "Yeah send me the report…", last_contact_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(), created_at: "", updated_at: "", notes: null, tier: null, whatsapp_number: null, instagram_handle: null, email: null, website: null },
  { id: "demo-3", business_name: "Cape Coast Joinery", kind: "client", stage: "onboarding", contact_name: "Themba Mokoena", niche: "Joinery", city: "Cape Town", icp_fit_score: 86, agent_score: 0.62, source: "apify_maps", last_channel: "whatsapp", last_message_preview: "Looking forward to today!", last_contact_at: new Date(Date.now() - 1000 * 60 * 120).toISOString(), created_at: "", updated_at: "", notes: null, tier: "proof_brand", whatsapp_number: null, instagram_handle: null, email: null, website: null },
  { id: "demo-4", business_name: "Newlands Window Cleaning", kind: "client", stage: "delivering", contact_name: "Andre Pieterse", niche: "Window cleaning", city: "Cape Town", icp_fit_score: 75, agent_score: null, source: "referral", last_channel: "whatsapp", last_message_preview: "Got 2 leads today, thanks!", last_contact_at: new Date(Date.now() - 1000 * 60 * 240).toISOString(), created_at: "", updated_at: "", notes: null, tier: "proof_sprint", whatsapp_number: null, instagram_handle: null, email: null, website: null },
  { id: "demo-5", business_name: "Atlantic Decking Co.", kind: "prospect", stage: "cold", contact_name: "Sipho Khumalo", niche: "Decking", city: "Cape Town", icp_fit_score: 84, agent_score: null, source: "apify_maps", last_channel: null, last_message_preview: null, last_contact_at: null, created_at: "", updated_at: "", notes: null, tier: null, whatsapp_number: null, instagram_handle: null, email: null, website: null },
  { id: "demo-6", business_name: "Boulders Builders", kind: "prospect", stage: "booked", contact_name: "Naledi Mahlangu", niche: "Building", city: "Cape Town", icp_fit_score: 82, agent_score: 0.68, source: "apify_maps", last_channel: "email", last_message_preview: "Confirmed — see you Tuesday.", last_contact_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(), created_at: "", updated_at: "", notes: null, tier: null, whatsapp_number: null, instagram_handle: null, email: null, website: null },
];

interface OnboardingGate {
  entityId: string;
  entityName: string;
}

interface PipelineBoardProps {
  filterStage?: PipelineStage;
}

export function PipelineBoard({ filterStage }: PipelineBoardProps) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [gate, setGate] = useState<OnboardingGate | null>(null);
  const [gateAmount, setGateAmount] = useState("12500");
  const [gateTier, setGateTier] = useState("proof_brand");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    mockApi.entities.byStage().then((rows) => {
      if (rows.length === 0) {
        setEntities(DEMO_ENTITIES as Entity[]);
        setIsDemo(true);
      } else {
        setEntities(rows as Entity[]);
        setIsDemo(false);
      }
    }).catch(() => {
      setEntities(DEMO_ENTITIES as Entity[]);
      setIsDemo(true);
    });
  }, []);

  const stages = filterStage ? [filterStage] : PIPELINE_STAGES;

  async function handleDrop(entityId: string, targetStage: PipelineStage) {
    const entity = entities.find((e) => e.id === entityId);
    if (!entity || entity.stage === targetStage) return;
    if (isDemo) return; // no-op on demo data

    // Deposit gate: moving into onboarding requires the onboarding edge function
    if (targetStage === "onboarding") {
      setGate({ entityId, entityName: entity.business_name });
      return;
    }

    // Optimistic update
    setEntities((prev) => prev.map((e) => e.id === entityId ? { ...e, stage: targetStage } : e));
    try {
      await mockApi.entities.advanceStage(entityId, targetStage);
    } catch {
      // Revert on error
      setEntities((prev) => prev.map((e) => e.id === entityId ? { ...e, stage: entity.stage } : e));
    }
  }

  async function confirmOnboarding() {
    if (!gate) return;
    setSaving(true);
    try {
      await mockApi.onboarding.start({
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
      {isDemo && (
        <div className="mb-2 px-2 py-1 text-[10px] font-mono uppercase tracking-cap text-paper-3 bg-ink-100 border border-line rounded-md inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-warn" /> demo data · connect Supabase to see live pipeline
        </div>
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
