import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/primitives";
import { fetchClientInputs, logActivity, saveClientInputs } from "@/lib/api";
import {
  CONTEXT_INPUT_SECTIONS,
  contextLabel,
  createDraftContextPatch,
  emptyContextInputValues,
  getContextReadiness,
  hasContextValue,
  isPlaceholderInput,
  valuesFromInputs,
  type ContextInputKey,
  type ContextInputValues,
  type PatchConfidence,
} from "@/lib/contextInputs";
import type { ClientInputs } from "@/types/phase";

type Notice = { kind: "success" | "error" | "info"; text: string } | null;
type PatchMode = "append" | "replace";

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { message?: string; code?: string; details?: string; hint?: string };
    return [value.message, value.code && `Code: ${value.code}`, value.details, value.hint]
      .filter(Boolean)
      .join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

function readinessCopy(readiness: ReturnType<typeof getContextReadiness>): {
  label: string;
  detail: string;
  colour: string;
} {
  if (readiness.status === "placeholder_detected") {
    return {
      label: "Placeholder detected",
      detail: "Placeholder inputs detected — replace before running Phase 1.",
      colour: "text-neg",
    };
  }
  if (readiness.status === "missing_recommended") {
    return {
      label: "Missing recommended sections",
      detail: `Complete: ${readiness.missingRecommended.map(contextLabel).join(", ")}.`,
      colour: "text-warn",
    };
  }
  if (readiness.status === "needs_input") {
    return { label: "Needs input", detail: "No usable context inputs are saved.", colour: "text-neg" };
  }
  return {
    label: "Ready",
    detail: readiness.missingOptional.length
      ? `Recommended sections are complete. Optional: ${readiness.missingOptional.map(contextLabel).join(", ")}.`
      : "All context input sections are complete.",
    colour: "text-teal",
  };
}

function confidenceColour(confidence: PatchConfidence): string {
  if (confidence === "mapped") return "text-teal";
  if (confidence === "needs review") return "text-warn";
  return "text-paper-3";
}

