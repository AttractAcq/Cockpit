import { useState, type ReactNode } from "react";
import { Button } from "@/components/primitives";
import type { LifecycleDateGroup } from "@/lib/lifecycle-date";

export function LifecycleDateSection<T>({
  group,
  statusSummary,
  children,
  defaultCollapsed = false,
}: {
  group: LifecycleDateGroup<T>;
  statusSummary?: ReactNode;
  children: ReactNode;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
          className="flex min-w-0 items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-ink-200 focus:outline-none focus:ring-1 focus:ring-teal/50"
        >
          <span className="text-2xs text-paper-3">{collapsed ? "▶" : "▼"}</span>
          <span className="text-sm font-medium text-paper">{group.label}</span>
          {group.weekday && <span className="text-xs text-paper-3">{group.weekday}</span>}
        </button>
        <span className="font-mono text-xs text-paper-3">{group.records.length} item{group.records.length === 1 ? "" : "s"}</span>
        {statusSummary && <span className="text-2xs text-paper-3">{statusSummary}</span>}
      </div>
      {!collapsed && children}
    </section>
  );
}

export function LifecycleDirectionToggle({
  value,
  onChange,
}: {
  value: "asc" | "desc";
  onChange: (value: "asc" | "desc") => void;
}) {
  return (
    <div className="flex rounded-md border border-line bg-ink p-0.5">
      <Button size="sm" variant={value === "asc" ? "secondary" : "ghost"} onClick={() => onChange("asc")}>Oldest first</Button>
      <Button size="sm" variant={value === "desc" ? "secondary" : "ghost"} onClick={() => onChange("desc")}>Newest first</Button>
    </div>
  );
}
