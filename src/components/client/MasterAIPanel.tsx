import { useCallback, useEffect, useRef, useState } from "react";
import { Button, EmptyState, Tag } from "@/components/primitives";
import {
  fetchJarvisSettings, setJarvisAutonomousMode, fetchJarvisRuns, fetchJarvisMessages,
  fetchJarvisPendingActions, sendJarvisMessage, cancelJarvisRun, resolveJarvisPendingAction, driveJarvisRun,
} from "@/lib/jarvis";
import type { JarvisRunRow, JarvisMessageRow, JarvisPendingActionRow } from "@/types/jarvis";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizeToolOutput(output: unknown): string {
  if (output === null || output === undefined) return "";
  const text = typeof output === "string" ? output : JSON.stringify(output);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

function MessageBubble({ message }: { message: JarvisMessageRow }) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[75%] rounded-[10px] rounded-br-sm bg-teal/10 border border-teal/20 px-3 py-2 text-sm text-paper">
        {message.content}
      </div>
    );
  }
  if (message.role === "assistant") {
    return (
      <div className="mr-auto max-w-[75%] space-y-1.5">
        {message.content && (
          <div className="rounded-[10px] rounded-bl-sm border border-line bg-ink-200 px-3 py-2 text-sm text-paper">
            {message.content}
          </div>
        )}
        {message.tool_name && (
          <div className="flex items-center gap-1.5 text-2xs text-paper-3">
            <Tag kind="task">{message.tool_name}</Tag>
            <span className="font-mono">calling…</span>
          </div>
        )}
      </div>
    );
  }
  // role === "tool"
  const isError = typeof message.tool_output === "object" && message.tool_output !== null && "error" in (message.tool_output as Record<string, unknown>);
  return (
    <div className="mr-auto max-w-[85%] rounded border border-line bg-ink px-3 py-2 text-2xs">
      <div className="flex items-center gap-1.5">
        <Tag kind={isError ? "anomaly" : "decision"}>{message.tool_name ?? "tool"}</Tag>
        <span className="text-paper-3">{isError ? "failed" : "result"}</span>
      </div>
      <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-paper-3">{summarizeToolOutput(message.tool_output)}</pre>
    </div>
  );
}

function PendingActionCard({
  action, busy, onResolve,
}: {
  action: JarvisPendingActionRow;
  busy: boolean;
  onResolve: (decision: "approved" | "rejected", note?: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="rounded border border-warn/30 bg-warn/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tag kind={action.gate === "floor" ? "anomaly" : "task"}>{action.gate === "floor" ? "real-world action" : "review gate"}</Tag>
        <span className="font-mono text-xs text-paper">{action.tool_name}</span>
      </div>
      <p className="mt-1 text-2xs text-paper-3">{action.reason}</p>
      <pre className="mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap break-words rounded border border-line bg-ink p-2 text-2xs text-paper-3">{JSON.stringify(action.tool_input, null, 2)}</pre>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          aria-label="Note (optional)"
          className="flex-1 rounded border border-line bg-transparent px-2.5 py-1.5 text-xs text-paper placeholder:text-paper-3 focus:border-teal focus:outline-none"
          value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
        />
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => onResolve("approved", note || undefined)}>Approve</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onResolve("rejected", note || undefined)}>Reject</Button>
        </div>
      </div>
    </div>
  );
}

