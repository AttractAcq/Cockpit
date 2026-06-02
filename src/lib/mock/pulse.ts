import type { PulseMetric } from "@/types";

/**
 * Top-line vital signs. Shown in:
 * - TopBar (4 metrics inline)
 * - Cockpit Pulse panel (same 4 + sparkline + delta)
 * - Money page (deeper breakdown)
 */

export const PULSE_METRICS: PulseMetric[] = [
  {
    key: "mrr",
    label: "MRR",
    value: 4200,
    display_value: "R 4,200",
    delta_value: 1200,
    delta_display: "+R1,200",
    delta_label: "mo",
    trend: "up",
    trend_is_good: true,
    sparkline: [1200, 1200, 1600, 2200, 2200, 2800, 4200],
  },
  {
    key: "pipeline",
    label: "Pipeline",
    value: 34500,
    display_value: "R 34.5k",
    delta_value: 8000,
    delta_display: "+R 8k",
    delta_label: "wk",
    trend: "up",
    trend_is_good: true,
    sparkline: [22000, 24500, 23000, 26000, 28500, 30000, 34500],
  },
  {
    key: "spend_mtd",
    label: "Spend MTD",
    value: 640,
    display_value: "R 640",
    delta_value: -120,
    delta_display: "-R 120",
    delta_label: "vs plan",
    trend: "down",
    trend_is_good: true,
    sparkline: [120, 200, 280, 360, 440, 540, 640],
  },
  {
    key: "reply_rate",
    label: "Reply rate",
    value: 18,
    display_value: "18%",
    delta_value: 4,
    delta_display: "+4pp",
    delta_label: "n=58",
    trend: "up",
    trend_is_good: true,
    sparkline: [12, 10, 11, 13, 14, 16, 18],
  },
  {
    key: "cpa_blended",
    label: "CPA blended",
    value: 178,
    display_value: "R 178",
    delta_value: 24,
    delta_display: "+R 24",
    delta_label: "wk",
    trend: "up",
    trend_is_good: false,
    sparkline: [148, 152, 158, 164, 170, 174, 178],
  },
];

export const pulseApi = {
  async metrics(): Promise<PulseMetric[]> {
    return PULSE_METRICS;
  },
  async byKey(key: string): Promise<PulseMetric | null> {
    return PULSE_METRICS.find((m) => m.key === key) ?? null;
  },
};
