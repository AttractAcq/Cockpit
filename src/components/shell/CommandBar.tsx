import { Kbd } from "@/components/primitives";

interface SystemStatus {
  label: string;
  status: "connected" | "idle" | "error";
}

const SYSTEMS: SystemStatus[] = [
  { label: "Supabase · realtime connected", status: "connected" },
  { label: "Meta · 2 ad accounts", status: "connected" },
  { label: "360dialog · WA BSP", status: "connected" },
  { label: "n8n · idle", status: "idle" },
];

export function CommandBar() {
  return (
    <footer className="h-[30px] border-t border-line bg-ink flex items-center px-3.5 gap-3.5 font-mono text-2xs text-paper-3 flex-shrink-0">
      {SYSTEMS.map((s, i) => (
        <div key={s.label} className="flex items-center gap-3.5">
          {i > 0 && <span className="w-px h-3.5 bg-line" />}
          <div className="flex items-center gap-1.5 text-paper-2">
            {s.status === "connected" ? (
              <span className="w-1.5 h-1.5 bg-teal rounded-full shadow-teal-glow animate-pulse-dot" />
            ) : s.status === "idle" ? (
              <span className="w-1.5 h-1.5 bg-paper-3 rounded-full" />
            ) : (
              <span className="w-1.5 h-1.5 bg-neg rounded-full" />
            )}
            <span>{s.label}</span>
          </div>
        </div>
      ))}

      {/* Shortcuts on right */}
      <div className="ml-auto flex gap-3.5">
        <span className="flex items-center gap-1">
          <Kbd>⌘K</Kbd> Command
        </span>
        <span className="flex items-center gap-1">
          <Kbd>R</Kbd> Reply
        </span>
        <span className="flex items-center gap-1">
          <Kbd>E</Kbd> Approve
        </span>
        <span className="flex items-center gap-1">
          <Kbd>S</Kbd> Snooze
        </span>
        <span className="flex items-center gap-1">
          <Kbd>?</Kbd> Shortcuts
        </span>
      </div>
    </footer>
  );
}
