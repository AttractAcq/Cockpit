import type { ReactNode } from "react";

/* ─────────────────────────── Card ─────────────────────────── */

interface CardProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  dashed?: boolean;
}

export function Card({ children, onClick, className = "", dashed = false }: CardProps) {
  const borderStyle = dashed ? "border-dashed bg-transparent" : "bg-ink-200";
  return (
    <div
      onClick={onClick}
      className={`rounded-[10px] border border-line p-3 px-3.5 flex flex-col gap-2 transition-colors ${borderStyle} ${
        onClick ? "cursor-pointer hover:border-line-2 hover:bg-ink-50" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────── Panel ─────────────────────────── */

interface PanelProps {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, meta, children, className = "" }: PanelProps) {
  return (
    <div
      className={`bg-ink-200 border border-line rounded-[10px] overflow-hidden ${className}`}
    >
      <div className="px-3 py-2.5 border-b border-line flex items-center justify-between">
        <span className="text-2xs uppercase tracking-wide text-paper-2 font-medium">
          {title}
        </span>
        {meta && <span className="text-xs text-paper-3 font-mono">{meta}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

/* ─────────────────────────── Tag ─────────────────────────── */

export type TagKind = "reply" | "decision" | "approve" | "task" | "anomaly" | "muted";

interface TagProps {
  kind: TagKind;
  children: ReactNode;
}

const tagStyles: Record<TagKind, string> = {
  reply: "bg-teal-dim text-teal",
  decision: "bg-warn-dim text-warn",
  anomaly: "bg-neg-dim text-neg",
  approve: "bg-info-dim text-info",
  task: "bg-ink-100 text-paper-2 border border-line",
  muted: "bg-transparent text-paper-3 border border-dashed border-line-2",
};

export function Tag({ kind, children }: TagProps) {
  return (
    <span
      className={`font-mono text-[9.5px] uppercase tracking-cap px-1.5 py-0.5 rounded-[4px] inline-flex items-center gap-1 ${tagStyles[kind]}`}
    >
      {children}
    </span>
  );
}

/* ─────────────────────────── Tabs ─────────────────────────── */

interface TabsProps {
  tabs: { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="flex border-b border-line -mx-4 px-4">
      {tabs.map((t, i) => {
        const isOn = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`px-3 py-2 text-xs cursor-pointer border-b-2 -mb-px transition-colors ${
              isOn
                ? "text-paper border-teal"
                : "text-paper-3 border-transparent hover:text-paper-2"
            } ${i === 0 ? "pl-0.5" : ""}`}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                className={`font-mono text-2xs ml-1.5 ${isOn ? "text-teal" : "text-paper-3"}`}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── SectionHeader ─────────────────────────── */

interface SectionHeaderProps {
  title: string;
  count?: number;
  meta?: ReactNode;
  actions?: ReactNode;
}

export function SectionHeader({ title, count, meta, actions }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between pb-1.5 border-b border-line">
      <div className="text-2xs uppercase tracking-wide text-paper-2 font-medium flex items-center gap-2">
        {title}
        {count !== undefined && (
          <span className="bg-ink-100 border border-line text-paper px-1.5 py-0.5 rounded-[10px] text-2xs font-mono normal-case tracking-normal">
            {count}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {meta && (
          <span className="text-2xs text-paper-3 font-mono">{meta}</span>
        )}
        {actions}
      </div>
    </div>
  );
}
