import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Icon, EmptyState } from "@/components/primitives";
import { Button } from "@/components/primitives";
import { fetchClient, fetchClientInputs, fetchClientContextFiles, fetchClientExecutionFiles, runPhase1, generatePhase1File, finalizePhase1, runPhase2, generatePhase2Section, finalizePhase2, runPhase3, generatePhase3Section, finalizePhase3 } from "@/lib/api";
import type { Client } from "@/types/client";
import type { ClientContextFile, ClientExecutionFile, ClientInputs, Phase1Result, Phase2Result, Phase2Section, Phase3Result, Phase3Section } from "@/types/phase";
import { CONTEXT_FILE_DEFS } from "@/types/phase";
import { ROUTES } from "@/lib/constants";
import { TIER_LABELS as TL } from "@/types/client";
import { ContextInputsPanel } from "@/components/client/ContextInputsPanel";
import { ContextFilesPanel } from "@/components/client/ContextFilesPanel";
import { ExecutionFilesPanel } from "@/components/client/ExecutionFilesPanel";
import { MastersPanel } from "@/components/client/MastersPanel";
import { Phase3CalendarPanel } from "@/components/client/Phase3CalendarPanel";
import { ClientOverviewPanel } from "@/components/client/ClientOverviewPanel";
import { SopsLawsPanel } from "@/components/client/SopsLawsPanel";
import { ActivityPanel } from "@/components/client/ActivityPanel";
import { contextLabel, getContextReadiness } from "@/lib/contextInputs";
import { EXECUTION_FILE_COUNT, EXECUTION_FILE_MANIFEST } from "../../supabase/functions/_shared/execution-manifest";

type Section =
  | "calendar"
  | "context_inputs"
  | "context_files"
  | "execution_files"
  | "overview"
  | "pipeline"
  | "masters"
  | "automations"
  | "assets"
  | "analytics"
  | "sops"
  | "activity";

const BUTTON_BAR: { label: string; section: Section }[] = [
  { label: "Overview",         section: "overview" },
  { label: "Pipeline",         section: "pipeline" },
  { label: "Context Inputs",   section: "context_inputs" },
  { label: "Context Files",    section: "context_files" },
  { label: "Execution Files",  section: "execution_files" },
  { label: "Masters",          section: "masters" },
  { label: "Calendar",         section: "calendar" },
  { label: "Automations",      section: "automations" },
  { label: "Assets",           section: "assets" },
  { label: "Analytics",        section: "analytics" },
  { label: "SOPs / Laws",      section: "sops" },
  { label: "Activity Log",     section: "activity" },
];

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function canonicalExecutionReady(files: ClientExecutionFile[]): boolean {
  return files.length === EXECUTION_FILE_COUNT && EXECUTION_FILE_MANIFEST.every((definition) => files.some((file) =>
    file.file_number === definition.fileNumber && file.file_name === definition.fileName && file.review_state === "approved"
  ));
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
  pipeline:    { title: "Pipeline",        description: "9-stage daily entry grid. Manual first." },
  automations: { title: "Automations",     description: "Secret-gated toggles for 6 automation types." },
  assets:      { title: "Assets",          description: "Asset Master + Proof Master grids. Upload portal." },
  analytics:   { title: "Analytics",       description: "Pipeline trends, content performance, proof signals." },
};

type PhaseResult =
  | { kind: "phase1"; result: Phase1Result }
  | { kind: "phase2"; result: Phase2Result }
  | { kind: "phase3"; result: Phase3Result }
  | null;

type PhaseNumber = 1 | 2 | 3;

const PHASE_CONFIRMATIONS: Record<PhaseNumber, { title: string; body: string; confirm: string }> = {
  1: {
    title: "Run Phase 1?",
    body: "This will regenerate the Phase 1 Context Files from the saved Context Inputs. Existing generated Context Files may be replaced. Do this only if the Context Inputs are final and you are ready to review the generated files again.",
    confirm: "Run Phase 1",
  },
  2: {
    title: "Run Phase 2?",
    body: "This will regenerate the 11 canonical Execution Files from the approved Context Files. Existing Execution Files for this client may be replaced. Masters and Calendar outputs will not be changed.",
    confirm: "Run Phase 2",
  },
  3: {
    title: "Run Phase 3?",
    body: "This will regenerate Masters and Calendar outputs from the approved Context Files and approved Execution Files. Existing Organic, Story, Ads, and Calendar rows for this client/month may be replaced. Context Files and Execution Files will not be changed.",
    confirm: "Run Phase 3",
  },
};

