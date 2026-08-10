// Programme Stage D — Phase 2 executable contract review surface.
//
// Shows the approved Execution Markdown beside the structured values taken
// from it, plus the reconciliation evidence that proves the two agree. The
// operator approves the structured twin here; approval is what makes calendar
// slots operational, so the blocked and disabled states matter as much as the
// happy path.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/primitives";
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
    status === "approved" ? "border-teal/20 bg-teal/10 text-teal"
      : status === "needs_review" ? "border-warn/20 bg-warn/10 text-warn"
      : status === "rejected" ? "border-neg/20 bg-neg/10 text-neg"
      : "border-line bg-ink text-paper-3";
  return <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${tone}`}>{status.replaceAll("_", " ")}</span>;
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
    return <div className="min-h-0 flex-1 overflow-y-auto p-6 text-xs text-paper-3">Loading execution authority…</div>;
  }

  const structured = (selected?.config ?? null) as ExecutionConfig | null;
  const openFile = files.find((f) => f.id === openFileId) ?? null;

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium text-paper">Execution Contract · {executionMonth}</h2>
          <p className="mt-1 max-w-4xl text-xs leading-5 text-paper-3">
            The approved Execution files remain the authority. This is the machine-executable twin
            derived from them, and the evidence that the two do not contradict each other.
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => void onGenerate()}
          disabled={busy || files.length === 0}
          className="shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Working…" : "Generate from approved files"}
        </Button>
      </header>

      {notice && (
        <div
          role="status"
          className={`rounded-md border px-3 py-2 text-xs ${
            notice.kind === "ok"
              ? "border-teal/20 bg-teal/5 text-teal"
              : "border-neg/20 bg-neg/5 text-neg"
          }`}
        >
          {notice.text}
        </div>
      )}

      {files.length === 0 && (
        <div className="rounded-md border border-warn/20 bg-warn/5 px-3 py-3 text-xs text-warn">
          No approved Execution files exist for {executionMonth}. Structured authority is never derived
          from unapproved Markdown, so there is nothing to generate from yet.
        </div>
      )}

      {files.length > 0 && configs.length === 0 && (
        <div className="rounded-md border border-line bg-ink-200 px-3 py-3 text-xs text-paper-2">
          {files.length} approved Execution files are present, but no structured config has been
          generated for {executionMonth} yet.
        </div>
      )}

      {configs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {configs.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedId(c.id)}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                c.id === selectedId
                  ? "border-teal/30 bg-teal/10 text-paper"
                  : "border-line bg-ink-200 text-paper-3 hover:border-line-2 hover:text-paper"
              }`}
            >
              v{c.config_version} <StatusPill status={c.status} />
            </button>
          ))}
        </div>
      )}

      {selected && (
        <>
          <section className="overflow-hidden rounded-[10px] border border-line bg-ink-200">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-ink-100 px-4 py-3">
              <h3 className="text-2xs font-medium uppercase tracking-wide text-paper-2">
                Reconciliation — {selected.reconciliation_status}
              </h3>
              <Button
                variant="primary"
                size="md"
                onClick={() => void onApprove()}
                disabled={busy || !canApprove}
                title={
                  selected.status === "approved" ? "Already approved"
                    : selected.reconciliation_status !== "passed"
                      ? "Blocked: the structured config contradicts the approved Execution files"
                      : undefined
                }
                className="disabled:cursor-not-allowed disabled:opacity-40"
              >
                Approve and make slots operational
              </Button>
            </div>

            {blockingFailures.length > 0 && (
              <p className="border-b border-neg/20 bg-neg/5 px-4 py-2.5 text-xs text-neg">
                {blockingFailures.length} blocking check{blockingFailures.length === 1 ? "" : "s"} failed.
                Approval is refused by the database until the approved files and the structured values agree.
              </p>
            )}

            <ul className="divide-y divide-line">
              {checks.length === 0 && (
                <li className="px-4 py-3 text-xs text-paper-3">No checks recorded.</li>
              )}
              {checks.map((c) => (
                <li key={c.id} className="flex min-w-0 items-start gap-3 px-4 py-3 text-xs">
                  <span
                    className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-mono text-2xs ${
                      c.status === "pass"
                        ? "border-teal/20 bg-teal/10 text-teal"
                        : c.severity === "blocking"
                          ? "border-neg/20 bg-neg/10 text-neg"
                          : "border-warn/20 bg-warn/10 text-warn"
                    }`}
                  >
                    {c.status === "pass" ? "pass" : c.severity}
                  </span>
                  <span className="min-w-0 flex-1 break-words">
                    <span className="font-mono text-2xs text-paper-3">{c.check_code}</span>
                    <span className="mt-0.5 block leading-5 text-paper-2">{c.detail}</span>
                    {c.expected_value !== null && c.actual_value !== null && (
                      <span className="mt-0.5 block font-mono text-2xs text-paper-3">
                        expected {c.expected_value} · actual {c.actual_value}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="min-w-0 overflow-hidden rounded-[10px] border border-line bg-ink-200">
              <div className="border-b border-line bg-ink-100 px-4 py-3">
                <h3 className="text-2xs font-medium uppercase tracking-wide text-paper-2">Approved Execution Markdown</h3>
              </div>
              <div className="flex flex-wrap gap-1 border-b border-line px-4 py-2.5">
                {files.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setOpenFileId(f.id)}
                    className={`rounded-md border px-2 py-1 font-mono text-2xs transition-colors ${
                      f.id === openFileId
                        ? "border-teal/30 bg-teal/10 text-teal"
                        : "border-line bg-ink text-paper-3 hover:text-paper"
                    }`}
                  >
                    E{String(f.file_number).padStart(2, "0")}
                  </button>
                ))}
              </div>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words bg-ink px-4 py-3 font-mono text-xs leading-6 text-paper-2">
                {openFile?.content_md ?? "Select a file."}
              </pre>
            </section>

            <section className="min-w-0 overflow-hidden rounded-[10px] border border-line bg-ink-200">
              <div className="border-b border-line bg-ink-100 px-4 py-3">
                <h3 className="text-2xs font-medium uppercase tracking-wide text-paper-2">Structured values</h3>
              </div>
              <div className="space-y-4 px-4 py-3 text-xs text-paper-2">
                <div>
                  <span className="text-2xs uppercase tracking-wide text-paper-3">Content pillars</span>
                  <p className="mt-1 text-paper-2">
                    {structured?.content_pillars?.join(" · ") ?? "none declared"}
                  </p>
                </div>
                <div className="overflow-x-auto">
                <table className="w-full min-w-[360px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-2xs uppercase tracking-wide text-paper-3">
                      <th className="py-2">Format</th>
                      <th className="py-2">Channel</th>
                      <th className="py-2 text-right">Qty</th>
                      <th className="py-2 text-right">Slots</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(structured?.requirements ?? []).map((r) => {
                      const row = requirements.find(
                        (q) => q.asset_format === r.asset_format && q.channel === r.channel,
                      );
                      const slotCount = row ? slots.filter((s) => s.content_requirement_id === row.id).length : 0;
                      return (
                        <tr key={`${r.platform}/${r.channel}/${r.asset_format}`} className="border-b border-line last:border-b-0">
                          <td className="py-2 text-paper">{r.asset_format}</td>
                          <td className="py-2 text-paper-2">{r.channel}</td>
                          <td className="py-2 text-right font-mono text-paper">{r.quantity}</td>
                          <td className="py-2 text-right font-mono text-paper">
                            {row ? slotCount : <span className="text-paper-3">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
                <p className="text-2xs leading-5 text-paper-3">
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
