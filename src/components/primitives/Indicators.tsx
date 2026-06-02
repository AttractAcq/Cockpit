import type { ReactNode } from "react";
import type { Channel } from "@/types";
import { Icon, type IconName } from "./Icon";

/* ─────────────────────────── Sparkline ─────────────────────────── */

interface SparklineProps {
  values: number[];
  color?: "teal" | "warn" | "neg";
  height?: number;
}

export function Sparkline({ values, color = "teal", height = 18 }: SparklineProps) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);

  const colorMap = {
    teal: "bg-teal",
    warn: "bg-warn",
    neg: "bg-neg",
  };

  return (
    <div className="flex items-end gap-[2px]" style={{ height }}>
      {values.map((v, i) => {
        const pct = Math.max(8, (v / max) * 100);
        const isLast = i === values.length - 1;
        return (
          <div
            key={i}
            className={`flex-1 rounded-[1px] ${colorMap[color]} ${
              isLast ? "opacity-100" : "opacity-45"
            }`}
            style={{ height: `${pct}%` }}
          />
        );
      })}
    </div>
  );
}

/* ─────────────────────────── EmptyState ─────────────────────────── */

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}

export function EmptyState({ icon = "circle", title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4 text-paper-3">
      <div className="w-10 h-10 rounded-full border border-line flex items-center justify-center mb-3">
        <Icon name={icon} size={18} />
      </div>
      <div className="text-sm text-paper">{title}</div>
      {body && <div className="text-xs mt-1 max-w-[280px]">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ─────────────────────────── StatusDot ─────────────────────────── */

interface StatusDotProps {
  status: "live" | "idle" | "warn" | "error" | "paused";
}

export function StatusDot({ status }: StatusDotProps) {
  const map: Record<StatusDotProps["status"], string> = {
    live: "bg-teal shadow-teal-glow",
    idle: "bg-paper-3",
    warn: "bg-warn",
    error: "bg-neg",
    paused: "bg-paper-3 opacity-50",
  };
  return <span className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${map[status]}`} />;
}

/* ─────────────────────────── ChannelBadge ─────────────────────────── */

interface ChannelBadgeProps {
  channel: Channel;
  size?: "sm" | "md";
}

const channelLabel: Record<Channel, string> = {
  instagram: "IG",
  whatsapp: "W",
  email: "@",
  sms: "S",
};

const channelStyle: Record<Channel, string> = {
  instagram: "bg-gradient-to-br from-[#f58529] to-[#dd2a7b] text-paper",
  whatsapp: "bg-[#25d366] text-ink",
  email: "bg-ink-50 border border-line-2 text-paper-2",
  sms: "bg-ink-50 border border-line-2 text-paper-2",
};

export function ChannelBadge({ channel, size = "sm" }: ChannelBadgeProps) {
  const dim = size === "sm" ? "w-[18px] h-[18px] text-[9px]" : "w-6 h-6 text-[11px]";
  return (
    <span
      className={`rounded-[4px] grid place-items-center font-mono flex-shrink-0 ${dim} ${channelStyle[channel]}`}
    >
      {channelLabel[channel]}
    </span>
  );
}

/* ─────────────────────────── Kbd ─────────────────────────── */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[10px] bg-ink-100 border border-line px-1.5 py-px rounded-[3px] text-paper-2 font-normal">
      {children}
    </span>
  );
}

/* ─────────────────────────── Avatar ─────────────────────────── */

interface AvatarProps {
  initials: string;
  size?: "sm" | "md" | "lg";
}

export function Avatar({ initials, size = "md" }: AvatarProps) {
  const dim = {
    sm: "w-6 h-6 text-[10px]",
    md: "w-[30px] h-[30px] text-[11px]",
    lg: "w-9 h-9 text-xs",
  }[size];
  return (
    <div
      className={`rounded-full bg-gradient-to-br from-teal to-[#0a8a7a] grid place-items-center font-semibold text-ink flex-shrink-0 ${dim}`}
    >
      {initials}
    </div>
  );
}
