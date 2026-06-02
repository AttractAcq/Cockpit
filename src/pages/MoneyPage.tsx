import { KPIGrid, RevenueChart, ClientBreakdown } from "@/components/money";

export function MoneyPage() {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3.5">
      <KPIGrid />
      <div className="grid grid-cols-[1fr_1fr] gap-3.5">
        <RevenueChart />
        <ClientBreakdown />
      </div>
    </div>
  );
}
