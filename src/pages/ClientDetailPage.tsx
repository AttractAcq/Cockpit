import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Icon, EmptyState } from "@/components/primitives";
import { Button } from "@/components/primitives";
import { fetchClient, runPhase1, generatePhase1File, finalizePhase1, runPhase2 } from "@/lib/api";
import type { Client } from "@/types/client";
import type { Phase1Result, Phase2Result } from "@/types/phase";
import { CONTEXT_FILE_DEFS } from "@/types/phase";
import { ROUTES } from "@/lib/constants";
import { TIER_LABELS as TL } from "@/types/client";
import { ContextInputsPanel } from "@/components/client/ContextInputsPanel";
import { ContextFilesPanel } from "@/components/client/ContextFilesPanel";
import { Stage2Panel } from "@/components/client/Stage2Panel";
import { ActivityPanel } from "@/components/client/ActivityPanel";

type Section =
  | "calendar"
  | "context_inputs"
  | "context_files"
  | "stage2"
  | "overview"
  | "pipeline"
  | "masters"
  | "playbooks"
  | "automations"
  | "assets"
  | "analytics"
  | "sops"
  | "weekly"
  | "activity";

const BUTTON_BAR: { label: string; section: Section }[] = [
  { label: "Calendar",         section: "calendar" },
  { label: "Context Inputs",   section: "context_inputs" },
  { label: "Context Files",    section: "context_files" },
  { label: "Stage 2",          section: "stage2" },
  { label: "Overview",         section: "overview" },
  { label: "Pipeline",         section: "pipeline" },
  { label: "Masters",          section: "masters" },
  { label: "Playbooks",        section: "playbooks" },
  { label: "Automations",      section: "automations" },
  { label: "Assets",           section: "assets" },
  { label: "Analytics",        section: "analytics" },
  { label: "SOPs / Laws",      section: "sops" },
  { label: "Weekly Seq.",      section: "weekly" },
  { label: "Activity Log",     section: "activity" },
];

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function StageBadge({ status, label }: { status: string; label: string }) {
  const colour =
    status === "complete"
      ? "text-teal"
      : status === "error"
      ? "text-neg"
      : "text-paper-3";
  return (
    <span className={`text-2xs font-mono flex items-center gap-1 ${colour}`}>
      {status === "complete" && <Icon name="check" size={11} />}
      {label}: {status === "complete" ? "Done" : status === "running" ? "Running" : "Not Run"}
    </span>
  );
}

function PlaceholderSection({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <EmptyState icon="clock" title={title} body={description} />
    </div>
  );
}

const SECTION_PLACEHOLDERS: Partial<Record<Section, { title: string; description: string }>> = {
  calendar:    { title: "Calendar",        description: "Code-only monthly grid. Cells derive from master rows. Coming in a later batch." },
  overview:    { title: "Overview",        description: "Stage status, pipeline snapshot, open approvals, proof gaps." },
  pipeline:    { title: "Pipeline",        description: "9-stage daily entry grid. Manual first." },
  masters:     { title: "Master Tables",   description: "Organic, Ads, Story, Proof, Asset, Lead Magnet, Website, SOPs & Asset Brief Index." },
  playbooks:   { title: "Playbooks",       description: "7 AI playbook buttons → propose → approve → commit as needs_review drafts." },
  automations: { title: "Automations",     description: "Secret-gated toggles for 6 automation types." },
  assets:      { title: "Assets",          description: "Asset Master + Proof Master grids. Upload portal." },
  analytics:   { title: "Analytics",       description: "Pipeline trends, content performance, proof signals." },
  sops:        { title: "SOPs / Laws",     description: "37 content laws + client-specific governance layer." },
  weekly:      { title: "Weekly Sequence", description: "Fixed weekly rhythm rows (day, slot, content type, archetype)." },
};

function CalendarPlaceholder() {
  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="bg-ink-200 border border-line rounded-[10px] overflow-hidden">
        <div className="px-3 py-2.5 border-b border-line flex items-center gap-2">
          <span className="text-2xs uppercase tracking-cap text-paper-3 font-medium">
            Calendar — Current Month
          </span>
          <span className="ml-auto text-2xs text-paper-3 font-mono">
            code-only · no free text
          </span>
        </div>
        <div className="p-4 text-center">
          <p className="text-xs text-paper-3 mb-1">
            Cells will contain ref codes only (e.g.{" "}
            <span className="font-mono text-teal">JUL-RL-001</span>).
          </p>
          <p className="text-xs text-paper-3">
            7 fixed rows · Ad 1, Ad 2, Ad 3, Reel, Stories, Feed Posts,
            Carousels.
            <br />
            Placement driven by master Distribution Date / Start-End fields.
          </p>
          <p className="text-2xs text-paper-3 mt-3 font-mono">
            Coming in a later batch
          </p>
        </div>
      </div>
    </div>
  );
}

