import { useEffect, useState } from "react";
import { Button } from "@/components/primitives";
import { executeDestructive, planDestructive } from "@/lib/api";
import type { DestructiveExecuteResult, DestructivePlan, DestructiveTargetInput } from "@/types/phase";

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function rowLines(map: Record<string, number>): Array<[string, number]> { return Object.entries(map).filter(([, n]) => n > 0); }

/**
 * Reusable destructive-operation modal. Loads a backend dry-run plan, shows the
 * full impact (blockers, storage, rows to delete/update, retained audit rows,
 * snapshots to supersede, version + downstream consequences), requires a typed
 * confirmation + reason, then runs the staged execute and shows the report.
 */
export function DestructiveDialog({ target, title, confirmWord, onClose, onDone }: {
  target: DestructiveTargetInput;
  title: string;
  confirmWord: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [plan, setPlan] = useState<DestructivePlan | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DestructiveExecuteResult | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void planDestructive(target)
      .then(({ operation_id, plan }) => { if (active) { setPlan(plan); setOperationId(operation_id); } })
      .catch((e) => { if (active) setError(errorText(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocked = !!plan && !plan.allowed;
  const canExecute = !!plan && plan.allowed && !!operationId && reason.trim().length > 0 && typed.trim() === confirmWord && !busy && !result;

  async function execute() {
    if (!operationId) return;
    setBusy(true); setError(null);
    try {
      const res = await executeDestructive(operationId, reason.trim());
      setResult(res);
      if (res.status === "complete") onDone?.();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  const field = "rounded border border-line bg-ink px-2.5 py-1.5 text-xs text-paper outline-none focus:border-neg/60";
  return <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 p-2 sm:items-center" onClick={busy ? undefined : onClose}>
    <div role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[16px] border border-neg/30 bg-ink-200 sm:rounded-[16px]" onClick={(e) => e.stopPropagation()}>
      <header className="shrink-0 border-b border-line px-5 py-4"><div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-medium text-neg">{title}</h2><p className="mt-1 text-2xs text-paper-3">Permanent action. Deleting Cockpit records never deletes anything already posted on Instagram/Meta.</p></div><button onClick={onClose} className="text-paper-3 hover:text-paper">✕</button></div></header>
      {error && <div role="alert" className="shrink-0 border-b border-neg/20 bg-neg/5 px-5 py-2 text-xs text-neg">{error}</div>}
      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        {loading ? <div className="py-8 text-center text-xs text-paper-3">Building dry-run impact…</div> : !plan ? <div className="text-xs text-neg">No plan available.</div> : <>
          <div className="text-sm text-paper">{plan.summary}</div>
          {plan.blockers.length > 0 && <div className="mt-3 rounded-lg border border-neg/30 bg-neg/5 p-3 text-xs text-neg"><div className="font-medium">Blocked — cannot proceed:</div><ul className="mt-1 list-disc pl-5 space-y-1">{plan.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></div>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 text-2xs">
            {rowLines(plan.rows_to_delete).length > 0 && <div className="rounded border border-line bg-ink p-2.5"><div className="uppercase text-paper-3">Rows to delete</div><ul className="mt-1 space-y-0.5">{rowLines(plan.rows_to_delete).map(([t, n]) => <li key={t} className="text-neg">{t}: {n}</li>)}</ul></div>}
            {rowLines(plan.rows_to_update).length > 0 && <div className="rounded border border-line bg-ink p-2.5"><div className="uppercase text-paper-3">Rows to update</div><ul className="mt-1 space-y-0.5">{rowLines(plan.rows_to_update).map(([t, n]) => <li key={t} className="text-warn">{t}: {n}</li>)}</ul></div>}
            {rowLines(plan.supersede).length > 0 && <div className="rounded border border-line bg-ink p-2.5"><div className="uppercase text-paper-3">Snapshots superseded (kept)</div><ul className="mt-1 space-y-0.5">{rowLines(plan.supersede).map(([t, n]) => <li key={t} className="text-paper-2">{t}: {n}</li>)}</ul></div>}
            <div className="rounded border border-line bg-ink p-2.5"><div className="uppercase text-paper-3">Storage objects</div><div className="mt-1 text-paper-2">{plan.storage_objects.length} file(s) to delete</div></div>
          </div>
          {plan.version_consequences.length > 0 && <div className="mt-3 text-2xs text-paper-3"><span className="uppercase">Version:</span> {plan.version_consequences.join(" ")}</div>}
          {plan.downstream_consequences.length > 0 && <div className="mt-1 text-2xs text-paper-3"><span className="uppercase">Downstream:</span> {plan.downstream_consequences.join(" ")}</div>}
          {plan.retain.length > 0 && <div className="mt-1 text-2xs text-paper-3"><span className="uppercase">Retained (audit):</span> {plan.retain.join(" ")}</div>}

          {result && <div className={`mt-4 rounded-lg border p-3 text-xs ${result.status === "complete" ? "border-teal/30 bg-teal/5 text-teal" : "border-neg/30 bg-neg/5 text-neg"}`}><div className="font-medium">Operation {result.status}{result.recovery_required ? " · recovery required" : ""}.</div>{result.blockers?.length ? <ul className="mt-1 list-disc pl-5">{result.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul> : null}{result.result ? <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words text-2xs text-paper-2">{JSON.stringify(result.result, null, 2)}</pre> : null}</div>}

          {!blocked && !result && <div className="mt-4 space-y-3">
            <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Reason (required)</span><textarea className={`${field} min-h-16`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being deleted/rejected?" /></label>
            <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Type <span className="font-mono text-neg">{confirmWord}</span> to confirm</span><input className={field} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={confirmWord} /></label>
          </div>}
        </>}
      </main>
      <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3">
        <span className="text-2xs text-paper-3">{result ? "Done." : blocked ? "This action is blocked." : "Real, permanent deletion. Confirm to proceed."}</span>
        {result ? <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>Close</Button> : <>
          <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="danger" disabled={!canExecute} onClick={() => void execute()}>{busy ? "Working…" : "Confirm delete"}</Button>
        </>}
      </footer>
    </div>
  </div>;
}
