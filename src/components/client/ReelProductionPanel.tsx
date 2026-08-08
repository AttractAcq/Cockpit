// Programme Stage J — Reel Studio Completion: production-strategy selection
// and the composition contract (timeline/voice/audio/captions/CTA/render
// mode). Rendered inside Reel Studio's project detail view.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/primitives";
import {
  fetchCompositionContract,
  selectReelProductionStrategy,
  createCompositionContract,
  updateCompositionContract,
} from "@/lib/reel-production";
import {
  PRODUCTION_STRATEGY_LABEL,
  RENDER_MODE_LABEL,
  type VideoCompositionContractRow,
  type ProductionStrategy,
  type AutomationPolicy,
  type QualityRequirement,
  type RenderMode,
  type VoiceSource,
  type LoudnessStandard,
  type CaptionTimingSource,
} from "@/types/reel-production";

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { message?: string };
    if (value.message) return value.message;
  }
  return error instanceof Error ? error.message : String(error);
}

interface Props {
  clientId: string;
  videoProjectId: string;
  productionStrategy: ProductionStrategy | null;
  onStrategySelected: (strategy: ProductionStrategy) => void;
}

export function ReelProductionPanel({ clientId, videoProjectId, productionStrategy, onStrategySelected }: Props) {
  const [contract, setContract] = useState<VideoCompositionContractRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [proofAvailable, setProofAvailable] = useState(false);
  const [footageAvailable, setFootageAvailable] = useState(false);
  const [automationPolicy, setAutomationPolicy] = useState<AutomationPolicy>("hybrid_allowed");
  const [qualityRequirement, setQualityRequirement] = useState<QualityRequirement>("standard");

  const load = useCallback(async () => {
    setLoading(true);
    try { setContract(await fetchCompositionContract(videoProjectId)); }
    catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }, [videoProjectId]);
  useEffect(() => { void load(); }, [load]);

  async function handleSelectStrategy() {
    setBusy(true); setError(null);
    try {
      const result = await selectReelProductionStrategy({
        clientId, videoProjectId, proofAvailable, realFootageAvailable: footageAvailable,
        automationPolicy, qualityRequirement, confirmOverride: productionStrategy !== null,
      });
      onStrategySelected(result.strategy);
    } catch (value) { setError(errorText(value)); }
    finally { setBusy(false); }
  }

  async function handleCreateContract() {
    setBusy(true); setError(null);
    try { setContract((await createCompositionContract({ clientId, videoProjectId })).contract); }
    catch (value) { setError(errorText(value)); }
    finally { setBusy(false); }
  }

  async function patch(fields: Omit<Parameters<typeof updateCompositionContract>[0], "clientId" | "compositionContractId">) {
    if (!contract) return;
    setBusy(true); setError(null); setWarnings([]);
    try {
      const result = await updateCompositionContract({ clientId, compositionContractId: contract.id, ...fields });
      setContract(result.contract);
      setWarnings(result.warnings);
    } catch (value) { setError(errorText(value)); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="rounded-[10px] border border-line bg-ink-200 p-4 text-2xs text-paper-3">Loading production…</div>;

  return <div className="rounded-[10px] border border-line bg-ink-200 p-4">
    <h3 className="mb-2 text-xs font-medium text-paper">Production</h3>
    {error && <div role="alert" className="mb-2 rounded border border-neg/20 bg-neg/5 px-3 py-2 text-2xs text-neg">{error}</div>}
    {warnings.map((w, i) => <div key={i} role="status" className="mb-2 rounded border border-warn/20 bg-warn/5 px-3 py-2 text-2xs text-warn">{w}</div>)}

    <div className="mb-3 flex flex-wrap items-center gap-2 text-2xs">
      <span className="text-paper-3">Strategy:</span>
      <span className="text-paper">{productionStrategy ? PRODUCTION_STRATEGY_LABEL[productionStrategy] : "not selected"}</span>
    </div>
    <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-line pb-3 text-2xs">
      <label className="flex items-center gap-1"><input type="checkbox" checked={proofAvailable} onChange={(e) => setProofAvailable(e.target.checked)} /> Proof available</label>
      <label className="flex items-center gap-1"><input type="checkbox" checked={footageAvailable} onChange={(e) => setFootageAvailable(e.target.checked)} /> Real footage available</label>
      <select className="rounded border border-line bg-ink px-1.5 py-1 text-paper" value={automationPolicy} onChange={(e) => setAutomationPolicy(e.target.value as AutomationPolicy)}>
        <option value="ai_first">AI-first</option>
        <option value="human_first">Human-first</option>
        <option value="hybrid_allowed">Hybrid allowed</option>
      </select>
      <select className="rounded border border-line bg-ink px-1.5 py-1 text-paper" value={qualityRequirement} onChange={(e) => setQualityRequirement(e.target.value as QualityRequirement)}>
        <option value="draft">Draft quality</option>
        <option value="standard">Standard quality</option>
        <option value="premium">Premium quality</option>
      </select>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleSelectStrategy()}>{productionStrategy ? "Re-select strategy" : "Select strategy"}</Button>
    </div>

    {!contract && <Button size="sm" variant="primary" disabled={busy} onClick={() => void handleCreateContract()}>Create composition contract</Button>}

    {contract && <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-2xs">
        <span className="rounded border border-line px-1.5 py-0.5 font-mono text-paper-3">{contract.status}</span>
        <span className="text-paper-3">{contract.timeline.length} timeline entr{contract.timeline.length === 1 ? "y" : "ies"}</span>
        <select
          className="rounded border border-line bg-ink px-1.5 py-1 text-paper"
          value={contract.render_mode}
          disabled={busy || contract.status === "rendered"}
          onChange={(e) => void patch({ renderMode: e.target.value as RenderMode })}
        >
          {(Object.keys(RENDER_MODE_LABEL) as RenderMode[]).map((mode) => <option key={mode} value={mode}>{RENDER_MODE_LABEL[mode]}</option>)}
        </select>
      </div>

      <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-2xs text-paper-3">Voice source
          <select
            className="mt-0.5 w-full rounded border border-line bg-ink px-1.5 py-1 text-paper"
            value={contract.voice_track.source ?? ""}
            disabled={busy}
            onChange={(e) => void patch({ voiceTrack: { source: e.target.value as VoiceSource, consent_confirmed: e.target.value === "consent_voice_clone", script: contract.voice_track.script ?? null } })}
          >
            <option value="" disabled>Select…</option>
            <option value="real_voice">Real voice</option>
            <option value="consent_voice_clone">Consent-based voice clone</option>
            <option value="ai_narrator">AI narrator</option>
          </select>
        </label>
        <label className="text-2xs text-paper-3">Loudness standard
          <select
            className="mt-0.5 w-full rounded border border-line bg-ink px-1.5 py-1 text-paper"
            value={contract.audio.loudness_standard ?? ""}
            disabled={busy}
            onChange={(e) => void patch({ audio: { loudness_standard: e.target.value as LoudnessStandard, music_ref: contract.audio.music_ref ?? null, sfx_refs: contract.audio.sfx_refs ?? [] } })}
          >
            <option value="" disabled>Select…</option>
            <option value="EBU_R128">EBU R128</option>
            <option value="ATSC_A85">ATSC A/85</option>
          </select>
        </label>
        <label className="text-2xs text-paper-3">Captions
          <select
            className="mt-0.5 w-full rounded border border-line bg-ink px-1.5 py-1 text-paper"
            value={contract.captions.enabled ? (contract.captions.timing_source ?? "manual") : "off"}
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value;
              void patch({ captions: v === "off" ? { enabled: false, timing_source: "none" } : { enabled: true, timing_source: v as CaptionTimingSource } });
            }}
          >
            <option value="off">Off</option>
            <option value="manual">On — manual timing</option>
            <option value="auto_generated">On — auto-generated timing</option>
          </select>
        </label>
      </div>

      {contract.status === "draft" && <Button size="sm" variant="primary" disabled={busy} onClick={() => void patch({ status: "ready" })}>Mark ready</Button>}
      {contract.status === "ready" && <p className="text-2xs text-paper-3">Ready. Upload the finished Reel via the Final Reel section below, then link it here once approved to mark this contract rendered.</p>}
      {contract.status === "rendered" && <p className="text-2xs text-teal">Rendered — linked to final Reel deliverable {contract.rendered_deliverable_id}.</p>}
    </div>}
  </div>;
}