type PhaseResult =
  | { kind: "phase1"; result: Phase1Result }
  | { kind: "phase2"; result: Phase2Result }
  | null;

function modeColour(mode: string): string {
  if (
    mode === "contract_ready" || mode === "generated" || mode === "started" ||
    mode === "generation_started" || mode === "file_generated"
  ) return "teal";
  if (mode === "blocked") return "warn";
  return "neg";
}

function modeLabel(mode: string): string {
  if (mode === "contract_ready") return "contract ready — no AI generation yet";
  if (mode === "generated") return "generated";
  if (mode === "generation_started") return "generation prepared — files generate sequentially";
  if (mode === "file_generated") return "file generated";
  if (mode === "blocked") return "blocked";
  if (mode === "error") return "error";
  return mode;
}

function PhaseResultBanner({
  phaseResult,
  onDismiss,
}: {
  phaseResult: PhaseResult;
  onDismiss: () => void;
}) {
  if (!phaseResult) return null;
  const { kind, result } = phaseResult;
  const colour = modeColour(result.mode);
  const missing =
    kind === "phase1" ? result.missingInputs : result.missingContextFiles;

  return (
    <div
      className={`mx-4 mt-3 px-4 py-3 rounded-[10px] border text-xs flex items-start gap-3 ${
        colour === "teal"
          ? "bg-teal/5 border-teal/20 text-paper"
          : colour === "warn"
          ? "bg-warn/5 border-warn/20 text-paper"
          : "bg-neg/5 border-neg/20 text-paper"
      }`}
    >
      <span
        className={`font-mono text-2xs shrink-0 mt-0.5 ${
          colour === "teal" ? "text-teal" : colour === "warn" ? "text-warn" : "text-neg"
        }`}
      >
        {kind === "phase1" ? "PHASE 1" : "PHASE 2"}
      </span>
      <span className="flex-1">
        {result.message}
        {missing.length > 0 && (
          <span className="block text-2xs font-mono text-paper-3 mt-1">
            Missing: {missing.join(" · ")}
          </span>
        )}
        {result.warnings && result.warnings.length > 0 && (
          <span className="block text-2xs font-mono text-paper-3 mt-1">
            {result.warnings.join(" · ")}
          </span>
        )}
        <span className="block text-2xs font-mono text-paper-3 mt-0.5">
          {modeLabel(result.mode)}
        </span>
      </span>
      <button
        onClick={onDismiss}
        className="text-paper-3 hover:text-paper text-xs shrink-0"
      >
        ✕
      </button>
    </div>
  );
}

