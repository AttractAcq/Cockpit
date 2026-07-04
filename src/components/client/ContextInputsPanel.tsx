import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/primitives";
import { fetchClientInputs, upsertClientInputs, logActivity } from "@/lib/api";
import type { ClientInputs } from "@/types/phase";

interface InputSection {
  key: keyof ClientInputs;
  label: string;
  hint: string;
}

const SECTIONS: InputSection[] = [
  {
    key: "business_description",
    label: "Business Overview",
    hint: "Business description, website URL, geography and target market.",
  },
  {
    key: "offer_details",
    label: "Offer / Services",
    hint: "What is sold, at what price tier, and how is it delivered?",
  },
  {
    key: "target_customer",
    label: "Ideal Customer",
    hint: "Who specifically you help and who you are NOT targeting.",
  },
  {
    key: "proof_notes",
    label: "Proof / Testimonials",
    hint: "Results, testimonials, reviews, case studies, before/after outcomes. Honest only — no invented proof.",
  },
  {
    key: "sales_process",
    label: "Sales Process",
    hint: "How sales happen: discovery, demo, closing steps, common objections.",
  },
  {
    key: "current_marketing",
    label: "Current Marketing",
    hint: "What is working. Channels tried. Existing content or campaigns.",
  },
  {
    key: "brand_voice",
    label: "Brand Voice",
    hint: "Tone, language rules, what never to say or claim.",
  },
  {
    key: "competitors",
    label: "Competitors",
    hint: "Competitor names, what they do, how you are different.",
  },
  {
    key: "constraints_approval_rules",
    label: "Constraints / Approval Rules",
    hint: "Compliance notes, sign-off requirements, claims to avoid.",
  },
  {
    key: "raw_notes",
    label: "Raw Notes",
    hint: "Founder or team notes. Anything that does not fit above.",
  },
];

function hasValue(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

export function ContextInputsPanel({ clientId }: { clientId: string }) {
  const [inputs, setInputs] = useState<ClientInputs | null>(null);
  const [draft, setDraft] = useState<Partial<Record<keyof ClientInputs, string>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    fetchClientInputs(clientId).then((data) => {
      if (!alive) return;
      setInputs(data);
      if (data) {
        const d: Partial<Record<keyof ClientInputs, string>> = {};
        for (const s of SECTIONS) {
          const v = data[s.key];
          if (typeof v === "string") d[s.key] = v;
        }
        setDraft(d);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
    return () => { alive = false; };
  }, [clientId]);

  const saveSection = useCallback(
    async (key: keyof ClientInputs) => {
      setSaving(key as string);
      try {
        const updated = await upsertClientInputs(clientId, {
          [key]: draft[key] ?? "",
        } as Partial<Omit<ClientInputs, "id" | "client_id" | "created_at" | "updated_at">>);
        setInputs(updated);
        setJustSaved((p) => ({ ...p, [key]: true }));
        await logActivity(
          clientId,
          "raw_input_saved",
          `Context input section "${SECTIONS.find((s) => s.key === key)?.label ?? String(key)}" saved.`
        );
        setTimeout(
          () => setJustSaved((p) => ({ ...p, [key]: false })),
          2000
        );
      } finally {
        setSaving(null);
      }
    },
    [clientId, draft]
  );

  if (loading)
    return <div className="p-6 text-paper-3 text-xs">Loading context inputs…</div>;

  const filledCount = SECTIONS.filter((s) => hasValue(inputs?.[s.key])).length;
  const minMet = filledCount >= 3;

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
      {/* Completeness bar */}
      <div className="bg-ink-200 border border-line rounded-[10px] px-4 py-3 flex items-center gap-4 flex-wrap">
        <span className="text-xs text-paper">
          <span
            className={
              filledCount >= 6
                ? "text-teal"
                : filledCount >= 3
                ? "text-warn"
                : "text-neg"
            }
          >
            {filledCount}
          </span>
          <span className="text-paper-3"> / {SECTIONS.length} sections filled</span>
        </span>
        <span
          className={`ml-auto text-2xs font-mono ${
            minMet ? "text-teal" : "text-paper-3"
          }`}
        >
          {minMet
            ? "Minimum inputs present — Phase 1 ready"
            : "Fill at least 3 sections before running Phase 1"}
        </span>
      </div>

      {/* Section inputs */}
      {SECTIONS.map((section) => {
        const value = draft[section.key] ?? "";
        const savedValue = inputs?.[section.key];
        const isFilled = hasValue(savedValue);
        const isDirty =
          value !== (typeof savedValue === "string" ? savedValue : "");
        const isSavingThis = saving === section.key;
        const savedFlash = justSaved[section.key];

        return (
          <div
            key={section.key}
            className="bg-ink-200 border border-line rounded-[10px] overflow-hidden"
          >
            <div className="px-4 py-2.5 border-b border-line flex items-center gap-2">
              <span className="text-xs font-medium text-paper">
                {section.label}
              </span>
              {savedFlash && (
                <span className="text-2xs font-mono text-teal">saved ✓</span>
              )}
              {!savedFlash && isFilled && !isDirty && (
                <span className="text-2xs font-mono text-teal">saved</span>
              )}
              {!savedFlash && !isFilled && !isDirty && (
                <span className="text-2xs font-mono text-paper-3">empty</span>
              )}
              {!savedFlash && isDirty && (
                <span className="text-2xs font-mono text-warn">unsaved</span>
              )}
            </div>
            <div className="p-3 flex flex-col gap-2">
              <p className="text-2xs text-paper-3">{section.hint}</p>
              <textarea
                className="w-full bg-ink border border-line rounded-md px-3 py-2 text-xs text-paper placeholder:text-paper-3 resize-y min-h-[80px] focus:outline-none focus:border-teal/50 transition-colors"
                placeholder={`Enter ${section.label.toLowerCase()}…`}
                value={value}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, [section.key]: e.target.value }))
                }
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant={savedFlash ? "subtle" : isDirty ? "primary" : "ghost"}
                  disabled={!isDirty || isSavingThis}
                  onClick={() => saveSection(section.key)}
                >
                  {isSavingThis ? "Saving…" : savedFlash ? "Saved ✓" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        );
      })}

      {/* Upload placeholders — coming in a later batch */}
      <div className="bg-ink-200 border border-dashed border-line rounded-[10px] px-4 py-5 text-center">
        <p className="text-xs text-paper-3">
          Transcript Upload — file-to-Storage integration coming in a later batch.
        </p>
      </div>
      <div className="bg-ink-200 border border-dashed border-line rounded-[10px] px-4 py-5 text-center">
        <p className="text-xs text-paper-3">
          Asset Upload (brand files, proof photos) — coming in a later batch.
        </p>
      </div>
    </div>
  );
}