function PhaseConfirmationDialog({ phase, running, onCancel, onConfirm }: {
  phase: PhaseNumber;
  running: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = PHASE_CONFIRMATIONS[phase];
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !running) onCancel();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel, running]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !running) onCancel();
    }}>
      <div role="dialog" aria-modal="true" aria-labelledby="phase-confirm-title" className="w-full max-w-lg rounded-xl border border-line bg-ink-200 p-5 shadow-2xl">
        <h2 id="phase-confirm-title" className="text-sm font-medium text-paper">{copy.title}</h2>
        <p className="mt-3 text-xs leading-relaxed text-paper-2">{copy.body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="subtle" size="sm" disabled={running} onClick={onCancel}>Cancel</Button>
          <Button variant="primary" size="sm" disabled={running} onClick={onConfirm}>
            {running ? "Starting…" : copy.confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}

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
        {kind === "phase1" ? "PHASE 1" : kind === "phase2" ? "PHASE 2" : "PHASE 3"}
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
  const phase2RunLock = useRef(false);
  const [phase2Progress, setPhase2Progress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [phase3Running, setPhase3Running] = useState(false);
  const [phase3Progress, setPhase3Progress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [phaseResult, setPhaseResult] = useState<PhaseResult>(null);
  const [phaseConfirmation, setPhaseConfirmation] = useState<PhaseNumber | null>(null);
  const [contextInputsKey, setContextInputsKey] = useState(0);
  const [contextFilesKey, setContextFilesKey] = useState(0);
  const [executionFilesKey, setExecutionFilesKey] = useState(0);
  const [phase3Key, setPhase3Key] = useState(0);
  const [contextInputs, setContextInputs] = useState<ClientInputs | null>(null);
  const [contextFiles, setContextFiles] = useState<ClientContextFile[]>([]);
  const [executionFiles, setExecutionFiles] = useState<ClientExecutionFile[]>([]);

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

  useEffect(() => {
    if (!id) return;
    const clientId = id;
    function reloadClientData() {
      void Promise.all([
        fetchClient(clientId).then((next) => { if (next) setClient(next); }),
        fetchClientInputs(clientId).then(setContextInputs),
        fetchClientContextFiles(clientId).then(setContextFiles),
        fetchClientExecutionFiles(clientId, currentMonth()).then(setExecutionFiles),
      ]).catch((reloadError: Error) => setError(reloadError.message));
      setContextInputsKey((key) => key + 1);
      setContextFilesKey((key) => key + 1);
      setExecutionFilesKey((key) => key + 1);
      setPhase3Key((key) => key + 1);
    }
    window.addEventListener("aa:reload", reloadClientData);
    return () => window.removeEventListener("aa:reload", reloadClientData);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetchClientInputs(id).then(setContextInputs).catch(() => setContextInputs(null));
    fetchClientContextFiles(id).then(setContextFiles).catch(() => setContextFiles([]));
    fetchClientExecutionFiles(id, currentMonth()).then(setExecutionFiles).catch(() => setExecutionFiles([]));
  }, [id]);

  const handleInputsLoaded = useCallback((nextInputs: ClientInputs | null) => {
    setContextInputs(nextInputs);
  }, []);

  const handleContextFilesLoaded = useCallback((nextFiles: ClientContextFile[]) => {
    setContextFiles(nextFiles);
  }, []);

  const handleExecutionFilesLoaded = useCallback((nextFiles: ClientExecutionFile[]) => {
    setExecutionFiles(nextFiles);
  }, []);

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
    setPhaseResult(null);
    setPhase1Progress(null);

    try {
      // Always validate a fresh database snapshot. Draft text in the editor is
      // intentionally ignored until it has been saved.
      const latestInputs = await fetchClientInputs(id);
      setContextInputs(latestInputs);
      const readiness = getContextReadiness(latestInputs);

      if (readiness.placeholderFields.length > 0) {
        setPhaseResult({
          kind: "phase1",
          result: {
            ok: false,
            mode: "blocked",
            message: "Placeholder inputs detected — replace before running Phase 1.",
            warnings: [],
            missingInputs: readiness.placeholderFields.map(contextLabel),
          },
        });
        return;
      }

      if (readiness.missingRecommended.length > 0) {
        setPhaseResult({
          kind: "phase1",
          result: {
            ok: false,
            mode: "blocked",
            message: "Recommended context sections are missing. Save them before running Phase 1.",
            warnings: [],
            missingInputs: readiness.missingRecommended.map(contextLabel),
          },
        });
        return;
      }

      if (readiness.missingOptional.length > 0 && !window.confirm(
        `Optional context is missing: ${readiness.missingOptional.map(contextLabel).join(", ")}. Run Phase 1 anyway?`,
      )) return;

      setPhase1Running(true);
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
        const res = await generatePhase1File(id, f.file_number, f.file_name);
        if (!res.ok) {
          setPhaseResult({
            kind: "phase1",
            result: {
              ...res,
              message: `Phase 1 stopped at item ${i + 1} of ${total} — file #${String(f.file_number).padStart(2, "0")} (${f.file_name}): ${res.message}`,
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
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPhaseResult({
        kind: "phase1",
        result: {
          ok: false,
          mode: "error",
          message: `Could not validate context inputs: ${message}`,
          warnings: [],
          missingInputs: [],
          error: message,
        },
      });
    } finally {
      setPhase1Progress(null);
      setPhase1Running(false);
    }
  }

  async function handleRunPhase2() {
    if (!id || phase2RunLock.current) return;
    phase2RunLock.current = true;
    setPhaseResult(null);
    try {
      const latestFiles = await fetchClientContextFiles(id);
      setContextFiles(latestFiles);
      const byNumber = new Map(latestFiles.map((file) => [file.file_number, file]));
      const notApproved = CONTEXT_FILE_DEFS.filter(
        (definition) => byNumber.get(definition.number)?.status !== "approved",
      );
      if (notApproved.length > 0) {
        setPhaseResult({
          kind: "phase2",
          result: {
            ok: false,
            mode: "blocked",
            message: "Phase 2 blocked: approve or resolve all context files first.",
            warnings: [],
            missingContextFiles: notApproved.map((definition) => definition.file_name),
          },
        });
        return;
      }
      setPhase2Running(true);
      const month = currentMonth();
      const prepared = await runPhase2(id, month);
      if (!prepared.ok || prepared.mode !== "generation_started") {
        setPhaseResult({ kind: "phase2", result: prepared });
        return;
      }

      const sections: Phase2Section[] = EXECUTION_FILE_MANIFEST.map((definition) => definition.code);
      for (let index = 0; index < sections.length; index += 1) {
        const phase2Section = sections[index];
        const definition = EXECUTION_FILE_MANIFEST[index];
        setPhase2Progress({ current: index + 1, total: sections.length, label: `${definition.code} · ${definition.title}` });
        const generated = await generatePhase2Section(id, month, phase2Section);
        if (!generated.ok || generated.mode !== "section_generated") {
          setPhaseResult({
            kind: "phase2",
            result: {
              ...generated,
              message: `Phase 2 stopped at section ${index + 1} of ${sections.length} (${phase2Section}): ${generated.message}`,
            },
          });
          setExecutionFilesKey((key) => key + 1);
          return;
        }
        setExecutionFilesKey((key) => key + 1);
      }

      const result = await finalizePhase2(id, month);
      setPhaseResult({ kind: "phase2", result });
      if (result.ok) {
        const refreshed = await fetchClient(id).catch(() => null);
        if (refreshed) setClient(refreshed);
      }
      setExecutionFiles(await fetchClientExecutionFiles(id, month).catch(() => []));
      setExecutionFilesKey((key) => key + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPhaseResult({ kind: "phase2", result: {
        ok: false,
        mode: "error",
        message: `Phase 2 orchestration failed: ${message}`,
        warnings: [],
        missingContextFiles: [],
        error: message,
      } });
    } finally {
      phase2RunLock.current = false;
      setPhase2Progress(null);
      setPhase2Running(false);
    }
  }

  async function handleRunPhase3() {
    if (!id) return;
    setPhaseResult(null);
    const month = currentMonth();
    try {
      const [latestContextFiles, latestExecutionFiles] = await Promise.all([
        fetchClientContextFiles(id),
        fetchClientExecutionFiles(id, month),
      ]);
      setContextFiles(latestContextFiles);
      setExecutionFiles(latestExecutionFiles);
      const contextMap = new Map(latestContextFiles.map((file) => [file.file_number, file]));
      const missingContext = CONTEXT_FILE_DEFS.filter((definition) => contextMap.get(definition.number)?.status !== "approved");
      const executionBlocked = !canonicalExecutionReady(latestExecutionFiles);
      if (client?.stage1_status !== "complete" || missingContext.length > 0 || client?.stage2_status !== "complete" || executionBlocked) {
        setPhaseResult({ kind: "phase3", result: {
          ok: false,
          mode: "blocked",
          message: executionBlocked ? "Phase 3 blocked: approve all Execution Files first." : "Phase 3 prerequisites are incomplete.",
          warnings: [],
          missingContextFiles: [
            ...missingContext.map((definition) => definition.file_name),
            ...latestExecutionFiles.filter((file) => file.review_state !== "approved").map((file) => file.file_name),
          ],
        } });
        return;
      }
      setPhase3Running(true);
      const prepared = await runPhase3(id, month);
      if (!prepared.ok || prepared.mode !== "generation_started") { setPhaseResult({ kind: "phase3", result: prepared }); return; }
      const sections: Phase3Section[] = [
        "organic_reels_1",
        "organic_reels_2",
        "organic_reels_3",
        "organic_reels_4",
        "organic_carousels_1",
        "organic_carousels_2",
        "organic_feed_posts_1",
        "organic_feed_posts_2",
        "stories_education_1",
        "stories_education_2",
        "stories_conversion_1",
        "stories_conversion_2",
        "ads",
        "calendar",
      ];
      for (let index = 0; index < sections.length; index += 1) {
        const phase3Section = sections[index];
        setPhase3Progress({ current: index + 1, total: sections.length, label: phase3Section.replaceAll("_", " ") });
        const generated = await generatePhase3Section(id, month, phase3Section);
        if (!generated.ok || generated.mode !== "section_generated") {
          setPhaseResult({ kind: "phase3", result: { ...generated, message: `Phase 3 stopped at section ${index + 1} of ${sections.length} (${phase3Section}): ${generated.message}` } });
          setPhase3Key((key) => key + 1);
          return;
        }
        setPhase3Key((key) => key + 1);
      }
      const result = await finalizePhase3(id, month);
      setPhaseResult({ kind: "phase3", result });
      setPhase3Key((key) => key + 1);
    } finally {
      setPhase3Progress(null);
      setPhase3Running(false);
    }
  }

  function renderSection() {
    if (!id) return null;
    switch (activeSection) {
      case "context_inputs":
        return <ContextInputsPanel key={contextInputsKey} clientId={id} onInputsLoaded={handleInputsLoaded} />;
      case "context_files":
        return <ContextFilesPanel key={contextFilesKey} clientId={id} onFilesLoaded={handleContextFilesLoaded} />;
      case "execution_files":
        return <ExecutionFilesPanel key={executionFilesKey} clientId={id} executionMonth={currentMonth()} onFilesLoaded={handleExecutionFilesLoaded} />;
      case "overview":
        return <ClientOverviewPanel key={`${contextFilesKey}-${phase3Key}`} clientId={id} />;
      case "masters":
        return <MastersPanel key={phase3Key} clientId={id} executionMonth={currentMonth()} />;
      case "sops":
        return <SopsLawsPanel key={executionFilesKey} clientId={id} executionMonth={currentMonth()} />;
      case "activity":
        return <ActivityPanel key={contextFilesKey} clientId={id} />;
      case "calendar":
        return <Phase3CalendarPanel key={phase3Key} clientId={id} executionMonth={currentMonth()} />;
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
      {phaseConfirmation && (
        <PhaseConfirmationDialog
          phase={phaseConfirmation}
          running={phase1Running || phase2Running || phase3Running}
          onCancel={() => setPhaseConfirmation(null)}
          onConfirm={() => {
            const phase = phaseConfirmation;
            setPhaseConfirmation(null);
            if (phase === 1) void handleRunPhase1();
            if (phase === 2) void handleRunPhase2();
            if (phase === 3) void handleRunPhase3();
          }}
        />
      )}
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
            {getContextReadiness(contextInputs).status === "placeholder_detected" && (
              <span className="text-2xs text-neg font-mono">Phase 1 blocked: placeholder input</span>
            )}
            {getContextReadiness(contextInputs).status === "missing_recommended" && (
              <span className="text-2xs text-warn font-mono">Phase 1 needs context input</span>
            )}
            {getContextReadiness(contextInputs).status === "needs_input" && (
              <span className="text-2xs text-neg font-mono">Phase 1 needs context input</span>
            )}
            <Button
              variant="subtle"
              size="sm"
              disabled={
                client.stage1_status === "running" || phase1Running
              }
              onClick={() => setPhaseConfirmation(1)}
            >
              {phase1Running
                ? phase1Progress
                  ? `Generating ${phase1Progress.current}/${phase1Progress.total}…`
                  : "Running…"
                : "Run Phase 1"}
            </Button>
            {client.stage1_status === "complete" && (
              contextFiles.length !== CONTEXT_FILE_DEFS.length ||
              contextFiles.some((file) => file.status !== "approved")
            ) && (
              <span className="text-2xs text-warn font-mono">
                Phase 2 blocked: approve all context files
              </span>
            )}
            <Button
              variant="primary"
              size="sm"
              disabled={
                client.stage1_status !== "complete" ||
                contextFiles.length !== CONTEXT_FILE_DEFS.length ||
                contextFiles.some((file) => file.status !== "approved") ||
                client.stage2_status === "running" ||
                phase2Running
              }
              onClick={() => setPhaseConfirmation(2)}
            >
              {phase2Running
                ? phase2Progress
                  ? `Generating ${phase2Progress.current}/${phase2Progress.total}…`
                  : "Preparing…"
                : "Run Phase 2"}
            </Button>
            {client.stage2_status === "complete" && (
              !canonicalExecutionReady(executionFiles)
            ) && <span className="text-2xs font-mono text-warn">Phase 3 blocked: approve Execution Files</span>}
            <Button
              variant="primary"
              size="sm"
              disabled={
                client.stage1_status !== "complete" ||
                client.stage2_status !== "complete" ||
                contextFiles.length !== CONTEXT_FILE_DEFS.length ||
                contextFiles.some((file) => file.status !== "approved") ||
                !canonicalExecutionReady(executionFiles) ||
                phase2Running || phase3Running
              }
              onClick={() => setPhaseConfirmation(3)}
            >
              {phase3Running
                ? phase3Progress
                  ? `Generating ${phase3Progress.current}/${phase3Progress.total}…`
                  : "Preparing…"
                : "Run Phase 3"}
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

      {phase2Progress && (
        <div className="mx-4 mt-3 px-4 py-3 rounded-[10px] border bg-teal/5 border-teal/20 text-xs flex items-center gap-3">
          <span className="font-mono text-2xs text-teal shrink-0">PHASE 2</span>
          <span className="flex-1 text-paper capitalize">
            Generating {phase2Progress.label} ({phase2Progress.current} of {phase2Progress.total})…
          </span>
          <span className="font-mono text-2xs text-paper-3 shrink-0">
            {Math.round(((phase2Progress.current - 1) / phase2Progress.total) * 100)}%
          </span>
        </div>
      )}

      {phase3Progress && (
        <div className="mx-4 mt-3 flex items-center gap-3 rounded-[10px] border border-teal/20 bg-teal/5 px-4 py-3 text-xs">
          <span className="shrink-0 font-mono text-2xs text-teal">PHASE 3</span>
          <span className="flex-1 capitalize text-paper">Generating {phase3Progress.label} ({phase3Progress.current} of {phase3Progress.total})…</span>
          <span className="shrink-0 font-mono text-2xs text-paper-3">{Math.round(((phase3Progress.current - 1) / phase3Progress.total) * 100)}%</span>
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
