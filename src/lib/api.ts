// src/lib/api.ts
// LIVE data layer mapped to the real AA-OS Supabase schema.
// Pipeline spine (8 stages): source · cold · contacted · engaged · booked · onboarding · active · delivering
//
// Schema-mapping notes (real DB col → frontend field):
//   agent_events : agent→agent_name, event_type→action, payload→description
//   triage_items : priority(text)→priority(number), title→who, detail→body
//   conversations: missing denorm fields → safe defaults
//   assets       : storage_path→file_name, metadata fields → defaults
//   messages     : sender→sender_name + defaults for absent cols
//   campaigns    : daily_budget_cents/100→budget_daily + spend/perf defaults
//   automations  : status/last_run_at → Automation shape
import { supabase, invokeFn } from "./supabase";
import type { PulseMetric } from "@/types";

// Helper: normalise entity_name from Supabase FK join
function entityName(row: Record<string, unknown>): string | null {
  const ent = row.entities as { business_name?: string } | null;
  return ent?.business_name ?? (row.entity_name as string | null) ?? null;
}

// Map text priority ('high'/'normal'/'low') → number so components can compare
function priorityNum(p: string | null | undefined): number {
  if (p === "high") return 90;
  if (p === "normal") return 50;
  if (p === "low") return 20;
  // Legacy: already a number baked in as string
  const n = parseInt(String(p ?? ""), 10);
  return isNaN(n) ? 50 : n;
}

function metric(
  key: string,
  label: string,
  value: number,
  displayValue: string,
  trendIsGood = true,
): PulseMetric {
  return {
    key,
    label,
    value,
    display_value: displayValue,
    delta_value: 0,
    delta_display: "live",
    delta_label: "now",
    trend: "flat",
    trend_is_good: trendIsGood,
    sparkline: [value],
  };
}

