import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState, Panel } from "@/components/primitives";
import { Button } from "@/components/primitives";
import { fetchClients, fetchActivityLog, fetchStage3StatusMap } from "@/lib/api";
import type { Client, ActivityLogEntry } from "@/types/client";
import { ROUTES } from "@/lib/constants";
import { TIER_LABELS as TL } from "@/types/client";
import { fmtRelative } from "@/lib/format";
import { currentExecutionMonth, type Stage3Status } from "@/lib/stage3";
import { ContractorManagerModal } from "@/components/ContractorManagerModal";

function HealthBadge({ score }: { score: number }) {
  const colour =
    score >= 70 ? "text-teal" : score >= 40 ? "text-warn" : "text-neg";
  return <span className={`font-mono text-xs ${colour}`}>{score}</span>;
}

function StageBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    not_run:  "text-paper-3",
    running:  "text-warn",
    complete: "text-teal",
    error:    "text-neg",
  };
  const labels: Record<string, string> = {
    not_run: "—",
    running:  "Running",
    complete: "Done",
    error:    "Error",
  };
  return (
    <span className={`text-2xs font-mono uppercase ${styles[status] ?? "text-paper-3"}`}>
      {labels[status] ?? status}
    </span>
  );
}

export function CockpitPage() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage3Statuses, setStage3Statuses] = useState<Record<string, Stage3Status>>({});
  const [contractorsOpen, setContractorsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    // Clients is essential; activity + stage-3 map are enhancements. allSettled
    // keeps the dashboard rendering if a secondary query drops under load.
    const [clientsResult, activityResult, stage3Result] = await Promise.allSettled([
      fetchClients(), fetchActivityLog({ limit: 8 }), fetchStage3StatusMap(currentExecutionMonth()),
    ]);
    if (clientsResult.status === "fulfilled") setClients(clientsResult.value);
    else setError(clientsResult.reason instanceof Error ? clientsResult.reason.message : String(clientsResult.reason));
    setActivity(activityResult.status === "fulfilled" ? activityResult.value : []);
    setStage3Statuses(stage3Result.status === "fulfilled" ? stage3Result.value : {});
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const reload = () => void load(); window.addEventListener("aa:reload", reload); return () => window.removeEventListener("aa:reload", reload); }, [load]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-paper-3 text-xs">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-neg text-xs">
        {error}
      </div>
    );
  }

  const activeClients  = clients.filter((c) => c.status === "active");
  const stage1Missing  = clients.filter((c) => c.stage1_status === "not_run").length;
  const stage2Missing  = clients.filter((c) => c.stage2_status === "not_run").length;
  const stage3Missing  = clients.filter((c) => (stage3Statuses[c.id] ?? "not_run") === "not_run").length;

  return (
    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
      <div className="flex justify-end"><Button variant="ghost" size="sm" onClick={() => setContractorsOpen(true)}>Manage Contractors</Button></div>
      {/* System Readiness Band */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Total Clients",    value: clients.length,                              sub: `${activeClients.length} active` },
          { label: "Stage 1 Not Run",  value: stage1Missing,                               sub: "need context input" },
          { label: "Stage 2 Not Run",  value: stage2Missing,                               sub: "need monthly pack" },
          { label: "Stage 3 Not Run",  value: stage3Missing,                               sub: "no masters/calendar" },
          { label: "Internal Clients", value: clients.filter((c) => c.is_internal_client).length, sub: "AA-managed" },
        ].map((tile) => (
          <div
            key={tile.label}
            className="bg-ink-200 border border-line rounded-[10px] p-3.5 flex flex-col gap-1"
          >
            <span className="text-2xs uppercase tracking-cap text-paper-3">{tile.label}</span>
            <span className="text-2xl font-mono text-paper">{tile.value}</span>
            <span className="text-2xs text-paper-3">{tile.sub}</span>
          </div>
        ))}
      </div>

      {/* Client Health + Activity */}
      <div className="grid grid-cols-[1fr_360px] gap-4 min-h-0">
        {/* Client list */}
        <Panel title="Clients" meta={`${clients.length} total`}>
          {clients.length === 0 ? (
            <EmptyState
              icon="users"
              title="No clients yet"
              body="Create your first client to get started."
              action={
                <Button variant="primary" size="sm" onClick={() => navigate(ROUTES.clients)}>
                  Go to Clients
                </Button>
              }
            />
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line">
                  {["Name", "Tier", "Stage 1", "Stage 2", "Health"].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-2xs uppercase tracking-cap text-paper-3 font-medium"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => navigate(ROUTES.client(c.id))}
                    className="border-b border-line last:border-b-0 hover:bg-ink-100 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2.5 text-paper font-medium">
                      {c.name}
                      {c.is_internal_client && (
                        <span className="ml-2 text-2xs text-teal font-mono bg-teal/10 rounded px-1">
                          internal
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-paper-2 text-2xs">{TL[c.package_tier]}</td>
                    <td className="px-3 py-2.5"><StageBadge status={c.stage1_status} /></td>
                    <td className="px-3 py-2.5"><StageBadge status={c.stage2_status} /></td>
                    <td className="px-3 py-2.5"><HealthBadge score={c.health_score} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        {/* Recent activity */}
        <Panel title="Recent Activity" meta="last 8">
          {activity.length === 0 ? (
            <EmptyState
              icon="clock"
              title="No activity yet"
              body="System events will appear here."
            />
          ) : (
            <ul>
              {activity.map((entry) => (
                <li
                  key={entry.id}
                  className="px-3 py-2.5 border-b border-line last:border-b-0 flex flex-col gap-0.5"
                >
                  <span className="text-xs text-paper leading-snug">
                    {entry.plain_english_message}
                  </span>
                  <span className="text-2xs text-paper-3 font-mono">
                    {fmtRelative(entry.created_at)}
                    {entry.clients?.name ? ` · ${entry.clients.name}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {contractorsOpen && <ContractorManagerModal onClose={() => setContractorsOpen(false)} />}
    </div>
  );
}
