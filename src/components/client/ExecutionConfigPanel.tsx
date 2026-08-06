// Programme Stage D — Phase 2 executable contract review surface.
//
// Shows the approved Execution Markdown beside the structured values taken
// from it, plus the reconciliation evidence that proves the two agree. The
// operator approves the structured twin here; approval is what makes calendar
// slots operational, so the blocked and disabled states matter as much as the
// happy path.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  approveExecutionConfig,
  generateExecutionConfig,
  listApprovedExecutionFiles,
  listDerivedRequirements,
  listExecutionConfigChecks,
  listExecutionConfigs,
  listSlotsForRequirements,
  type DerivedRequirementRow,
  type DerivedSlotRow,
  type ExecutionConfigCheckRow,
  type ExecutionMarkdownFile,
} from "@/lib/execution-config";
import type { ClientExecutionConfigRow, ExecutionConfig } from "@/types/execution-config";

interface Props {
  clientId: string;
  executionMonth: string;
}

type Notice = { kind: "ok" | "error"; text: string } | null;

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "approved" ? "bg-emerald-100 text-emerald-800"
      : status === "needs_review" ? "bg-amber-100 text-amber-900"
      : status === "superseded" ? "bg-slate-200 text-slate-600"
      : status === "rejected" ? "bg-rose-100 text-rose-800"
      : "bg-slate-100 text-slate-700";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>{status}</span>;
}