export const api = {
  // ── TRIAGE ──────────────────────────────────────────────────────────────
  triage: {
    async list() {
      const { data, error } = await supabase
        .from("triage_items")
        .select("*, entities(business_name, stage, niche)")
        .eq("status", "open")
        .order("created_at", { ascending: false });
      if (error) { console.error("[api] triage.list:", error.message); throw error; }
      return (data ?? []).map((row) => ({
        // map real DB cols → TriageItem shape the components expect
        id: row.id,
        kind: "task" as const,
        status: row.status ?? "open",
        who: row.title ?? "Triage item",
        who_subtitle: (row.source as string | null) ?? null,
        body: row.detail ?? row.title ?? "",
        body_meta: null,
        entity_id: row.entity_id ?? null,
        entity_name: entityName(row as Record<string, unknown>),
        related_resource_kind: null,
        related_resource_id: null,
        actions: [{ id: "view", label: "View", primary: true, destructive: false }],
        agent_note: null,
        agent_score: null,
        auto_flagged: false,
        priority: priorityNum(row.priority as string | null),
        created_at: row.created_at as string,
        due_at: null,
      }));
    },
    async resolve(id: string) {
      const { error } = await supabase
        .from("triage_items")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", id);
      if (error) { console.error("[api] triage.resolve:", error.message); throw error; }
    },
  },

  // ── ENTITIES (clients + prospects) ──────────────────────────────────────
  clients: {
    async list() {
      const { data, error } = await supabase
        .from("entities").select("*").eq("kind", "client")
        .order("created_at", { ascending: false });
      if (error) { console.error("[api] clients.list:", error.message); throw error; }
      return data ?? [];
    },
    async byId(id: string) {
      const { data, error } = await supabase
        .from("entities").select("*").eq("id", id).single();
      if (error) { console.error("[api] clients.byId:", error.message); throw error; }
      return data;
    },
    async stageCounts() {
      const { data, error } = await supabase.from("entities").select("stage");
      if (error) { console.error("[api] clients.stageCounts:", error.message); throw error; }
      const counts: Record<string, number> = {};
      for (const row of data ?? []) { counts[row.stage] = (counts[row.stage] ?? 0) + 1; }
      return counts;
    },
  },
  prospects: {
    async list() {
      const { data, error } = await supabase
        .from("entities").select("*").eq("kind", "prospect")
        .order("icp_fit_score", { ascending: false, nullsFirst: false });
      if (error) { console.error("[api] prospects.list:", error.message); throw error; }
      return data ?? [];
    },
  },
  entities: {
    async list() {
      const { data, error } = await supabase
        .from("entities").select("*").order("created_at", { ascending: false });
      if (error) { console.error("[api] entities.list:", error.message); throw error; }
      return data ?? [];
    },
    async byStage() {
      const { data, error } = await supabase
        .from("entities")
        .select("id, business_name, kind, stage, niche, city, icp_fit_score, contact_name, contact_phone, contact_email, created_at, updated_at, notes");
      if (error) { console.error("[api] entities.byStage:", error.message); throw error; }
      // Map DB cols to Entity shape; add nullable fields absent from byStage select
      return (data ?? []).map((row) => ({
        ...row,
        email: row.contact_email ?? null,
        whatsapp_number: row.contact_phone ?? null,
        instagram_handle: null,
        website: null,
        tier: null,
        agent_score: null,
        last_channel: null,
        last_message_preview: null,
        last_contact_at: null,
      }));
    },
    async advanceStage(id: string, stage: string) {
      const { error } = await supabase.from("entities").update({ stage }).eq("id", id);
      if (error) { console.error("[api] entities.advanceStage:", error.message); throw error; }
    },
    async update(id: string, patch: Record<string, unknown>) {
      const { data, error } = await supabase
        .from("entities")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) { console.error("[api] entities.update:", error.message); throw error; }
      return data;
    },
  },

  // ── CONVERSATIONS / INBOX ────────────────────────────────────────────────
  conversations: {
    async list() {
      const { data, error } = await supabase
        .from("conversations")
        .select("*, entities(business_name)")
        .order("updated_at", { ascending: false });
      if (error) { console.error("[api] conversations.list:", error.message); throw error; }
      return (data ?? []).map((row) => ({
        ...row,
        entity_name: entityName(row as Record<string, unknown>),
        // DB does not store denorm inbox fields — provide safe defaults
        unread_count: 0,
        last_message_at: row.updated_at as string,
        last_message_preview: row.subject ?? `${row.channel} thread`,
        last_message_from: "them" as const,
        is_pinned: false,
      }));
    },
    async byId(id: string) {
      const { data, error } = await supabase
        .from("conversations")
        .select("*, entities(business_name)")
        .eq("id", id).single();
      if (error) { console.error("[api] conversations.byId:", error.message); throw error; }
      if (!data) return null;
      return {
        ...data,
        entity_name: entityName(data as Record<string, unknown>),
        unread_count: 0,
        last_message_at: data.updated_at as string,
        last_message_preview: (data.subject as string | null) ?? "",
        last_message_from: "them" as const,
        is_pinned: false,
      };
    },
    async messages(conversationId: string) {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("sent_at", { ascending: true });
      if (error) { console.error("[api] conversations.messages:", error.message); throw error; }
      // Map DB cols to Message shape: sender→sender_name + defaults
      return (data ?? []).map((row) => ({
        ...row,
        sender_name: (row.sender as string | null) ?? "Unknown",
        channel: "whatsapp" as const, // fallback; real channel is on conversations row
        sent_by: "human" as const,
        agent_run_id: null,
        delivered_at: null,
        read_at: null,
        attachments: row.media_url ? [{ name: "attachment", url: row.media_url as string, size_bytes: 0 }] : [],
      }));
    },
    async send(args: { entity_id: string; conversation_id?: string; to: string; body: string; client_slug?: string }) {
      return invokeFn("dialog360-send", { ...args, approved: true });
    },
  },

  // ── CAMPAIGNS ───────────────────────────────────────────────────────────
  campaigns: {
    async list() {
      const { data, error } = await supabase
        .from("campaigns").select("*, entities(business_name)")
        .order("created_at", { ascending: false });
      if (error) { console.error("[api] campaigns.list:", error.message); throw error; }
      return (data ?? []).map((row) => ({
        ...row,
        entity_name: entityName(row as Record<string, unknown>),
        meta_campaign_id: (row.external_id as string | null) ?? null,
        // DB uses daily_budget_cents (bigint); Campaign type uses budget_daily (ZAR)
        budget_daily: ((row.daily_budget_cents as number | null) ?? 0) / 100,
        // Performance fields not stored in DB — default to 0
        spend_total: 0, spend_today: 0, impressions: 0, clicks: 0,
        ctr: 0, leads: 0, cpa: null, cpc: null, cpl: null,
        spend_trend_7d: [], cpa_trend_7d: [],
        creative_count: 0, flagged_at: null, flag_reason: null,
      }));
    },
    async byId(id: string) {
      const { data, error } = await supabase
        .from("campaigns").select("*, ad_metrics(*), entities(business_name)").eq("id", id).single();
      if (error) { console.error("[api] campaigns.byId:", error.message); throw error; }
      if (!data) return null;
      return {
        ...data,
        entity_name: entityName(data as Record<string, unknown>),
        meta_campaign_id: (data.external_id as string | null) ?? null,
        budget_daily: ((data.daily_budget_cents as number | null) ?? 0) / 100,
        spend_total: 0, spend_today: 0, impressions: 0, clicks: 0,
        ctr: 0, leads: 0, cpa: null, cpc: null, cpl: null,
        spend_trend_7d: [], cpa_trend_7d: [],
        creative_count: 0, flagged_at: null, flag_reason: null,
      };
    },
    async create(args: { entity_id: string; client_slug?: string; params: Record<string, unknown> }) {
      return invokeFn("meta-ad-ops", { action: "create_campaign", ...args });
    },
    async pause(args: { entity_id: string; campaign_id: string }) {
      return invokeFn("meta-ad-ops", { action: "pause", ...args });
    },
  },

  // ── STUDIO (assets + briefs) ─────────────────────────────────────────────
  assets: {
    async list() {
      const { data, error } = await supabase
        .from("assets").select("*, entities(business_name)")
        .order("created_at", { ascending: false });
      if (error) { console.error("[api] assets.list:", error.message); throw error; }
      return (data ?? []).map((row) => {
        const meta = (row.metadata as Record<string, unknown> | null) ?? {};
        return {
          ...row,
          entity_name: entityName(row as Record<string, unknown>),
          description: (meta.description as string | null) ?? null,
          // DB stores path; frontend wants filename and file metadata
          file_name: (row.storage_path as string | null)?.split("/").pop() ?? "",
          file_size_bytes: (meta.file_size_bytes as number | null) ?? 0,
          file_type: (meta.file_type as string | null) ?? "application/octet-stream",
          thumbnail_url: (meta.thumbnail_url as string | null) ?? null,
          generated_by: (meta.generated_by as string | null) ?? "human",
          agent_name: (meta.agent_name as string | null) ?? null,
          tags: (meta.tags as string[] | null) ?? [],
        };
      });
    },
    async approve(id: string) {
      const { error } = await supabase.from("assets").update({ status: "approved" }).eq("id", id);
      if (error) { console.error("[api] assets.approve:", error.message); throw error; }
    },
    async reject(id: string) {
      const { error } = await supabase.from("assets").update({ status: "draft" }).eq("id", id);
      if (error) { console.error("[api] assets.reject:", error.message); throw error; }
    },
  },
  get studio() { return this.assets; },

  briefs: {
    async list() {
      const { data, error } = await supabase
        .from("briefs").select("*, entities(business_name)")
        .order("created_at", { ascending: false });
      if (error) { console.error("[api] briefs.list:", error.message); throw error; }
      return (data ?? []).map((row) => ({
        ...row,
        entity_name: entityName(row as Record<string, unknown>),
      }));
    },
    async generate(args: { entity_id: string; topic?: string; ref_code?: string }) {
      return invokeFn("brief-generator", args);
    },
  },
  mjr: {
    async generate(args: { entity_id: string }) {
      return invokeFn("mjr-generate", args);
    },
  },

  // ── OPERATIONS ──────────────────────────────────────────────────────────
  operations: {
    async automations() {
      const { data, error } = await supabase
        .from("automations").select("*, entities(business_name)")
        .order("created_at", { ascending: false });
      if (error) { console.error("[api] operations.automations:", error.message); throw error; }
      // Map real DB Automation shape → frontend Automation type
      return (data ?? []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        kind: (row.trigger_type as string | null) ?? "scheduler",
        status: (row.status as string) === "active" ? "live" : (row.status as string),
        status_pill: row.status as string | null,
        detail: `${row.platform} · ${row.trigger_type ?? "scheduled"}`,
        primary_stat_label: "runs",
        primary_stat_value: "—",
        secondary_stats: row.last_run_at ? `last run ${new Date(row.last_run_at as string).toLocaleDateString()}` : "never run",
        resource_kind: null,
        resource_id: (row.external_id as string | null) ?? null,
        started_at: row.created_at as string,
        last_action_at: (row.last_run_at as string | null) ?? (row.updated_at as string),
      }));
    },
    async runScrape() {
      return invokeFn("apify-scrape", {});
    },
    async agentEvents(limit = 100) {
      return api.agentEvents.list(limit);
    },
  },

  agentEvents: {
    async list(limit = 100) {
      const { data, error } = await supabase
        .from("agent_events").select("*, entities(business_name)")
        .order("created_at", { ascending: false }).limit(limit);
      if (error) { console.error("[api] agentEvents.list:", error.message); throw error; }
      // Map DB cols: agent→agent_name, event_type→action, payload→description
      return (data ?? []).map((row) => {
        const payload = (row.payload as Record<string, unknown> | null) ?? {};
        return {
          id: row.id as string,
          action: ((row.event_type as string) ?? "logged") as import("@/types").AgentAction,
          description: (payload.description as string | null)
            ?? (payload.message as string | null)
            ?? (row.event_type as string | null)
            ?? "",
          agent_name: (row.agent as string) ?? "System",
          status: ((row.status as string) === "logged" ? "success" : (row.status as string)) as "success" | "needs_review" | "failed",
          entity_id: (row.entity_id as string | null) ?? null,
          entity_name: entityName(row as Record<string, unknown>),
          resource_kind: null,
          resource_id: null,
          created_at: row.created_at as string,
          agent_run_id: null,
        };
      });
    },
  },

  // ── PULSE / MONEY ────────────────────────────────────────────────────────
  pulse: {
    async metrics() {
      const { data, error } = await supabase
        .from("pulse_metrics").select("*")
        .order("metric_date", { ascending: false }).limit(200);
      if (error) { console.error("[api] pulse.metrics:", error.message); throw error; }
      if ((data ?? []).length > 0) {
        const latestByKey = new Map<string, NonNullable<typeof data>[number]>();
        for (const row of data ?? []) {
          const key = String(row.metric_key ?? "metric");
          if (!latestByKey.has(key)) latestByKey.set(key, row);
        }

        return Array.from(latestByKey.values()).slice(0, 4).map((row) => {
          const value = Number(row.metric_value ?? 0);
          const label = String(row.metric_key ?? "metric").replace(/_/g, " ");
          return metric(String(row.metric_key), label, value, value.toLocaleString());
        });
      }

      const [
        { count: prospects },
        { count: clients },
        { count: openTriage },
        { count: activeCampaigns },
      ] = await Promise.all([
        supabase.from("entities").select("id", { count: "exact", head: true }).eq("kind", "prospect"),
        supabase.from("entities").select("id", { count: "exact", head: true }).eq("kind", "client"),
        supabase.from("triage_items").select("id", { count: "exact", head: true }).eq("status", "open"),
        supabase.from("campaigns").select("id", { count: "exact", head: true }).in("status", ["active", "live", "running"]),
      ]);

      return [
        metric("prospects", "Prospects", prospects ?? 0, String(prospects ?? 0)),
        metric("clients", "Clients", clients ?? 0, String(clients ?? 0)),
        metric("triage", "Open triage", openTriage ?? 0, String(openTriage ?? 0), false),
        metric("campaigns", "Campaigns", activeCampaigns ?? 0, String(activeCampaigns ?? 0)),
      ];
    },
  },
  money: {
    async mrr() {
      const { data, error } = await supabase
        .from("mrr_snapshots").select("*")
        .order("snapshot_date", { ascending: false }).limit(90);
      if (error) { console.error("[api] money.mrr:", error.message); throw error; }
      return data ?? [];
    },
    async revenueByClient() {
      const { data, error } = await supabase
        .from("contracts")
        .select("entity_id, mrr_cents, tier, status, entities(business_name)")
        .eq("status", "active");
      if (error) { console.error("[api] money.revenueByClient:", error.message); throw error; }
      return (data ?? []).map((row) => ({
        ...row,
        entity_name: entityName(row as Record<string, unknown>),
      }));
    },
  },

  // ── ONBOARDING ───────────────────────────────────────────────────────────
  onboarding: {
    async start(args: { entity_id: string; amount_cents: number; tier?: string }) {
      return invokeFn("onboarding", args);
    },
  },
};

export type Api = typeof api;
