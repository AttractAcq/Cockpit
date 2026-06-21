import { Outlet } from "react-router-dom";
import { LeftRail } from "./LeftRail";
import { TopBar } from "./TopBar";
import { PipelineStrip } from "./PipelineStrip";
import { CommandBar } from "./CommandBar";

/**
 * The persistent app shell. Every route renders inside this.
 *
 * Layout regions (top → bottom):
 *   - LeftRail   (fixed-width icon nav, always visible)
 *   - TopBar     (crumb + search + vitals + actions)
 *   - PipelineStrip (the always-visible 7-stage flow; hidden on /settings)
 *   - <Outlet />  (the active page)
 *   - CommandBar (system status + keyboard shortcuts)
 */
export function AppShell() {
  return (
    <div className="grid grid-cols-[56px_1fr] h-dvh overflow-hidden bg-ink">
      <LeftRail />
      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-ink">
        <TopBar />
        <PipelineStrip />
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <Outlet />
        </div>
        <CommandBar />
      </main>
    </div>
  );
}