export function ExecutionConfigPanel({ clientId, executionMonth }: Props) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const [configs, setConfigs] = useState<ClientExecutionConfigRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checks, setChecks] = useState<ExecutionConfigCheckRow[]>([]);
  const [requirements, setRequirements] = useState<DerivedRequirementRow[]>([]);
  const [slots, setSlots] = useState<DerivedSlotRow[]>([]);
  const [files, setFiles] = useState<ExecutionMarkdownFile[]>([]);
  const [openFileId, setOpenFileId] = useState<string | null>(null);

  const selected = useMemo(
    () => configs.find((c) => c.id === selectedId) ?? null,
    [configs, selectedId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [configRows, fileRows] = await Promise.all([
        listExecutionConfigs(clientId, executionMonth),
        listApprovedExecutionFiles(clientId, executionMonth),
      ]);
      setConfigs(configRows);
      setFiles(fileRows);
      setOpenFileId((current) => current ?? fileRows[0]?.id ?? null);
      setSelectedId((current) =>
        current && configRows.some((c) => c.id === current) ? current : configRows[0]?.id ?? null);
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, [clientId, executionMonth]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setChecks([]); setRequirements([]); setSlots([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [checkRows, reqRows] = await Promise.all([
          listExecutionConfigChecks(selectedId),
          listDerivedRequirements(selectedId),
        ]);
        if (cancelled) return;
        setChecks(checkRows);
        setRequirements(reqRows);
        const slotRows = await listSlotsForRequirements(reqRows.map((r) => r.id));
        if (!cancelled) setSlots(slotRows);
      } catch (e) {
        if (!cancelled) setNotice({ kind: "error", text: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  const blockingFailures = checks.filter((c) => c.status === "fail" && c.severity === "blocking");
  const canApprove =
    selected !== null &&
    selected.status !== "approved" &&
    selected.status !== "superseded" &&
    selected.status !== "rejected" &&
    selected.reconciliation_status === "passed";

  async function onGenerate() {
    setBusy(true); setNotice(null);
    try {
      const result = await generateExecutionConfig(clientId, executionMonth);
      setNotice({
        kind: "ok",
        text: result.unchanged
          ? "Authority is unchanged — the existing config still represents it."
          : `Generated version ${result.config_version}: ${result.requirement_count} requirements, ${result.total_quantity} planned outputs.`,
      });
      await load();
      setSelectedId(result.execution_config_id);
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onApprove() {
    if (!selected) return;
    setBusy(true); setNotice(null);
    try {
      const result = await approveExecutionConfig(selected.id);
      setNotice({
        kind: "ok",
        text: result.already_approved
          ? "This config was already approved."
          : `Approved. ${result.requirements_derived} requirements and ${result.slots_written} slots are now operational.`,
      });
      await load();
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Loading execution authority…</div>;
  }

  const structured = (selected?.config ?? null) as ExecutionConfig | null;
  const openFile = files.find((f) => f.id === openFileId) ?? null;

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Execution Contract — {executionMonth}</h2>
          <p className="text-sm text-slate-600">
            The approved Execution files remain the authority. This is the machine-executable twin
            derived from them, and the evidence that the two do not contradict each other.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onGenerate()}
          disabled={busy || files.length === 0}
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy ? "Working…" : "Generate from approved files"}
        </button>
      </header>

      {notice && (
        <div
          role="status"
          className={`rounded border px-3 py-2 text-sm ${
            notice.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
        >
          {notice.text}
        </div>
      )}

      {files.length === 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          No approved Execution files exist for {executionMonth}. Structured authority is never derived
          from unapproved Markdown, so there is nothing to generate from yet.
        </div>
      )}

      {files.length > 0 && configs.length === 0 && (
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
          {files.length} approved Execution files are present, but no structured config has been
          generated for {executionMonth} yet.
        </div>
      )}

      {configs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {configs.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedId(c.id)}
              className={`rounded border px-3 py-1.5 text-sm ${
                c.id === selectedId ? "border-slate-900 bg-white font-medium" : "border-slate-200 bg-slate-50"
              }`}
            >
              v{c.config_version} <StatusPill status={c.status} />
            </button>
          ))}
        </div>
      )}

      {selected && (
        <>
          <section className="rounded border border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <h3 className="text-sm font-semibold text-slate-800">
                Reconciliation — {selected.reconciliation_status}
              </h3>
              <button
                type="button"
                onClick={() => void onApprove()}
                disabled={busy || !canApprove}
                title={
                  selected.status === "approved" ? "Already approved"
                    : selected.reconciliation_status !== "passed"
                      ? "Blocked: the structured config contradicts the approved Execution files"
                      : undefined
                }
                className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Approve and make slots operational
              </button>
            </div>

            {blockingFailures.length > 0 && (
              <p className="border-b border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
                {blockingFailures.length} blocking check{blockingFailures.length === 1 ? "" : "s"} failed.
                Approval is refused by the database until the approved files and the structured values agree.
              </p>
            )}

            <ul className="divide-y divide-slate-100">
              {checks.length === 0 && (
                <li className="px-3 py-2 text-sm text-slate-500">No checks recorded.</li>
              )}
              {checks.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                  <span
                    className={`mt-0.5 rounded px-1.5 py-0.5 text-xs font-medium ${
                      c.status === "pass"
                        ? "bg-emerald-100 text-emerald-800"
                        : c.severity === "blocking"
                          ? "bg-rose-100 text-rose-800"
                          : "bg-amber-100 text-amber-900"
                    }`}
                  >
                    {c.status === "pass" ? "pass" : c.severity}
                  </span>
                  <span className="flex-1">
                    <span className="font-mono text-xs text-slate-500">{c.check_code}</span>
                    <span className="block text-slate-800">{c.detail}</span>
                    {c.expected_value !== null && c.actual_value !== null && (
                      <span className="block text-xs text-slate-500">
                        expected {c.expected_value} · actual {c.actual_value}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
                <h3 className="text-sm font-semibold text-slate-800">Approved Execution Markdown</h3>
              </div>
              <div className="flex flex-wrap gap-1 border-b border-slate-100 px-3 py-2">
                {files.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setOpenFileId(f.id)}
                    className={`rounded px-2 py-1 text-xs ${
                      f.id === openFileId ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    E{String(f.file_number).padStart(2, "0")}
                  </button>
                ))}
              </div>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap px-3 py-2 text-xs text-slate-800">
                {openFile?.content_md ?? "Select a file."}
              </pre>
            </section>

            <section className="rounded border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
                <h3 className="text-sm font-semibold text-slate-800">Structured values</h3>
              </div>
              <div className="space-y-3 px-3 py-2 text-sm">
                <div>
                  <span className="text-xs uppercase tracking-wide text-slate-500">Content pillars</span>
                  <p className="text-slate-800">
                    {structured?.content_pillars?.join(" · ") ?? "none declared"}
                  </p>
                </div>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-1">Format</th>
                      <th className="py-1">Channel</th>
                      <th className="py-1 text-right">Qty</th>
                      <th className="py-1 text-right">Slots</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(structured?.requirements ?? []).map((r) => {
                      const row = requirements.find(
                        (q) => q.asset_format === r.asset_format && q.channel === r.channel,
                      );
                      const slotCount = row ? slots.filter((s) => s.content_requirement_id === row.id).length : 0;
                      return (
                        <tr key={`${r.platform}/${r.channel}/${r.asset_format}`} className="border-b border-slate-100">
                          <td className="py-1">{r.asset_format}</td>
                          <td className="py-1">{r.channel}</td>
                          <td className="py-1 text-right">{r.quantity}</td>
                          <td className="py-1 text-right">
                            {row ? slotCount : <span className="text-slate-400">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-xs text-slate-500">
                  {requirements.length === 0
                    ? "Requirements and slots are derived on approval. Nothing is operational yet."
                    : `${requirements.length} requirements · ${slots.length} slots · ${
                        slots.filter((s) => s.is_operational).length
                      } operational`}
                </p>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
