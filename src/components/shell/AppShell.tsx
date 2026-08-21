import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { LeftRail } from "./LeftRail";
import { TopBar } from "./TopBar";

// Route pages are lazy-loaded (see App.tsx) so the shell itself (LeftRail /
// TopBar) never suspends — only this content area shows the fallback while
// a page's own chunk loads, keeping nav visible across every transition.
const routeFallback = (
  <div className="flex flex-1 items-center justify-center text-paper-2 text-sm">Loading…</div>
);

export function AppShell() {
  return (
    <div className="grid grid-cols-[56px_1fr] h-dvh overflow-hidden bg-ink">
      <LeftRail />
      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-ink">
        <TopBar />
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <Suspense fallback={routeFallback}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
