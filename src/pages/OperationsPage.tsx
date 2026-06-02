import { AutomationList, AgentControlPanel } from "@/components/operations";

export function OperationsPage() {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3.5">
      <AutomationList />
      <AgentControlPanel />
    </div>
  );
}
