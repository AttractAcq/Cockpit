import { Outlet } from "react-router-dom";
import { LeftRail } from "./LeftRail";
import { TopBar } from "./TopBar";

export function AppShell() {
  return (
    <div className="grid grid-cols-[56px_1fr] h-dvh overflow-hidden bg-ink">
      <LeftRail />
      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-ink">
        <TopBar />
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