export function ClientDetailPage() {
  const { id, section = "calendar" } = useParams<{
    id: string;
    section?: string;
  }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phase1Running, setPhase1Running] = useState(false);
  const [phase1Progress, setPhase1Progress] = useState<{ current: number; total: number } | null>(null);
  const [phase2Running, setPhase2Running] = useState(false);
  const [phaseResult, setPhaseResult] = useState<PhaseResult>(null);
  const [contextFilesKey, setContextFilesKey] = useState(0);
  const [stage2Key, setStage2Key] = useState(0);

  const activeSection = (section as Section) ?? "calendar";

  useEffect(() => {
    if (!id) return;
    fetchClient(id)
      .then((c) => {
        if (!c) setError("Client not found");
        else setClient(c);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading)
    return (
      <div className="flex-1 flex items-center justify-center text-paper-3 text-xs">
        Loading…
      </div>
    );
  if (error)
    return (
      <div className="flex-1 flex items-center justify-center text-neg text-xs">
        {error}
      </div>
    );
  if (!client) return null;

  function navTo(s: Section) {
    navigate(ROUTES.clientSection(client!.id, s));
  }

  async function handleRunPhase1() {
    if (!id) return;
    setPhase1Running(true);
    setPhaseResult(null);
    setPhase1Progress(null);

    try {
      // 1. Prepare — validates inputs and the AI gate, returns the file list.
      const prep = await runPhase1(id);

      if (prep.mode !== "generation_started") {
        // blocked / contract_ready / error — show and stop.
        setPhaseResult({ kind: "phase1", result: prep });
        return;
      }

      const files =
        (prep.data?.files as Array<{ file_number: number; file_name: string }> | undefined) ??
        CONTEXT_FILE_DEFS.map((d) => ({ file_number: d.number, file_name: d.file_name }));
      const total = files.length;

      // 2. Generate sequentially — one edge invocation per file. Sequential
      //    keeps each call inside the edge-function time limit and avoids
      //    Anthropic rate pressure.
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setPhase1Progress({ current: i + 1, total });
        const res = await generatePhase1File(id, f.file_number);
        if (!res.ok) {
          setPhaseResult({
            kind: "phase1",
            result: {
              ...res,
              message: `Phase 1 stopped at file ${i + 1} of ${total} (${f.file_name}): ${res.message}`,
            },
          });
          return;
        }
        setContextFilesKey((k) => k + 1);
      }

      // 3. Finalize — sets stage1_status = complete only if all 21 exist.
      const fin = await finalizePhase1(id);
      setPhaseResult({ kind: "phase1", result: fin });
      if (fin.ok && fin.mode === "generated") {
        setContextFilesKey((k) => k + 1);
        const refreshed = await fetchClient(id).catch(() => null);
        if (refreshed) setClient(refreshed);
      }
    } finally {
      setPhase1Progress(null);
      setPhase1Running(false);
    }
  }

  async function handleRunPhase2() {
    if (!id) return;
    setPhase2Running(true);
    setPhaseResult(null);
    try {
      const result = await runPhase2(id, currentMonth());
      setPhaseResult({ kind: "phase2", result });
      setStage2Key((k) => k + 1);
    } finally {
      setPhase2Running(false);
    }
  }

  function renderSection() {
    if (!id) return null;
    switch (activeSection) {
      case "context_inputs":
        return <ContextInputsPanel clientId={id} />;
      case "context_files":
        return <ContextFilesPanel key={contextFilesKey} clientId={id} />;
      case "stage2":
        return <Stage2Panel key={stage2Key} clientId={id} executionMonth={currentMonth()} />;
      case "activity":
        return <ActivityPanel clientId={id} />;
      case "calendar":
        return <CalendarPlaceholder />;
      default: {
        const p = SECTION_PLACEHOLDERS[activeSection];
        return p ? (
          <PlaceholderSection title={p.title} description={p.description} />
        ) : null;
      }
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
      {/* Client Header */}
      <div className="border-b border-line px-4 py-3 flex flex-col gap-2.5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(ROUTES.clients)}
            className="text-paper-3 hover:text-paper transition-colors"
          >
            <Icon name="arrow-left" size={14} />
          </button>
          <h1 className="text-sm font-medium text-paper flex items-center gap-2">
            {client.name}
            {client.is_internal_client && (
              <span className="text-2xs text-teal font-mono bg-teal/10 rounded px-1.5 py-0.5">
                internal
              </span>
            )}
            <span className="text-2xs text-paper-3 font-mono">
              {TL[client.package_tier]}
            </span>
          </h1>
          <div className="ml-auto flex items-center gap-4">
            <StageBadge status={client.stage1_status} label="Phase 1" />
            <StageBadge status={client.stage2_status} label="Phase 2" />
            <span className="text-2xs text-paper-3 font-mono">
              Health:{" "}
              <span
                className={
                  client.health_score >= 70
                    ? "text-teal"
                    : client.health_score >= 40
                    ? "text-warn"
                    : "text-neg"
                }
              >
                {client.health_score}
              </span>
            </span>
          </div>
        </div>

        {/* Button bar */}
        <div className="flex items-center gap-1 flex-wrap">
          {BUTTON_BAR.map(({ label, section: s }) => (
            <button
              key={s}
              onClick={() => navTo(s)}
              className={`px-2.5 py-1 text-2xs rounded-md transition-colors font-medium ${
                activeSection === s
                  ? "bg-teal/15 text-teal"
                  : "text-paper-3 hover:text-paper hover:bg-ink-200"
              }`}
            >
              {label}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="subtle"
              size="sm"
              disabled={
                client.stage1_status === "running" || phase1Running
              }
              onClick={handleRunPhase1}
            >
              {phase1Running
                ? phase1Progress
                  ? `Generating ${phase1Progress.current}/${phase1Progress.total}…`
                  : "Running…"
                : "Run Phase 1"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={
                client.stage1_status !== "complete" ||
                client.stage2_status === "running" ||
                phase2Running
              }
              onClick={handleRunPhase2}
            >
              {phase2Running ? "Running…" : "Run Phase 2"}
            </Button>
          </div>
        </div>
      </div>

      {/* Phase 1 sequential generation progress */}
      {phase1Progress && (
        <div className="mx-4 mt-3 px-4 py-3 rounded-[10px] border bg-teal/5 border-teal/20 text-xs flex items-center gap-3">
          <span className="font-mono text-2xs text-teal shrink-0">PHASE 1</span>
          <span className="flex-1 text-paper">
            Generating Phase 1 file {phase1Progress.current} of {phase1Progress.total}…
          </span>
          <span className="font-mono text-2xs text-paper-3 shrink-0">
            {Math.round(((phase1Progress.current - 1) / phase1Progress.total) * 100)}%
          </span>
        </div>
      )}

      {/* Phase result banner */}
      {phaseResult && (
        <PhaseResultBanner
          phaseResult={phaseResult}
          onDismiss={() => setPhaseResult(null)}
        />
      )}

      {/* Section content */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {renderSection()}
      </div>
    </div>
  );
}
