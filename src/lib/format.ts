import type { ISODate, ZAR } from "@/types";

const zarFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});

const zarCompactFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 1,
  notation: "compact",
});

/** R 4,200 */
export const fmtZAR = (amount: ZAR): string => {
  return zarFormatter.format(amount).replace("ZAR", "R");
};

/** R 4.2k */
export const fmtZARCompact = (amount: ZAR): string => {
  return zarCompactFormatter.format(amount).replace("ZAR", "R");
};

/** 18% */
export const fmtPercent = (v: number, dp = 0): string => {
  return `${v.toFixed(dp)}%`;
};

/** 1.4 (no unit) */
export const fmtNumber = (v: number, dp = 1): string => {
  return v.toLocaleString("en-ZA", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
};

/** "12m", "3h", "2d", "1w" — terse relative-time for operator UI */
export const fmtAgo = (iso: ISODate, now: Date = new Date()): string => {
  const then = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.floor((now.getTime() - then) / 1000));

  if (diffSec < 60) return `${diffSec}s`;
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  const mo = Math.floor(d / 30);
  return `${mo}mo`;
};

/** "in 2h", "in 30m" — for future timestamps (due_at, scheduled, etc) */
export const fmtIn = (iso: ISODate, now: Date = new Date()): string => {
  const then = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.floor((then - now.getTime()) / 1000));
  if (diffSec < 60) return `in <1m`;
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  const d = Math.floor(h / 24);
  return `in ${d}d`;
};

/** "15:00 SAST", "09:14" — short time-of-day */
export const fmtTime = (iso: ISODate): string => {
  return new Date(iso).toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

/** "Thursday · 28 May" */
export const fmtDateLong = (iso: ISODate): string => {
  const d = new Date(iso);
  const weekday = d.toLocaleDateString("en-ZA", { weekday: "long" });
  const date = d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
  return `${weekday} · ${date}`;
};

/** Mask phone: "+27 82 ••• 4421" */
export const fmtPhoneMasked = (phone: string): string => {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return phone;
  return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ••• ${digits.slice(-4)}`;
};

/** Human-readable relative time — "2m ago", "3h ago", "yesterday" */
export const fmtRelative = (iso: string): string => {
  const then = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60)  return "just now";
  const m = Math.floor(diffSec / 60);
  if (m < 60)        return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)        return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1)       return "yesterday";
  if (d < 7)         return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5)         return `${w}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
};

/** "2.4 MB", "640 KB" */
export const fmtBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};