export function MasterAIPanel({ clientId }: { clientId: string }) {
  const [autonomousMode, setAutonomousMode] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [runs, setRuns] = useState<JarvisRunRow[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<JarvisRunRow | null>(null);
  const [messages, setMessages] = useState<JarvisMessageRow[]>([]);
  const [pendingActions, setPendingActions] = useState<JarvisPendingActionRow[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const keepDriving = useRef(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadRuns = useCallback(async () => {
    setRuns(await fetchJarvisRuns(clientId));
  }, [clientId]);

  const loadRunDetail = useCallback(async (runId: string) => {
    const [msgs, pending] = await Promise.all([fetchJarvisMessages(runId), fetchJarvisPendingActions(clientId)]);
    setMessages(msgs);
    setPendingActions(pending.filter((p) => p.run_id === runId));
  }, [clientId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      const [settings, runList] = await Promise.all([fetchJarvisSettings(clientId), fetchJarvisRuns(clientId)]);
      if (!active) return;
      setAutonomousMode(settings?.autonomous_mode === true);
      setRuns(runList);
      const openRun = runList.find((r) => r.status === "running" || r.status === "waiting_human");
      setActiveRunId(openRun?.id ?? null);
      setLoading(false);
    })().catch((e) => { if (active) { setError(errorText(e)); setLoading(false); } });
    return () => { active = false; };
  }, [clientId]);

  useEffect(() => {
    if (!activeRunId) { setMessages([]); setPendingActions([]); setActiveRun(null); return; }
    let active = true;
    (async () => {
      const run = runs.find((r) => r.id === activeRunId) ?? null;
      if (active) setActiveRun(run);
      await loadRunDetail(activeRunId);
    })().catch((e) => { if (active) setError(errorText(e)); });
    return () => { active = false; };
  }, [activeRunId, runs, loadRunDetail]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function toggleAutonomousMode() {
    setSettingsBusy(true);
    setError(null);
    try {
      const next = !autonomousMode;
      await setJarvisAutonomousMode(clientId, next);
      setAutonomousMode(next);
    } catch (e) { setError(errorText(e)); }
    finally { setSettingsBusy(false); }
  }

  async function drive(runId: string) {
    keepDriving.current = true;
    await driveJarvisRun(
      clientId, runId,
      () => { void loadRunDetail(runId); void loadRuns(); },
      () => keepDriving.current,
    );
    await loadRunDetail(runId);
    await loadRuns();
  }

  async function send() {
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setDraft("");
    try {
      const outcome = await sendJarvisMessage({ clientId, runId: activeRunId, message });
      setActiveRunId(outcome.run_id);
      await loadRunDetail(outcome.run_id);
      await loadRuns();
      if (outcome.status === "running") await drive(outcome.run_id);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!activeRunId) return;
    keepDriving.current = false;
    setBusy(true);
    try {
      await cancelJarvisRun(clientId, activeRunId);
      await loadRunDetail(activeRunId);
      await loadRuns();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  async function resolvePending(action: JarvisPendingActionRow, decision: "approved" | "rejected", note?: string) {
    setBusy(true);
    setError(null);
    try {
      await resolveJarvisPendingAction({ clientId, pendingActionId: action.id, decision, note });
      await loadRunDetail(action.run_id);
      await drive(action.run_id);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  function startNewChat() {
    keepDriving.current = false;
    setActiveRunId(null);
    setError(null);
  }

  const isRunOpen = activeRun && (activeRun.status === "running" || activeRun.status === "waiting_human");

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-56 shrink-0 flex-col border-r border-line">
        <div className="shrink-0 p-3">
          <Button size="sm" variant="secondary" className="w-full" onClick={startNewChat}>New chat</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {runs.map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => setActiveRunId(run.id)}
              className={`mb-1 w-full rounded px-2 py-2 text-left text-2xs ${activeRunId === run.id ? "bg-ink-200 text-paper" : "text-paper-3 hover:bg-ink-200"}`}
            >
              <div className="truncate">{run.title}</div>
              <div className="mt-0.5 flex items-center gap-1 text-paper-3">
                <span className={run.status === "waiting_human" ? "text-warn" : run.status === "failed" ? "text-neg" : ""}>{run.status.replaceAll("_", " ")}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-medium text-paper">Master AI</h1>
            <p className="mt-0.5 text-2xs text-paper-3">Acts across this client's pipeline. Real ad spend and real publishing always wait for your confirmation.</p>
          </div>
          <label className="flex items-center gap-2 text-2xs text-paper-2">
            <input type="checkbox" className="accent-teal" checked={autonomousMode} disabled={settingsBusy} onChange={() => void toggleAutonomousMode()} />
            Autonomous mode
          </label>
          {isRunOpen && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancel()}>Cancel</Button>}
        </header>

        {error && <div role="alert" className="shrink-0 border-b border-line bg-neg/5 px-4 py-2 text-xs text-neg">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <EmptyState icon="clock" title="Loading Master AI" body="Loading run history." />
          ) : !activeRunId && messages.length === 0 ? (
            <EmptyState icon="circle" title="Ask Jarvis to do something" body="e.g. “Run Competitor OS”, “Add a manual idea about our new offer”, “Show me what's waiting for review.”" />
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
              {pendingActions.map((action) => (
                <PendingActionCard key={action.id} action={action} busy={busy} onResolve={(decision, note) => void resolvePending(action, decision, note)} />
              ))}
              {activeRun?.status === "failed" && activeRun.failure_message && (
                <div className="rounded border border-neg/30 bg-neg/5 px-3 py-2 text-2xs text-neg">{activeRun.failure_message}</div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-line px-4 py-3">
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
              placeholder="Message Jarvis…"
              rows={2}
              disabled={busy}
              className="flex-1 resize-none rounded-lg border border-line bg-ink-200 px-3 py-2 text-sm text-paper placeholder:text-paper-3 outline-none focus:border-teal/50 disabled:opacity-60"
            />
            <Button variant="primary" disabled={busy || !draft.trim()} onClick={() => void send()}>
              {busy ? "Working…" : "Send"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