export function ContextInputsPanel({
  clientId,
  onInputsLoaded,
}: {
  clientId: string;
  onInputsLoaded?: (inputs: ClientInputs | null) => void;
}) {
  const [inputs, setInputs] = useState<ClientInputs | null>(null);
  const [draft, setDraft] = useState<ContextInputValues>(emptyContextInputValues);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ContextInputKey | "all" | "patch" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ContextInputKey, string>>>({});
  const [expandedSections, setExpandedSections] = useState<Record<ContextInputKey, boolean>>(() => Object.fromEntries(
    CONTEXT_INPUT_SECTIONS.map((section) => [section.key, section.recommended]),
  ) as Record<ContextInputKey, boolean>);

  const [rawPatch, setRawPatch] = useState("");
  const [patchValues, setPatchValues] = useState<ContextInputValues | null>(null);
  const [patchConfidence, setPatchConfidence] = useState<Record<ContextInputKey, PatchConfidence> | null>(null);
  const [patchMode, setPatchMode] = useState<PatchMode>("append");

  const loadInputs = useCallback(async (showNotice = false) => {
    setLoading(true);
    try {
      const data = await fetchClientInputs(clientId);
      setInputs(data);
      setDraft(valuesFromInputs(data));
      setFieldErrors({});
      onInputsLoaded?.(data);
      if (showNotice) setNotice({ kind: "success", text: "Reloaded context inputs from Supabase." });
      return data;
    } catch (error) {
      const detail = errorMessage(error);
      setNotice({ kind: "error", text: `Could not load client_inputs: ${detail}` });
      throw error;
    } finally {
      setLoading(false);
    }
  }, [clientId, onInputsLoaded]);

  useEffect(() => {
    void loadInputs().catch(() => undefined);
  }, [loadInputs]);

  const dirtyKeys = useMemo(
    () => CONTEXT_INPUT_SECTIONS
      .filter(({ key }) => draft[key] !== (inputs?.[key] ?? ""))
      .map(({ key }) => key),
    [draft, inputs],
  );
  const readiness = getContextReadiness(inputs);
  const readinessText = readinessCopy(readiness);

  async function persistPatch(
    patch: Partial<Record<ContextInputKey, string>>,
    activityMessage: string,
  ) {
    await saveClientInputs(clientId, patch);
    await loadInputs();
    void logActivity(clientId, "raw_input_saved", activityMessage, {
      fields: Object.keys(patch),
    });
  }

  async function saveSection(key: ContextInputKey) {
    setSaving(key);
    setNotice(null);
    setFieldErrors((previous) => ({ ...previous, [key]: undefined }));
    try {
      await persistPatch({ [key]: draft[key] }, `Context input section "${contextLabel(key)}" saved.`);
      setNotice({ kind: "success", text: `${contextLabel(key)} saved to Supabase.` });
    } catch (error) {
      const detail = errorMessage(error);
      setFieldErrors((previous) => ({ ...previous, [key]: detail }));
      setNotice({ kind: "error", text: `Save failed for ${contextLabel(key)}: ${detail}` });
    } finally {
      setSaving(null);
    }
  }

  async function saveAll() {
    if (dirtyKeys.length === 0) return;
    setSaving("all");
    setNotice(null);
    const patch = Object.fromEntries(dirtyKeys.map((key) => [key, draft[key]])) as Partial<ContextInputValues>;
    try {
      await persistPatch(patch, `${dirtyKeys.length} context input section(s) saved.`);
      setNotice({ kind: "success", text: `${dirtyKeys.length} changed section(s) saved to Supabase.` });
      setFieldErrors({});
    } catch (error) {
      const detail = errorMessage(error);
      setNotice({ kind: "error", text: `Save All failed: ${detail}` });
      setFieldErrors(Object.fromEntries(dirtyKeys.map((key) => [key, detail])));
    } finally {
      setSaving(null);
    }
  }

  function resetUnsaved() {
    setDraft(valuesFromInputs(inputs));
    setFieldErrors({});
    setNotice({ kind: "info", text: "Unsaved changes reset to the last database values." });
  }

  function createPatch() {
    if (!rawPatch.trim()) {
      setNotice({ kind: "error", text: "Paste client input before creating a draft patch." });
      return;
    }
    const parsed = createDraftContextPatch(rawPatch);
    setPatchValues(parsed.values);
    setPatchConfidence(parsed.confidence);
    setNotice({ kind: "info", text: "Draft patch created locally. Review every field before applying it." });
  }

  function clearPatch() {
    setRawPatch("");
    setPatchValues(null);
    setPatchConfidence(null);
    setPatchMode("append");
    setNotice({ kind: "info", text: "AI Input Patch cleared. No database values were changed." });
  }

  async function applyPatch() {
    if (!patchValues) return;
    const populated = CONTEXT_INPUT_SECTIONS.filter(({ key }) => hasContextValue(patchValues[key]));
    if (populated.length === 0) {
      setNotice({ kind: "error", text: "The draft patch has no content to apply." });
      return;
    }

    const replacements = populated.filter(({ key }) =>
      patchMode === "replace" && hasContextValue(inputs?.[key]) && !isPlaceholderInput(inputs?.[key]),
    );
    if (replacements.length > 0 && !window.confirm(
      `Replace existing values in: ${replacements.map(({ label }) => label).join(", ")}? This cannot be undone from the editor.`,
    )) return;

    const patch: Partial<ContextInputValues> = {};
    for (const { key } of populated) {
      const proposed = patchValues[key].trim();
      const existing = inputs?.[key]?.trim() ?? "";
      patch[key] = patchMode === "append" && existing && !isPlaceholderInput(existing)
        ? `${existing}\n\n${proposed}`
        : proposed;
    }

    setSaving("patch");
    setNotice(null);
    try {
      await persistPatch(patch, `AI Input Patch applied in ${patchMode} mode.`);
      setPatchValues(null);
      setPatchConfidence(null);
      setRawPatch("");
      setNotice({ kind: "success", text: `Patch applied to ${populated.length} section(s) in ${patchMode} mode.` });
    } catch (error) {
      setNotice({ kind: "error", text: `Apply Patch failed: ${errorMessage(error)}` });
    } finally {
      setSaving(null);
    }
  }

  if (loading && !inputs) {
    return <div className="p-6 text-paper-3 text-xs">Loading context inputs…</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="bg-ink-200 border border-line rounded-[10px] px-4 py-3 flex items-center gap-4 flex-wrap">
        <div>
          <div className="text-xs text-paper">
            <span className={readinessText.colour}>{readinessText.label}</span>
            <span className="text-paper-3"> · {readiness.filledCount} / {CONTEXT_INPUT_SECTIONS.length} sections saved</span>
          </div>
          <p className="text-2xs text-paper-3 mt-1">{readinessText.detail}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="ghost" disabled={dirtyKeys.length === 0 || saving !== null} onClick={resetUnsaved}>
            Reset Unsaved Changes
          </Button>
          <Button size="sm" variant="secondary" disabled={loading || saving !== null} onClick={() => void loadInputs(true).catch(() => undefined)}>
            {loading ? "Reloading…" : "Reload From Database"}
          </Button>
          <Button size="sm" variant="primary" disabled={dirtyKeys.length === 0 || saving !== null} onClick={() => void saveAll()}>
            {saving === "all" ? "Saving All…" : `Save All${dirtyKeys.length ? ` (${dirtyKeys.length})` : ""}`}
          </Button>
        </div>
      </div>

      {notice && (
        <div className={`rounded-[8px] border px-3 py-2 text-xs ${
          notice.kind === "error"
            ? "bg-neg/5 border-neg/20 text-neg"
            : notice.kind === "success"
              ? "bg-teal/5 border-teal/20 text-teal"
              : "bg-info/5 border-info/20 text-paper-2"
        }`} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.text}
        </div>
      )}

      {CONTEXT_INPUT_SECTIONS.map((section) => {
        const value = draft[section.key];
        const savedValue = inputs?.[section.key] ?? "";
        const dirty = value !== savedValue;
        const fieldError = fieldErrors[section.key];
        const status = fieldError ? "error" : dirty ? "draft" : hasContextValue(savedValue) ? "saved" : "empty";

        return (
          <div key={section.key} className={`bg-ink-200 border rounded-[10px] overflow-hidden ${fieldError ? "border-neg/40" : "border-line"}`}>
            <button aria-expanded={expandedSections[section.key]} onClick={() => setExpandedSections((previous) => ({ ...previous, [section.key]: !previous[section.key] }))} className={`w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-ink-100 ${expandedSections[section.key] ? "border-b border-line" : ""}`}>
              <span className="text-2xs text-paper-3">{expandedSections[section.key] ? "▼" : "▶"}</span>
              <span className="text-xs font-medium text-paper">{section.label}</span>
              <span className="text-2xs text-paper-3">{section.recommended ? "recommended" : "optional"}</span>
              <span className={`text-2xs font-mono ${status === "saved" ? "text-teal" : status === "draft" ? "text-warn" : status === "error" ? "text-neg" : "text-paper-3"}`}>
                {status}
              </span>
              {isPlaceholderInput(savedValue) && <span className="text-2xs font-mono text-neg">placeholder</span>}
              <span className="ml-auto text-2xs font-mono text-paper-3">{value.length.toLocaleString()} characters</span>
              {inputs?.updated_at && !dirty && (
                <span className="text-2xs text-paper-3" title={inputs.updated_at}>
                  Last saved {new Date(inputs.updated_at).toLocaleString()}
                </span>
              )}
            </button>
            {expandedSections[section.key] && <div className="p-3 flex flex-col gap-2">
              <p className="text-2xs text-paper-3">{section.hint}</p>
              <textarea
                className="w-full bg-ink border border-line rounded-md px-3 py-2 text-xs text-paper placeholder:text-paper-3 resize-y min-h-[100px] focus:outline-none focus:border-teal/50 transition-colors"
                placeholder={`Enter ${section.label.toLowerCase()}…`}
                value={value}
                onChange={(event) => {
                  setDraft((previous) => ({ ...previous, [section.key]: event.target.value }));
                  setFieldErrors((previous) => ({ ...previous, [section.key]: undefined }));
                }}
              />
              {fieldError && <p className="text-2xs text-neg" role="alert">{fieldError}</p>}
              <div className="flex items-center justify-between">
                <span className="text-2xs text-paper-3 font-mono">{value.length.toLocaleString()} characters</span>
                <Button size="sm" variant={dirty ? "primary" : "ghost"} disabled={!dirty || saving !== null} onClick={() => void saveSection(section.key)}>
                  {saving === section.key ? "Saving…" : "Save Section"}
                </Button>
              </div>
            </div>}
          </div>
        );
      })}

      <div className="bg-ink-200 border border-line rounded-[10px] overflow-hidden">
        <div className="px-4 py-3 border-b border-line">
          <h2 className="text-sm font-medium text-paper">AI Input Patch</h2>
          <p className="text-2xs text-paper-3 mt-1">
            Local heading and keyword heuristics only. No external AI service or browser API key is used. Review the draft before saving.
          </p>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <textarea
            className="w-full bg-ink border border-line rounded-md px-3 py-2 text-xs text-paper placeholder:text-paper-3 resize-y min-h-[220px] focus:outline-none focus:border-teal/50"
            placeholder="Paste raw client input, transcript notes, founder answers, or strategy notes…"
            value={rawPatch}
            onChange={(event) => setRawPatch(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button variant="primary" disabled={!rawPatch.trim() || saving !== null} onClick={createPatch}>Create Draft Patch</Button>
            <Button variant="ghost" disabled={(!rawPatch && !patchValues) || saving !== null} onClick={clearPatch}>Clear Patch</Button>
            <span className="ml-auto text-2xs text-paper-3 font-mono">{rawPatch.length.toLocaleString()} characters</span>
          </div>

          {patchValues && patchConfidence && (
            <div className="border-t border-line pt-4 flex flex-col gap-3">
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-xs font-medium text-paper">Draft preview — editable, not saved</span>
                <label className="text-xs text-paper-2 flex items-center gap-1.5">
                  <input type="radio" name="patch-mode" checked={patchMode === "append"} onChange={() => setPatchMode("append")} />
                  Append to existing fields
                </label>
                <label className="text-xs text-paper-2 flex items-center gap-1.5">
                  <input type="radio" name="patch-mode" checked={patchMode === "replace"} onChange={() => setPatchMode("replace")} />
                  Replace fields
                </label>
              </div>
              <p className="text-2xs text-paper-3">
                Append is the default. Batch C placeholder values are replaced automatically in either mode.
              </p>

              {CONTEXT_INPUT_SECTIONS.map((section) => {
                const existing = inputs?.[section.key] ?? "";
                const proposed = patchValues[section.key];
                const hasExisting = hasContextValue(existing) && !isPlaceholderInput(existing);
                return (
                  <div key={`patch-${section.key}`} className="bg-ink border border-line rounded-md p-3 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-paper">{section.label}</span>
                      <span className={`text-2xs font-mono ${confidenceColour(patchConfidence[section.key])}`}>
                        {patchConfidence[section.key]}
                      </span>
                      {hasExisting && hasContextValue(proposed) && (
                        <span className="ml-auto text-2xs text-warn">
                          Existing value will be {patchMode === "append" ? "appended to" : "replaced"}.
                        </span>
                      )}
                      {isPlaceholderInput(existing) && hasContextValue(proposed) && (
                        <span className="ml-auto text-2xs text-teal">Batch C placeholder will be replaced.</span>
                      )}
                    </div>
                    <textarea
                      className="w-full bg-ink-200 border border-line rounded-md px-3 py-2 text-xs text-paper resize-y min-h-[80px] focus:outline-none focus:border-teal/50"
                      value={proposed}
                      placeholder="No content mapped. Add content manually if needed."
                      onChange={(event) => setPatchValues((previous) => previous ? { ...previous, [section.key]: event.target.value } : previous)}
                    />
                  </div>
                );
              })}

              <div className="flex justify-end">
                <Button variant="primary" disabled={saving !== null} onClick={() => void applyPatch()}>
                  {saving === "patch" ? "Applying Patch…" : "Apply Patch to Client Inputs"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-ink-200 border border-dashed border-line rounded-[10px] px-4 py-5 text-center">
        <p className="text-xs text-paper-3">Transcript and asset uploads are not included in this batch.</p>
      </div>
    </div>
  );
}
