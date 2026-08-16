import { useEffect, useMemo, useState } from "react";
import { Button, Modal } from "@/components/primitives";
import { commitManualContent } from "@/lib/api";
import { EdgeFunctionInvocationError } from "@/lib/supabase";
import { fetchSupplySources, fetchProofItems, type SupplySourceRow, type SupplyProofRow } from "@/lib/supply";
import type { IdeationAssetType } from "@/types/ideation";

const FIELD_CLASS = "w-full rounded border border-line bg-ink px-2.5 py-2 text-xs text-paper outline-none focus:border-teal/50";
const ASSET_TYPES: Array<{ value: IdeationAssetType; label: string }> = [
  { value: "reel", label: "Reel" },
  { value: "carousel", label: "Carousel" },
  { value: "static", label: "Static" },
  { value: "story", label: "Story" },
];

function errorText(error: unknown): string {
  if (error instanceof EdgeFunctionInvocationError) {
    const body = error.responseBody;
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      if (typeof record.message === "string") return record.message;
      if (typeof record.code === "string") return record.code;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function todayIso(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

interface Props {
  clientId: string;
  onClose: () => void;
  onCommitted: (result: { ref: string; distributionDate: string }) => void;
}

/**
 * Commits a manually-typed or proof-led idea directly to the operational
 * Calendar. Deliberately separate from the Generate/Score/Propose/Commit
 * flow above it — client_ideation_candidates cannot honestly represent a
 * manual entry (see commit-manual-content edge function / migration for why).
 * An eligible content_sources row (manual idea or proof item, not yet
 * committed) may optionally be attached as evidence.
 */
export function IdeationManualCommitPanel({ clientId, onClose, onCommitted }: Props) {
  const [origin, setOrigin] = useState<"manual" | "proof_led">("manual");
  const [sources, setSources] = useState<SupplySourceRow[]>([]);
  const [proofItems, setProofItems] = useState<SupplyProofRow[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourceId, setSourceId] = useState<string>("");
  const [assetType, setAssetType] = useState<IdeationAssetType>("static");
  const [workingTitle, setWorkingTitle] = useState("");
  const [hook, setHook] = useState("");
  const [coreMessage, setCoreMessage] = useState("");
  const [cta, setCta] = useState("");
  const [psychologicalAngle, setPsychologicalAngle] = useState("");
  const [distributionDate, setDistributionDate] = useState(todayIso());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSourcesLoading(true);
    Promise.all([
      fetchSupplySources(clientId, {
        kinds: ["manual_idea", "proof_item"],
        processing: ["pending", "processing", "skipped"],
      }),
      fetchProofItems(clientId),
    ])
      .then(([nextSources, nextProof]) => {
        if (cancelled) return;
        setSources(nextSources);
        setProofItems(nextProof);
      })
      .catch(() => {
        if (!cancelled) { setSources([]); setProofItems([]); }
      })
      .finally(() => { if (!cancelled) setSourcesLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  const proofById = useMemo(() => new Map(proofItems.map((item) => [item.content_source_id, item])), [proofItems]);

  const eligibleSources = useMemo(() => {
    if (origin === "manual") return sources.filter((source) => source.source_kind === "manual_idea");
    return sources.filter((source) => source.source_kind === "proof_item");
  }, [sources, origin]);

  const selectedProof = sourceId ? proofById.get(sourceId) ?? null : null;
  // Mirrors commit_manual_content's own gate, shown up front so an operator
  // isn't surprised by a 409 after filling in the whole form.
  const proofBlocked = origin === "proof_led" && selectedProof
    && (selectedProof.verification_status !== "verified"
      || !["granted", "not_required"].includes(selectedProof.consent_status)
      || ["restricted", "expired"].includes(selectedProof.usage_state));

  const canSubmit = workingTitle.trim() && hook.trim() && coreMessage.trim() && cta.trim()
    && distributionDate && (origin === "manual" || sourceId) && !proofBlocked;

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await commitManualContent({
        client_id: clientId,
        asset_type: assetType,
        working_title: workingTitle.trim(),
        hook: hook.trim(),
        core_message: coreMessage.trim(),
        cta: cta.trim(),
        psychological_angle: psychologicalAngle.trim() || null,
        distribution_date: distributionDate,
        origin,
        content_source_id: sourceId || null,
      });
      onCommitted({ ref: result.ref, distributionDate });
    } catch (value) {
      setError(errorText(value));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="Add Manual / Proof-Led Item"
      description="Commits directly to the Calendar. This does not go through AI generation, scoring or the proposal step — it is an operator-authored item, placed on the date you choose."
      onClose={onClose}
      closeDisabled={submitting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" onClick={() => void handleSubmit()} disabled={!canSubmit || submitting}>
            {submitting ? "Committing…" : "Commit to Calendar"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}

        <div className="flex gap-2">
          {(["manual", "proof_led"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => { setOrigin(value); setSourceId(""); }}
              className={`flex-1 rounded border px-2.5 py-2 text-xs ${origin === value ? "border-teal/50 bg-teal/10 text-paper" : "border-line text-paper-3 hover:text-paper"}`}
            >
              {value === "manual" ? "Manual idea" : "Proof-led"}
            </button>
          ))}
        </div>

        <label className="block text-2xs text-paper-3">
          {origin === "manual" ? "Source idea (optional evidence link)" : "Proof item"}
          <select
            className={`${FIELD_CLASS} mt-1`}
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            disabled={sourcesLoading}
          >
            <option value="">{origin === "manual" ? "None" : "Select a proof item…"}</option>
            {eligibleSources.map((source) => (
              <option key={source.id} value={source.id}>{source.title}</option>
            ))}
          </select>
        </label>
        {proofBlocked && (
          <div role="alert" className="rounded border border-warn/30 bg-warn/5 px-3 py-2 text-2xs text-warn">
            This proof item is not yet usable (verification, consent or usage state). Verify and clear it in Content Supply first.
          </div>
        )}

        <label className="block text-2xs text-paper-3">
          Asset type
          <select className={`${FIELD_CLASS} mt-1`} value={assetType} onChange={(event) => setAssetType(event.target.value as IdeationAssetType)}>
            {ASSET_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </label>

        <label className="block text-2xs text-paper-3">
          Working title
          <input className={`${FIELD_CLASS} mt-1`} value={workingTitle} onChange={(event) => setWorkingTitle(event.target.value)} maxLength={300} />
        </label>
        <label className="block text-2xs text-paper-3">
          Hook
          <textarea className={`${FIELD_CLASS} mt-1`} rows={2} value={hook} onChange={(event) => setHook(event.target.value)} maxLength={1000} />
        </label>
        <label className="block text-2xs text-paper-3">
          Core message
          <textarea className={`${FIELD_CLASS} mt-1`} rows={3} value={coreMessage} onChange={(event) => setCoreMessage(event.target.value)} maxLength={3000} />
        </label>
        <label className="block text-2xs text-paper-3">
          CTA
          <input className={`${FIELD_CLASS} mt-1`} value={cta} onChange={(event) => setCta(event.target.value)} maxLength={1000} />
        </label>
        <label className="block text-2xs text-paper-3">
          Psychological angle (optional)
          <input className={`${FIELD_CLASS} mt-1`} value={psychologicalAngle} onChange={(event) => setPsychologicalAngle(event.target.value)} maxLength={1000} />
        </label>
        <label className="block text-2xs text-paper-3">
          Calendar date
          <input type="date" className={`${FIELD_CLASS} mt-1`} value={distributionDate} onChange={(event) => setDistributionDate(event.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
