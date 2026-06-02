import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Icon, Kbd } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import { fmtDateLong } from "@/lib/format";
import { NAV_ITEMS, ROUTES } from "@/lib/constants";
import type { PulseMetric } from "@/types";

export function TopBar() {
  const location = useLocation();
  const [vitals, setVitals] = useState<PulseMetric[]>([]);

  useEffect(() => {
    mockApi.pulse.metrics().then((m) => setVitals(m.slice(0, 4)));
  }, []);

  // derive crumb from current path
  const navItem = NAV_ITEMS.find((n) => location.pathname.startsWith(n.path));
  const crumbLabel =
    navItem?.label ?? (location.pathname.startsWith(ROUTES.settings) ? "Settings" : "");
  const crumbIcon = navItem?.icon ?? "settings";

  const today = fmtDateLong(new Date().toISOString());

  return (
    <header className="h-12 border-b border-line flex items-center px-4 gap-4 flex-shrink-0">
      {/* Crumb */}
      <div className="flex items-center gap-2 text-xs text-paper-2">
        <span className="text-paper-3">
          <Icon name={crumbIcon} size={13} />
        </span>
        <b className="text-paper font-medium">{crumbLabel}</b>
        <span className="text-paper-3">/</span>
        <span>{today}</span>
      </div>

      {/* Search */}
      <div className="flex-1 max-w-[460px] ml-2 flex items-center gap-2 bg-ink-200 border border-line rounded-lg px-2.5 py-1.5 text-paper-3 text-xs">
        <Icon name="search" size={13} />
        <span>Search prospects, clients, ads, files…</span>
        <span className="ml-auto">
          <Kbd>⌘K</Kbd>
        </span>
      </div>

      {/* Vitals */}
      <div className="flex ml-auto items-center">
        {vitals.map((v, i) => {
          const isLast = i === vitals.length - 1;
          const deltaColor =
            v.trend === "flat"
              ? "text-paper-3"
              : v.trend_is_good
                ? "text-teal"
                : "text-warn";
          return (
            <div
              key={v.key}
              className={`px-3.5 border-l border-line flex flex-col leading-tight ${isLast ? "border-r" : ""}`}
            >
              <span className="text-[9.5px] uppercase tracking-cap text-paper-3">
                {v.label}
              </span>
              <span className="font-serif text-[15px] text-paper mt-0.5">
                {v.display_value}
              </span>
              <span className={`text-2xs mt-px ${deltaColor}`}>
                {v.delta_display} {v.delta_label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Icon buttons */}
      <div className="flex gap-1 ml-2">
        <button className="w-[30px] h-[30px] grid place-items-center text-paper-2 rounded-md hover:bg-ink-200 hover:text-paper transition-colors relative">
          <Icon name="bell" size={13} />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-teal rounded-full border-2 border-ink" />
        </button>
        <button className="w-[30px] h-[30px] grid place-items-center text-paper-2 rounded-md hover:bg-ink-200 hover:text-paper transition-colors">
          <Icon name="plus" size={13} />
        </button>
      </div>
    </header>
  );
}
