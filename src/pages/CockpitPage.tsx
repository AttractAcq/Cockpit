import {
  TriageQueue,
  InFlightPanel,
  InboxPanel,
  PulsePanel,
  AgentTrailPanel,
} from "@/components/cockpit";

export function CockpitPage() {
  return (
    <div className="flex-1 min-h-0 overflow-hidden grid grid-cols-[1fr_360px]">
      {/* Left: triage queue */}
      <div className="overflow-y-auto px-4 py-3 flex flex-col gap-3.5 border-r border-line">
        <TriageQueue />
      </div>

      {/* Right: live system state */}
      <div className="overflow-y-auto px-4 py-3 flex flex-col gap-3.5 bg-ink-200/40">
        <InFlightPanel />
        <InboxPanel />
        <PulsePanel />
        <AgentTrailPanel />
      </div>
    </div>
  );
}
