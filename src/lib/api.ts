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
import { stageRank } from "./pipeline";
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

// ── V1 CLIENT API (new schema) ────────────────────────────────────────────────
// These functions target the v1 `clients` table and related views.

import type { Client, CreateClientPayload, ClientHealth, ActivityLogEntry, ReviewState } from "@/types/client";
import { deriveStage3Status, EMPTY_STAGE3_SNAPSHOT, expectedCalendarCellCount, type Stage3Snapshot, type Stage3Status } from "@/lib/stage3";

export async function fetchClients(): Promise<Client[]> {
  const { data, error } = await supabase.from("clients").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function fetchClientHealth(): Promise<ClientHealth[]> {
  const { data, error } = await supabase
    .from("client_health_v")
    .select("*")
    .order("health_score", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchClient(id: string): Promise<Client | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── Query resilience helpers ─────────────────────────────────────────────────
// Dashboard/metrics aggregation reads several tables in parallel. A single
// dropped request (intermittent cross-origin ERR_FAILED under connection
// pressure) must NOT blank the whole page — it degrades to partial data and a
// dev-only warning. Use these with Promise.allSettled for any read where partial
// failure is acceptable.
function logQueryError(context: string, error: unknown): void {
  if (import.meta.env.DEV) console.warn(`[aa] query degraded — ${context}:`, error);
}

/** Extract rows from a settled supabase select; [] (logged) on drop/error. */
function settledRows(context: string, result: PromiseSettledResult<{ data: unknown; error: unknown }>): unknown[] {
  if (result.status === "rejected") { logQueryError(context, result.reason); return []; }
  if (result.value.error) { logQueryError(context, result.value.error); return []; }
  return (result.value.data as unknown[]) ?? [];
}

/** Value from a settled promise-returning helper; fallback (logged) on rejection. */
function settledValue<T>(context: string, result: PromiseSettledResult<T>, fallback: T): T {
  if (result.status === "fulfilled") return result.value;
  logQueryError(context, result.reason);
  return fallback;
}

export async function fetchStage3StatusMap(month: string): Promise<Record<string, Stage3Status>> {
  // allSettled: one flaky table read degrades that table's counts to zero
  // rather than throwing and breaking the entire clients/cockpit dashboard.
  const [organic, story, ads, calendar] = await Promise.allSettled([
    supabase.from("organic_master").select("client_id, review_state").eq("month", month),
    supabase.from("story_master").select("client_id, review_state").eq("month", month),
    supabase.from("ads_master").select("client_id, review_state").eq("month", month),
    supabase.from("calendar_cells").select("client_id, review_state").eq("month", month),
  ]);
  const snapshots = new Map<string, Stage3Snapshot>();
  function add(rows: Array<{ client_id: string; review_state: string }>, countKey: keyof Stage3Snapshot, approvedKey: keyof Stage3Snapshot) {
    for (const row of rows) {
      const snapshot = snapshots.get(row.client_id) ?? { ...EMPTY_STAGE3_SNAPSHOT, expectedCalendarCount: expectedCalendarCellCount(month) };
      snapshot[countKey] += 1;
      if (row.review_state === "approved") snapshot[approvedKey] += 1;
      snapshots.set(row.client_id, snapshot);
    }
  }
  type StageRow = { client_id: string; review_state: string };
  add(settledRows("stage3:organic_master", organic) as StageRow[], "organicCount", "organicApproved");
  add(settledRows("stage3:story_master", story) as StageRow[], "storyCount", "storyApproved");
  add(settledRows("stage3:ads_master", ads) as StageRow[], "adsCount", "adsApproved");
  add(settledRows("stage3:calendar_cells", calendar) as StageRow[], "calendarCount", "calendarApproved");
  return Object.fromEntries([...snapshots].map(([clientId, snapshot]) => [clientId, deriveStage3Status(snapshot)]));
}

export async function createClient(payload: CreateClientPayload): Promise<Client> {
  const { data, error } = await supabase
    .from("clients")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateClient(id: string, updates: Partial<Client>): Promise<Client> {
  const { data, error } = await supabase
    .from("clients")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 63);
}

export async function fetchActivityLog(opts?: {
  clientId?: string;
  limit?: number;
}): Promise<ActivityLogEntry[]> {
  let query = supabase
    .from("activity_log")
    .select("*, clients(name, slug), users(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 100);
  if (opts?.clientId) query = query.eq("client_id", opts.clientId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ActivityLogEntry[];
}

// ── PHASE 1 / 2 STUB API ─────────────────────────────────────────────────────

import type {
  ClientInputs, ClientContextFile, ClientExecutionFile, ContextFileStatus,
  OrganicMasterRow, StoryMasterRow, AdsMasterRow, ProofMasterRow,
  AssetBriefRow, CalendarCellRow,
  Phase1Result, Phase2Result, Phase2Section, Phase3Result, Phase3Section,
  MasterRow, MasterTable, ProductionBriefRow, ContractorRow, ContractorAssignmentRow,
  ClientAssetRow, AiAssetGenerationResult, AssetFormat,
  PipelineStage, ArchiveStage, PipelineStateRow, ArchiveSnapshotRow,
  DistributionRecordRow, AnalyticsRecordRow, DistributionPublishPayload, DistributionPublishSettings, PublishStatus, AnalyticsStatus,
} from "@/types/phase";

export async function fetchClientInputs(clientId: string): Promise<ClientInputs | null> {
  const { data, error } = await supabase
    .from("client_inputs")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw error;
  return data as ClientInputs | null;
}

export async function saveClientInputs(
  clientId: string,
  patch: Partial<Omit<ClientInputs, "id" | "client_id" | "created_at" | "updated_at">>,
): Promise<ClientInputs> {
  const existing = await fetchClientInputs(clientId);
  const payload = { ...patch, updated_at: new Date().toISOString() };

  if (existing) {
    const { data, error } = await supabase
      .from("client_inputs")
      .update(payload)
      .eq("client_id", clientId)
      .select()
      .single();
    if (error) throw error;
    return data as ClientInputs;
  }

  const { data, error } = await supabase
    .from("client_inputs")
    .insert({ client_id: clientId, ...payload })
    .select()
    .single();
  if (!error) return data as ClientInputs;

  // Another writer may have created the unique client_id row after our read.
  if (error.code === "23505") {
    const { data: retried, error: retryError } = await supabase
      .from("client_inputs")
      .update(payload)
      .eq("client_id", clientId)
      .select()
      .single();
    if (retryError) throw retryError;
    return retried as ClientInputs;
  }
  throw error;
}

export async function logActivity(
  clientId: string | null,
  eventType: string,
  message: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await supabase.from("activity_log").insert({
    client_id: clientId,
    event_type: eventType,
    plain_english_message: message,
    metadata,
  });
  if (error) console.error("[logActivity]", error.message);
}

export async function runPhase1(clientId: string): Promise<Phase1Result> {
  try {
    return await invokeFn<Phase1Result>("generate-phase-1", { client_id: clientId });
  } catch (e) {
    const msg = `Failed to invoke generate-phase-1: ${e instanceof Error ? e.message : String(e)}`;
    await logActivity(clientId, "phase_1_error", msg).catch(() => {});
    return { ok: false, mode: "error", message: msg, warnings: [], missingInputs: [], error: String(e) };
  }
}

export async function generatePhase1File(
  clientId: string,
  fileNumber: number,
  fileName?: string,
): Promise<Phase1Result> {
  try {
    return await invokeFn<Phase1Result>("generate-phase-1-file", {
      client_id: clientId,
      file_number: fileNumber,
    });
  } catch (e) {
    const fileLabel = fileName ?? `file #${String(fileNumber).padStart(2, "0")}`;
    const msg = `generate-phase-1-file failed for ${fileLabel}: ${e instanceof Error ? e.message : String(e)}`;
    await logActivity(clientId, "phase_1_file_error", msg, { file_number: fileNumber, file_name: fileName }).catch(() => {});
    return { ok: false, mode: "error", message: msg, warnings: [], missingInputs: [], error: String(e) };
  }
}

export async function finalizePhase1(clientId: string): Promise<Phase1Result> {
  try {
    return await invokeFn<Phase1Result>("finalize-phase-1", { client_id: clientId });
  } catch (e) {
    const msg = `Failed to invoke finalize-phase-1: ${e instanceof Error ? e.message : String(e)}`;
    await logActivity(clientId, "phase_1_error", msg).catch(() => {});
    return { ok: false, mode: "error", message: msg, warnings: [], missingInputs: [], error: String(e) };
  }
}

export async function fetchClientContextFiles(clientId: string): Promise<ClientContextFile[]> {
  const { data, error } = await supabase
    .from("client_context_files")
    .select("*")
    .eq("client_id", clientId)
    .order("file_number");
  if (error) throw error;
  return (data ?? []) as ClientContextFile[];
}

export async function fetchClientContextFile(
  clientId: string,
  fileNumber: number,
): Promise<ClientContextFile> {
  const { data, error } = await supabase
    .from("client_context_files")
    .select("*")
    .eq("client_id", clientId)
    .eq("file_number", fileNumber)
    .single();
  if (error) throw error;
  return data as ClientContextFile;
}

export async function updateContextFileContent(
  file: Pick<ClientContextFile, "id" | "client_id" | "file_number" | "version">,
  contentMd: string,
): Promise<ClientContextFile> {
  const { data, error } = await supabase
    .from("client_context_files")
    .update({
      content_md: contentMd,
      version: file.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", file.id)
    .eq("client_id", file.client_id)
    .eq("file_number", file.file_number)
    .select("*")
    .single();
  if (error) throw error;
  return data as ClientContextFile;
}

export async function updateContextFileStatus(
  file: Pick<ClientContextFile, "id" | "client_id" | "file_number">,
  status: Extract<ContextFileStatus, "needs_review" | "approved">,
): Promise<ClientContextFile> {
  const { data, error } = await supabase
    .from("client_context_files")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", file.id)
    .eq("client_id", file.client_id)
    .eq("file_number", file.file_number)
    .select("*")
    .single();
  if (error) throw error;
  return data as ClientContextFile;
}

export async function runPhase2(clientId: string, executionMonth: string): Promise<Phase2Result> {
  try {
    return await invokeFn<Phase2Result>("generate-phase-2", {
      client_id: clientId,
      execution_month: executionMonth,
      action: "prepare",
    });
  } catch (e) {
    const msg = `Failed to invoke generate-phase-2: ${e instanceof Error ? e.message : String(e)}`;
    await logActivity(clientId, "phase_2_error", msg).catch(() => {});
    return { ok: false, mode: "error", message: msg, warnings: [], missingContextFiles: [], error: String(e) };
  }
}

export async function generatePhase2Section(
  clientId: string,
  executionMonth: string,
  section: Phase2Section,
): Promise<Phase2Result> {
  try {
    return await invokeFn<Phase2Result>("generate-phase-2", {
      client_id: clientId,
      execution_month: executionMonth,
      action: "section",
      section,
    });
  } catch (e) {
    const msg = `generate-phase-2 failed for ${section}: ${e instanceof Error ? e.message : String(e)}`;
    await logActivity(clientId, "phase_2_error", msg, { execution_month: executionMonth, section }).catch(() => {});
    return { ok: false, mode: "error", message: msg, warnings: [], missingContextFiles: [], error: String(e) };
  }
}

export async function finalizePhase2(clientId: string, executionMonth: string): Promise<Phase2Result> {
  try {
    return await invokeFn<Phase2Result>("generate-phase-2", {
      client_id: clientId,
      execution_month: executionMonth,
      action: "finalize",
    });
  } catch (e) {
    const msg = `Failed to finalize Phase 2: ${e instanceof Error ? e.message : String(e)}`;
    await logActivity(clientId, "phase_2_error", msg, { execution_month: executionMonth, stage: "finalize" }).catch(() => {});
    return { ok: false, mode: "error", message: msg, warnings: [], missingContextFiles: [], error: String(e) };
  }
}

export async function runPhase3(clientId: string, executionMonth: string): Promise<Phase3Result> {
  try {
    return await invokeFn<Phase3Result>("generate-phase-3", { client_id: clientId, execution_month: executionMonth, action: "prepare" });
  } catch (e) {
    const msg = `Failed to invoke generate-phase-3: ${e instanceof Error ? e.message : String(e)}`;
    await logActivity(clientId, "phase_3_error", msg).catch(() => {});
    return { ok: false, mode: "error", message: msg, warnings: [], missingContextFiles: [], error: String(e) };
  }
}

export async function generatePhase3Section(clientId: string, executionMonth: string, section: Phase3Section): Promise<Phase3Result> {
  try {
    return await invokeFn<Phase3Result>("generate-phase-3", { client_id: clientId, execution_month: executionMonth, action: "section", section });
  } catch (e) {
    const msg = `generate-phase-3 failed for ${section}: ${e instanceof Error ? e.message : String(e)}`;
    await logActivity(clientId, "phase_3_error", msg, { execution_month: executionMonth, section }).catch(() => {});
    return { ok: false, mode: "error", message: msg, warnings: [], missingContextFiles: [], error: String(e) };
  }
}

export async function finalizePhase3(clientId: string, executionMonth: string): Promise<Phase3Result> {
  try {
    return await invokeFn<Phase3Result>("generate-phase-3", { client_id: clientId, execution_month: executionMonth, action: "finalize" });
  } catch (e) {
    const msg = `Failed to finalize Phase 3: ${e instanceof Error ? e.message : String(e)}`;
    await logActivity(clientId, "phase_3_error", msg, { execution_month: executionMonth, stage: "finalize" }).catch(() => {});
    return { ok: false, mode: "error", message: msg, warnings: [], missingContextFiles: [], error: String(e) };
  }
}

export async function fetchClientExecutionFiles(
  clientId: string,
  month: string
): Promise<ClientExecutionFile[]> {
  const { data, error } = await supabase
    .from("client_execution_files")
    .select("*")
    .eq("client_id", clientId)
    .eq("month", month)
    .order("file_number");
  if (error) throw error;
  return (data ?? []) as ClientExecutionFile[];
}

export async function fetchClientExecutionFile(clientId: string, month: string, fileNumber: number): Promise<ClientExecutionFile> {
  const { data, error } = await supabase.from("client_execution_files").select("*")
    .eq("client_id", clientId).eq("month", month).eq("file_number", fileNumber).single();
  if (error) throw error;
  return data as ClientExecutionFile;
}

export async function updateExecutionFileContent(file: ClientExecutionFile, contentMd: string): Promise<ClientExecutionFile> {
  const { data, error } = await supabase.from("client_execution_files").update({
    content_md: contentMd,
    version: file.version + 1,
    review_state: file.review_state === "approved" ? "needs_review" : file.review_state,
    updated_at: new Date().toISOString(),
  }).eq("id", file.id).eq("client_id", file.client_id).eq("month", file.month).eq("file_number", file.file_number).select("*").single();
  if (error) throw error;
  return data as ClientExecutionFile;
}

export async function updateExecutionFileReviewState(fileId: string, reviewState: ReviewState): Promise<ClientExecutionFile> {
  const { data, error } = await supabase.from("client_execution_files")
    .update({ review_state: reviewState, updated_at: new Date().toISOString() })
    .eq("id", fileId).select("*").single();
  if (error) throw error;
  return data as ClientExecutionFile;
}

export async function regenerateExecutionFile(clientId: string, month: string, section: Phase2Section): Promise<Phase2Result> {
  return generatePhase2Section(clientId, month, section);
}

export async function fetchOrganicMasterRows(
  clientId: string,
  month: string
): Promise<OrganicMasterRow[]> {
  const { data, error } = await supabase
    .from("organic_master")
    .select("*")
    .eq("client_id", clientId)
    .eq("month", month)
    .order("ref");
  if (error) throw error;
  return (data ?? []) as OrganicMasterRow[];
}

export async function fetchStoryMasterRows(
  clientId: string,
  month: string
): Promise<StoryMasterRow[]> {
  const { data, error } = await supabase
    .from("story_master")
    .select("*")
    .eq("client_id", clientId)
    .eq("month", month)
    .order("ref");
  if (error) throw error;
  return (data ?? []) as StoryMasterRow[];
}

export async function fetchAdsMasterRows(
  clientId: string,
  month: string
): Promise<AdsMasterRow[]> {
  const { data, error } = await supabase
    .from("ads_master")
    .select("*")
    .eq("client_id", clientId)
    .eq("month", month)
    .order("ref");
  if (error) throw error;
  return (data ?? []) as AdsMasterRow[];
}

export async function fetchProofMasterRows(
  clientId: string,
  month?: string
): Promise<ProofMasterRow[]> {
  let q = supabase.from("proof_master").select("*").eq("client_id", clientId);
  if (month) q = q.eq("month", month);
  const { data, error } = await q.order("ref");
  if (error) throw error;
  return (data ?? []) as ProofMasterRow[];
}

export async function fetchAssetBriefRows(
  clientId: string,
  month: string
): Promise<AssetBriefRow[]> {
  const { data, error } = await supabase
    .from("asset_brief_index")
    .select("*")
    .eq("client_id", clientId)
    .eq("execution_month", month)
    .order("brief_id");
  if (error) throw error;
  return (data ?? []) as AssetBriefRow[];
}

export async function fetchCalendarCells(
  clientId: string,
  month: string
): Promise<CalendarCellRow[]> {
  const { data, error } = await supabase
    .from("calendar_cells")
    .select("*")
    .eq("client_id", clientId)
    .eq("month", month)
    .order("date");
  if (error) throw error;
  return (data ?? []) as CalendarCellRow[];
}

export async function updateMasterRow(
  table: MasterTable,
  row: MasterRow,
  patch: Record<string, string | null>,
): Promise<MasterRow> {
  const updatedAt = new Date().toISOString();
  if (row.review_state === "approved") {
    const { error: calendarError } = await supabase.from("calendar_cells").update({
      review_state: "needs_review",
      updated_at: updatedAt,
    }).eq("client_id", row.client_id).eq("month", row.month).eq("ref", row.ref);
    if (calendarError) throw calendarError;
  }
  const { data, error } = await supabase.from(table).update({
    ...patch,
    review_state: row.review_state === "approved" ? "needs_review" : row.review_state,
    updated_at: updatedAt,
  }).eq("id", row.id).eq("client_id", row.client_id).select("*").single();
  if (error) {
    if (row.review_state === "approved") await supabase.from("calendar_cells").update({ review_state: "approved", updated_at: row.updated_at })
      .eq("client_id", row.client_id).eq("month", row.month).eq("ref", row.ref);
    throw error;
  }
  return data as MasterRow;
}

export async function updateMasterReviewState(
  table: MasterTable,
  row: MasterRow,
  reviewState: ReviewState,
): Promise<MasterRow> {
  const updatedAt = new Date().toISOString();
  const { data, error } = await supabase.from(table).update({ review_state: reviewState, updated_at: updatedAt })
    .eq("id", row.id).eq("client_id", row.client_id).select("*").single();
  if (error) throw error;
  const { error: calendarError } = await supabase.from("calendar_cells").update({ review_state: reviewState, updated_at: updatedAt })
    .eq("client_id", row.client_id).eq("month", row.month).eq("ref", row.ref);
  if (calendarError) {
    await supabase.from(table).update({ review_state: row.review_state, updated_at: row.updated_at }).eq("id", row.id).eq("client_id", row.client_id);
    throw calendarError;
  }
  return data as MasterRow;
}

export async function fetchMasterRowByRef(clientId: string, ref: string): Promise<{ table: MasterTable; row: MasterRow } | null> {
  const table: MasterTable = ref.includes("-ST-") ? "story_master" : ref.includes("-AD-") ? "ads_master" : "organic_master";
  const { data, error } = await supabase.from(table).select("*").eq("client_id", clientId).eq("ref", ref).maybeSingle();
  if (error) throw error;
  return data ? { table, row: data as MasterRow } : null;
}

export interface GenerateProductionBriefInput {
  clientId: string;
  executionMonth: string;
  sourceTable: MasterTable;
  sourceRowId: string;
  sourceRef: string;
}

export async function generateProductionBrief(input: GenerateProductionBriefInput): Promise<ProductionBriefRow> {
  const result = await invokeFn<{ ok: boolean; brief?: ProductionBriefRow; message?: string }>("generate-production-brief", {
    client_id: input.clientId,
    execution_month: input.executionMonth,
    source_table: input.sourceTable,
    source_row_id: input.sourceRowId,
    source_ref: input.sourceRef,
  });
  if (!result.ok || !result.brief) throw new Error(result.message ?? "generate-production-brief returned no brief.");
  return result.brief;
}

export async function fetchProductionBriefs(clientId: string, executionMonth: string): Promise<ProductionBriefRow[]> {
  const { data, error } = await supabase.from("client_production_briefs").select("*")
    .eq("client_id", clientId).eq("execution_month", executionMonth).order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProductionBriefRow[];
}

export async function fetchProductionBrief(briefId: string): Promise<ProductionBriefRow> {
  const { data, error } = await supabase.from("client_production_briefs").select("*").eq("id", briefId).single();
  if (error) throw error;
  return data as ProductionBriefRow;
}

export async function fetchProductionBriefBySourceRef(clientId: string, executionMonth: string, sourceRef: string): Promise<ProductionBriefRow | null> {
  const { data, error } = await supabase.from("client_production_briefs").select("*")
    .eq("client_id", clientId).eq("execution_month", executionMonth).eq("source_ref", sourceRef).maybeSingle();
  if (error) throw error;
  return data as ProductionBriefRow | null;
}

export async function updateProductionBrief(brief: ProductionBriefRow, contentMd: string): Promise<ProductionBriefRow> {
  const { data, error } = await supabase.from("client_production_briefs").update({
    content_md: contentMd,
    status: brief.status === "approved" ? "needs_review" : brief.status,
    production_status: "brief",
    version: brief.version + 1,
    updated_at: new Date().toISOString(),
  }).eq("id", brief.id).eq("client_id", brief.client_id).select("*").single();
  if (error) throw error;
  return data as ProductionBriefRow;
}

export async function updateProductionBriefReviewState(briefId: string, status: ReviewState): Promise<ProductionBriefRow> {
  const { data, error } = await supabase.from("client_production_briefs").update({ status, updated_at: new Date().toISOString() })
    .eq("id", briefId).select("*").single();
  if (error) throw error;
  return data as ProductionBriefRow;
}

export async function fetchContractors(activeOnly = true): Promise<ContractorRow[]> {
  let query = supabase.from("contractors").select("*").order("name");
  if (activeOnly) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ContractorRow[];
}

export interface CreateContractorInput {
  name: string;
  email: string;
  role?: string | null;
  specialties?: string[];
  notes?: string | null;
  active?: boolean;
}

export async function createContractor(input: CreateContractorInput): Promise<ContractorRow> {
  const { data, error } = await supabase.from("contractors").insert({
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    role: input.role?.trim() || null,
    specialties: (input.specialties ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean),
    notes: input.notes?.trim() || null,
    active: input.active ?? true,
  }).select("*").single();
  if (error) throw error;
  return data as ContractorRow;
}

export async function updateContractor(contractorId: string, input: CreateContractorInput): Promise<ContractorRow> {
  const { data, error } = await supabase.from("contractors").update({
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    role: input.role?.trim() || null,
    specialties: (input.specialties ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean),
    notes: input.notes?.trim() || null,
    active: input.active ?? true,
    updated_at: new Date().toISOString(),
  }).eq("id", contractorId).select("*").single();
  if (error) throw error;
  return data as ContractorRow;
}

export async function deactivateContractor(contractorId: string): Promise<ContractorRow> {
  const { data, error } = await supabase.from("contractors").update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", contractorId).select("*").single();
  if (error) throw error;
  return data as ContractorRow;
}

export async function fetchAssignmentsForBrief(productionBriefId: string): Promise<ContractorAssignmentRow[]> {
  const { data, error } = await supabase.from("contractor_assignments")
    .select("*, contractors(id,name,email,role,specialties)")
    .eq("production_brief_id", productionBriefId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ContractorAssignmentRow[];
}

export async function assignProductionBriefToContractor(input: {
  productionBriefId: string;
  contractorId: string;
  message?: string;
}): Promise<{ assignment: ContractorAssignmentRow; brief: ProductionBriefRow }> {
  const result = await invokeFn<{ ok: boolean; assignment?: ContractorAssignmentRow; brief?: ProductionBriefRow; message?: string }>("send-production-brief-to-contractor", {
    production_brief_id: input.productionBriefId,
    contractor_id: input.contractorId,
    message: input.message?.trim() || null,
  });
  if (!result.ok || !result.assignment || !result.brief) throw new Error(result.message ?? "Contractor assignment returned an incomplete response.");
  return { assignment: result.assignment, brief: result.brief };
}

const AI_ASSET_FUNCTIONS: Partial<Record<AssetFormat, string>> = {
  feed_post: "generate-feed-post-asset",
  carousel: "generate-carousel-assets",
  story_sequence: "generate-story-assets",
  ad_static: "generate-ad-static-asset",
};

export async function generateAiAssets(brief: ProductionBriefRow, expectedCount?: number): Promise<AiAssetGenerationResult> {
  if (brief.asset_format === "reel_video") throw new Error("AI video generation is not supported. Reels are human-only.");
  const functionName = AI_ASSET_FUNCTIONS[brief.asset_format];
  if (!functionName) throw new Error(`No AI asset function is configured for ${brief.asset_format}.`);
  const result = await invokeFn<{ ok: boolean; message?: string; asset_group_ref?: string; asset_count?: number; assets?: ClientAssetRow[]; brief?: ProductionBriefRow }>(functionName, {
    production_brief_id: brief.id,
    // Only consulted by the generator when the brief's own count is ambiguous.
    ...(typeof expectedCount === "number" ? { expected_count: expectedCount } : {}),
  });
  if (!result.ok || !result.asset_group_ref || !result.asset_count || !result.assets || !result.brief) {
    throw new Error(result.message ?? `${functionName} returned an incomplete asset group.`);
  }
  return {
    asset_group_ref: result.asset_group_ref,
    asset_count: result.asset_count,
    assets: result.assets,
    brief: result.brief,
  };
}

async function addSignedAssetUrls(rows: ClientAssetRow[]): Promise<ClientAssetRow[]> {
  return Promise.all(rows.map(async (asset) => {
    const { data, error } = await supabase.storage.from(asset.storage_bucket).createSignedUrl(asset.storage_path, 3600);
    return { ...asset, signed_url: error ? null : data.signedUrl };
  }));
}

export async function fetchClientAssets(clientId: string): Promise<ClientAssetRow[]> {
  const { data, error } = await supabase.from("client_assets")
    .select("*, production_brief:client_production_briefs(production_mode,source_table,source_row_id)")
    .eq("client_id", clientId).order("created_at", { ascending: false }).order("sequence_index");
  if (error) throw error;
  return addSignedAssetUrls((data ?? []) as ClientAssetRow[]);
}

export async function fetchAssetsForBrief(productionBriefId: string): Promise<ClientAssetRow[]> {
  const { data, error } = await supabase.from("client_assets")
    .select("*, production_brief:client_production_briefs(production_mode,source_table,source_row_id)")
    .eq("production_brief_id", productionBriefId).order("created_at", { ascending: false }).order("sequence_index");
  if (error) throw error;
  return addSignedAssetUrls((data ?? []) as ClientAssetRow[]);
}

export async function updateClientAssetGroupStatus(
  clientId: string,
  assetGroupRef: string,
  status: ReviewState,
): Promise<ClientAssetRow[]> {
  const { data, error } = await supabase.from("client_assets")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("asset_group_ref", assetGroupRef)
    .select("*, production_brief:client_production_briefs(production_mode,source_table,source_row_id)");
  if (error) throw error;
  if (!data?.length) throw new Error(`Asset group ${assetGroupRef} was not found or could not be updated.`);
  return addSignedAssetUrls(data as ClientAssetRow[]);
}

const REVIEW_TABLES = [
  "organic_master",
  "story_master",
  "ads_master",
  "proof_master",
  "asset_brief_index",
  "calendar_cells",
] as const;
export type ReviewTable = (typeof REVIEW_TABLES)[number];

export async function updateReviewState(
  tableName: ReviewTable,
  rowId: string,
  reviewState: ReviewState
): Promise<void> {
  // asset_brief_index stores review state in `status`, not `review_state`
  const column = tableName === "asset_brief_index" ? "status" : "review_state";
  const { error } = await supabase
    .from(tableName)
    .update({ [column]: reviewState, updated_at: new Date().toISOString() })
    .eq("id", rowId);
  if (error) throw error;
}

// ── PHASE H1: PIPELINE STATE + ARCHIVE SNAPSHOTS ─────────────────────────────
// The lifecycle spine after Phase 3:
//   master → content_creation → assets → distribution → analytics → analysis
//   → completed → archived
// Records stay in their source tables (organic_master, client_production_briefs,
// client_assets, …). `client_asset_pipeline_state` records which stage a ref is
// ACTIVE in; `client_asset_archive_snapshots` is an append-only memory of the
// data a ref held in each stage it has left. Nothing here deletes or moves a
// source row. Tab visibility is NOT changed by H1 — that is H2.

const PIPELINE_STATE_TABLE = "client_asset_pipeline_state";
const ARCHIVE_SNAPSHOT_TABLE = "client_asset_archive_snapshots";

/** Every real transition writes a snapshot except these two terminal states. */
export function isSnapshotStage(stage: PipelineStage): stage is ArchiveStage {
  return stage !== "completed" && stage !== "archived";
}

export async function fetchPipelineState(clientId: string, executionMonth: string): Promise<PipelineStateRow[]> {
  const { data, error } = await supabase
    .from(PIPELINE_STATE_TABLE)
    .select("*")
    .eq("client_id", clientId)
    .eq("execution_month", executionMonth)
    .order("source_ref");
  if (error) throw error;
  return (data ?? []) as PipelineStateRow[];
}

export async function fetchPipelineStateByRef(
  clientId: string,
  executionMonth: string,
  sourceRef: string,
): Promise<PipelineStateRow | null> {
  const { data, error } = await supabase
    .from(PIPELINE_STATE_TABLE)
    .select("*")
    .eq("client_id", clientId)
    .eq("execution_month", executionMonth)
    .eq("source_ref", sourceRef)
    .maybeSingle();
  if (error) throw error;
  return (data as PipelineStateRow | null) ?? null;
}

export interface UpsertPipelineStateInput {
  clientId: string;
  executionMonth: string;
  sourceRef: string;
  currentStage: PipelineStage;
  previousStage?: PipelineStage | null;
  assetGroupRef?: string | null;
  productionBriefId?: string | null;
  title?: string | null;
  assetFormat?: string | null;
  active?: boolean;
  transitionReason?: string | null;
  /** Merged into (not replacing) the stored metadata jsonb. */
  metadata?: Record<string, unknown>;
  /** When true, `stage_entered_at` is reset to now (a genuine stage change). */
  stageChanged?: boolean;
}

/**
 * Insert-or-update the single pipeline-state row for a ref. Keyed on the
 * (client_id, execution_month, source_ref) unique constraint. Existing metadata
 * is merged so callers never clobber another stage's context.
 */
export async function upsertPipelineState(input: UpsertPipelineStateInput): Promise<PipelineStateRow> {
  const existing = await fetchPipelineStateByRef(input.clientId, input.executionMonth, input.sourceRef);
  const now = new Date().toISOString();
  const stageChanged = input.stageChanged ?? (!!existing && existing.current_stage !== input.currentStage);
  const mergedMetadata = { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) };

  const row: Record<string, unknown> = {
    client_id: input.clientId,
    execution_month: input.executionMonth,
    source_ref: input.sourceRef,
    current_stage: input.currentStage,
    previous_stage: input.previousStage ?? existing?.previous_stage ?? null,
    asset_group_ref: input.assetGroupRef ?? existing?.asset_group_ref ?? null,
    production_brief_id: input.productionBriefId ?? existing?.production_brief_id ?? null,
    title: input.title ?? existing?.title ?? null,
    asset_format: input.assetFormat ?? existing?.asset_format ?? null,
    active: input.active ?? existing?.active ?? true,
    transition_reason: input.transitionReason ?? existing?.transition_reason ?? null,
    metadata: mergedMetadata,
    last_transition_at: now,
    updated_at: now,
    stage_entered_at: stageChanged || !existing ? now : existing.stage_entered_at,
  };

  const { data, error } = await supabase
    .from(PIPELINE_STATE_TABLE)
    .upsert(row, { onConflict: "client_id,execution_month,source_ref" })
    .select("*")
    .single();
  if (error) throw error;
  return data as PipelineStateRow;
}

export async function fetchArchiveSnapshots(clientId: string, executionMonth: string): Promise<ArchiveSnapshotRow[]> {
  const { data, error } = await supabase
    .from(ARCHIVE_SNAPSHOT_TABLE)
    .select("*")
    .eq("client_id", clientId)
    .eq("execution_month", executionMonth)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ArchiveSnapshotRow[];
}

export async function fetchArchiveSnapshotsByRef(
  clientId: string,
  executionMonth: string,
  sourceRef: string,
): Promise<ArchiveSnapshotRow[]> {
  const { data, error } = await supabase
    .from(ARCHIVE_SNAPSHOT_TABLE)
    .select("*")
    .eq("client_id", clientId)
    .eq("execution_month", executionMonth)
    .eq("source_ref", sourceRef)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ArchiveSnapshotRow[];
}

export interface CreateArchiveSnapshotInput {
  clientId: string;
  executionMonth: string;
  sourceRef: string;
  stage: ArchiveStage;
  sourceTable: string;
  snapshotData: Record<string, unknown>;
  assetGroupRef?: string | null;
  title?: string | null;
  assetFormat?: string | null;
  sourceRowId?: string | null;
  snapshotMd?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

/** Append an immutable snapshot. Never updates or deletes an existing snapshot. */
export async function createArchiveSnapshot(input: CreateArchiveSnapshotInput): Promise<ArchiveSnapshotRow> {
  const { data, error } = await supabase
    .from(ARCHIVE_SNAPSHOT_TABLE)
    .insert({
      client_id: input.clientId,
      execution_month: input.executionMonth,
      source_ref: input.sourceRef,
      asset_group_ref: input.assetGroupRef ?? null,
      stage: input.stage,
      title: input.title ?? null,
      asset_format: input.assetFormat ?? null,
      source_table: input.sourceTable,
      source_row_id: input.sourceRowId ?? null,
      snapshot_data: input.snapshotData,
      snapshot_md: input.snapshotMd ?? null,
      snapshot_reason: input.reason ?? null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ArchiveSnapshotRow;
}

export interface TransitionAssetStageInput {
  clientId: string;
  executionMonth: string;
  sourceRef: string;
  fromStage: ArchiveStage;
  toStage: PipelineStage;
  /** Immutable snapshot of the stage being LEFT (`fromStage`). */
  sourceTable: string;
  snapshotData: Record<string, unknown>;
  assetGroupRef?: string | null;
  productionBriefId?: string | null;
  sourceRowId?: string | null;
  title?: string | null;
  assetFormat?: string | null;
  snapshotMd?: string | null;
  reason?: string | null;
  /** Merged into pipeline-state metadata. */
  metadata?: Record<string, unknown>;
}

export interface TransitionAssetStageResult {
  state: PipelineStateRow;
  snapshot: ArchiveSnapshotRow;
}

/**
 * Advance a ref from one stage to the next:
 *   1. Append an immutable snapshot of the stage being left (`fromStage`).
 *   2. Upsert pipeline state to `toStage` (previous_stage = fromStage).
 *   3. Leave every source row untouched in its own table.
 *
 * The snapshot is written first: it is append-only, so an orphan snapshot from a
 * failed state upsert is harmless, whereas advancing state without a snapshot
 * would lose lifecycle memory. Callers pass `snapshotData` — the frontend never
 * mutates the source content, it only copies it.
 */
export async function transitionAssetStage(input: TransitionAssetStageInput): Promise<TransitionAssetStageResult> {
  const snapshot = await createArchiveSnapshot({
    clientId: input.clientId,
    executionMonth: input.executionMonth,
    sourceRef: input.sourceRef,
    stage: input.fromStage,
    sourceTable: input.sourceTable,
    snapshotData: input.snapshotData,
    assetGroupRef: input.assetGroupRef,
    title: input.title,
    assetFormat: input.assetFormat,
    sourceRowId: input.sourceRowId,
    snapshotMd: input.snapshotMd,
    reason: input.reason,
  });

  const state = await upsertPipelineState({
    clientId: input.clientId,
    executionMonth: input.executionMonth,
    sourceRef: input.sourceRef,
    currentStage: input.toStage,
    previousStage: input.fromStage,
    assetGroupRef: input.assetGroupRef,
    productionBriefId: input.productionBriefId,
    title: input.title,
    assetFormat: input.assetFormat,
    transitionReason: input.reason,
    metadata: input.metadata,
    stageChanged: true,
  });

  return { state, snapshot };
}

// ── PIPELINE RECONCILIATION (non-destructive) ────────────────────────────────
// Derives the stage a ref *should* be in from records that already exist. H1
// provides this but never runs a bulk migration: state is created lazily (on
// fetch or transition), and reconciliation never downgrades a more-advanced row.

export interface StagePresence {
  hasPublishedAnalytics?: boolean;
  hasDistribution?: boolean;
  hasApprovedAsset?: boolean;
  hasProducedAsset?: boolean;
  hasProductionBrief?: boolean;
  hasMaster?: boolean;
}

/** Pure derivation: highest reached stage wins. Returns null if nothing exists. */
export function deriveCurrentStage(presence: StagePresence): PipelineStage | null {
  if (presence.hasPublishedAnalytics) return "analytics";
  if (presence.hasDistribution) return "distribution";
  // An approved (not yet published) asset is distribution-ready; H3 will move it
  // on. A merely-produced asset is still in review.
  if (presence.hasApprovedAsset) return "distribution";
  if (presence.hasProducedAsset) return "assets";
  if (presence.hasProductionBrief) return "content_creation";
  if (presence.hasMaster) return "master";
  return null;
}

/**
 * Read existing records for one ref and derive its stage without mutating any
 * source data. Distribution/analytics presence is always false in H1 (those
 * tables arrive in H3/H4).
 */
export async function derivePresenceForRef(
  clientId: string,
  executionMonth: string,
  sourceRef: string,
): Promise<StagePresence> {
  const [master, brief, assets] = await Promise.all([
    fetchMasterRowByRef(clientId, sourceRef).catch(() => null),
    fetchProductionBriefBySourceRef(clientId, executionMonth, sourceRef).catch(() => null),
    supabase.from("client_assets").select("status").eq("client_id", clientId).eq("source_ref", sourceRef),
  ]);
  const assetRows = (assets.data ?? []) as Array<{ status: ReviewState }>;
  return {
    hasMaster: !!master,
    hasProductionBrief: !!brief,
    hasProducedAsset: assetRows.length > 0,
    hasApprovedAsset: assetRows.some((row) => row.status === "approved"),
    hasDistribution: false,
    hasPublishedAnalytics: false,
  };
}

/**
 * Lazily ensure a pipeline-state row exists for a ref. If one already exists it
 * is returned unchanged (reconciliation never downgrades a manually-advanced
 * row). If absent, derive the stage from existing records and create it. Returns
 * null only when the ref has no records at all. Non-destructive by design; safe
 * to call opportunistically when a tab loads a ref.
 */
export async function reconcilePipelineStateForRef(
  clientId: string,
  executionMonth: string,
  sourceRef: string,
  hints?: { assetGroupRef?: string | null; productionBriefId?: string | null; title?: string | null; assetFormat?: string | null },
): Promise<PipelineStateRow | null> {
  const existing = await fetchPipelineStateByRef(clientId, executionMonth, sourceRef);
  if (existing) return existing;
  const derived = deriveCurrentStage(await derivePresenceForRef(clientId, executionMonth, sourceRef));
  if (!derived) return null;
  return upsertPipelineState({
    clientId,
    executionMonth,
    sourceRef,
    currentStage: derived,
    assetGroupRef: hints?.assetGroupRef ?? null,
    productionBriefId: hints?.productionBriefId ?? null,
    title: hints?.title ?? null,
    assetFormat: hints?.assetFormat ?? null,
    transitionReason: "reconciled_from_existing_records",
    stageChanged: true,
  });
}

// ── EFFECTIVE STAGE MAP (H2 tab visibility) ──────────────────────────────────
// The stage a ref is *effectively* in = the higher of (a) its explicit pipeline
// state and (b) the stage its existing records imply. This lets active-tab
// filtering be correct for legacy refs that predate H1 (no state row) without
// writing anything on read. Explicit transitions still record snapshots + state.

export interface EffectiveStageEntry {
  source_ref: string;
  stage: PipelineStage;
  state: PipelineStateRow | null;
  title: string | null;
  asset_format: string | null;
  asset_group_ref: string | null;
  production_brief_id: string | null;
  has_production_brief: boolean;
  has_produced_asset: boolean;
  has_approved_asset: boolean;
  updated_at: string;
}

export async function fetchEffectiveStageMap(
  clientId: string,
  executionMonth: string,
): Promise<Map<string, EffectiveStageEntry>> {
  // allSettled: a dropped sub-read degrades this ref map to partial truth (and
  // a dev warning) instead of throwing and blanking whichever tab called it.
  const [stateResult, briefsResult, assetsResult] = await Promise.allSettled([
    fetchPipelineState(clientId, executionMonth),
    fetchProductionBriefs(clientId, executionMonth),
    supabase
      .from("client_assets")
      .select("source_ref,status,asset_group_ref,title,asset_format,production_brief_id,updated_at")
      .eq("client_id", clientId),
  ]);
  const state = settledValue("effectiveStageMap:pipeline_state", stateResult, [] as PipelineStateRow[]);
  const briefs = settledValue("effectiveStageMap:production_briefs", briefsResult, [] as ProductionBriefRow[]);
  const assets = settledRows("effectiveStageMap:client_assets", assetsResult) as Array<{
    source_ref: string; status: ReviewState; asset_group_ref: string | null;
    title: string | null; asset_format: string | null; production_brief_id: string | null; updated_at: string;
  }>;

  type Acc = Omit<EffectiveStageEntry, "stage">;
  const acc = new Map<string, Acc>();
  const ensure = (ref: string): Acc => {
    let entry = acc.get(ref);
    if (!entry) {
      entry = {
        source_ref: ref, state: null, title: null, asset_format: null, asset_group_ref: null,
        production_brief_id: null, has_production_brief: false, has_produced_asset: false,
        has_approved_asset: false, updated_at: "",
      };
      acc.set(ref, entry);
    }
    return entry;
  };
  const bump = (entry: Acc, ts: string | null | undefined) => { if (ts && ts > entry.updated_at) entry.updated_at = ts; };

  for (const brief of briefs) {
    const entry = ensure(brief.source_ref);
    entry.has_production_brief = true;
    entry.production_brief_id = entry.production_brief_id ?? brief.id;
    entry.title = entry.title ?? brief.title;
    entry.asset_format = entry.asset_format ?? brief.asset_format;
    bump(entry, brief.updated_at);
  }
  for (const asset of assets) {
    const entry = ensure(asset.source_ref);
    entry.has_produced_asset = true;
    if (asset.status === "approved") entry.has_approved_asset = true;
    entry.asset_group_ref = entry.asset_group_ref ?? asset.asset_group_ref;
    entry.production_brief_id = entry.production_brief_id ?? asset.production_brief_id;
    entry.title = entry.title ?? asset.title;
    entry.asset_format = entry.asset_format ?? asset.asset_format;
    bump(entry, asset.updated_at);
  }
  for (const row of state) {
    const entry = ensure(row.source_ref);
    entry.state = row;
    entry.title = entry.title ?? row.title;
    entry.asset_format = entry.asset_format ?? row.asset_format;
    entry.asset_group_ref = entry.asset_group_ref ?? row.asset_group_ref;
    entry.production_brief_id = entry.production_brief_id ?? row.production_brief_id;
    bump(entry, row.updated_at);
  }

  const result = new Map<string, EffectiveStageEntry>();
  for (const entry of acc.values()) {
    const presence = deriveCurrentStage({
      hasApprovedAsset: entry.has_approved_asset,
      hasProducedAsset: entry.has_produced_asset,
      hasProductionBrief: entry.has_production_brief,
      hasMaster: true,
    }) ?? "master";
    const explicit = entry.state?.current_stage ?? null;
    const stage = explicit && stageRank(explicit) >= stageRank(presence) ? explicit : presence;
    result.set(entry.source_ref, {
      ...entry,
      stage,
      updated_at: entry.updated_at || entry.state?.updated_at || new Date().toISOString(),
    });
  }
  return result;
}

// ── NAMED STAGE TRANSITIONS (H2 wiring points) ───────────────────────────────
// Each wrapper snapshots the stage being left and advances pipeline state. They
// are best-effort at the call site: the primary action (brief/asset/approval)
// has already committed, and fetchEffectiveStageMap will keep visibility correct
// even if a transition write fails. Callers guard against regression (only call
// when the ref has not already advanced past the target).

export async function transitionMasterToContentCreation(input: {
  clientId: string; executionMonth: string; sourceRef: string;
  sourceTable: MasterTable; sourceRowId: string; title: string | null;
  assetFormat: string | null; productionBriefId: string | null;
  masterSnapshot: Record<string, unknown>;
}): Promise<TransitionAssetStageResult> {
  return transitionAssetStage({
    clientId: input.clientId, executionMonth: input.executionMonth, sourceRef: input.sourceRef,
    fromStage: "master", toStage: "content_creation",
    sourceTable: input.sourceTable, sourceRowId: input.sourceRowId,
    productionBriefId: input.productionBriefId, title: input.title, assetFormat: input.assetFormat,
    snapshotData: input.masterSnapshot, reason: "brief_generated",
  });
}

export async function transitionContentCreationToAssets(input: {
  clientId: string; executionMonth: string; sourceRef: string;
  productionBriefId: string; assetGroupRef: string | null; title: string | null;
  assetFormat: string | null; briefSnapshot: Record<string, unknown>; reason?: string;
}): Promise<TransitionAssetStageResult> {
  return transitionAssetStage({
    clientId: input.clientId, executionMonth: input.executionMonth, sourceRef: input.sourceRef,
    fromStage: "content_creation", toStage: "assets",
    sourceTable: "client_production_briefs", sourceRowId: input.productionBriefId,
    productionBriefId: input.productionBriefId, assetGroupRef: input.assetGroupRef,
    title: input.title, assetFormat: input.assetFormat,
    snapshotData: input.briefSnapshot, reason: input.reason ?? "asset_produced",
  });
}

export async function transitionAssetsToDistribution(input: {
  clientId: string; executionMonth: string; sourceRef: string;
  assetGroupRef: string | null; productionBriefId: string | null; title: string | null;
  assetFormat: string | null; assetSnapshot: Record<string, unknown>;
}): Promise<TransitionAssetStageResult> {
  return transitionAssetStage({
    clientId: input.clientId, executionMonth: input.executionMonth, sourceRef: input.sourceRef,
    fromStage: "assets", toStage: "distribution",
    sourceTable: "client_assets", productionBriefId: input.productionBriefId,
    assetGroupRef: input.assetGroupRef, title: input.title, assetFormat: input.assetFormat,
    snapshotData: input.assetSnapshot, reason: "asset_approved",
    // H3 introduces a distribution_records table; until then the distribution-ready
    // signal lives in pipeline-state metadata so nothing publishes prematurely.
    metadata: { distribution_status: "pending" },
  });
}

/**
 * Prepared for H3/H4 — NOT wired to any UI action in H2. Real analytics only
 * begins once a publish actually succeeds; H2 never fabricates that transition.
 */
export async function transitionDistributionToAnalytics(input: {
  clientId: string; executionMonth: string; sourceRef: string;
  assetGroupRef: string | null; productionBriefId: string | null; title: string | null;
  assetFormat: string | null; distributionSnapshot: Record<string, unknown>;
}): Promise<TransitionAssetStageResult> {
  return transitionAssetStage({
    clientId: input.clientId, executionMonth: input.executionMonth, sourceRef: input.sourceRef,
    fromStage: "distribution", toStage: "analytics",
    sourceTable: "distribution", productionBriefId: input.productionBriefId,
    assetGroupRef: input.assetGroupRef, title: input.title, assetFormat: input.assetFormat,
    snapshotData: input.distributionSnapshot, reason: "asset_published",
  });
}

// ── PHASE H3: DISTRIBUTION RECORDS + PUBLISH WORKFLOW ─────────────────────────
// Approving an asset group creates a client_distribution_records row (the
// publishable unit). The asset files stay in client_assets — the record just
// carries the publish payload/settings/status. Only a real publish success
// advances a record to `published` and creates an analytics record.

const DISTRIBUTION_TABLE = "client_distribution_records";

/** Static → IMAGE, carousel → CAROUSEL, story → STORIES, reel → REELS. */
export function distributionDefaults(assetFormat: string): { contentType: string; aspectRatio: string } {
  switch (assetFormat) {
    case "carousel": return { contentType: "CAROUSEL", aspectRatio: "4:5" };
    case "story_sequence": return { contentType: "STORIES", aspectRatio: "9:16" };
    case "reel_video": return { contentType: "REELS", aspectRatio: "9:16" };
    default: return { contentType: "IMAGE", aspectRatio: "4:5" }; // ad_static, feed_post
  }
}

function masterAsRecord(master: MasterRow | null): Record<string, unknown> | null {
  return master as unknown as Record<string, unknown> | null;
}

function deriveCaption(master: MasterRow | null, brief: ProductionBriefRow | null): string {
  const row = masterAsRecord(master);
  const pick = (key: string) => (row && typeof row[key] === "string" ? (row[key] as string) : "");
  return pick("caption_script") || pick("core_message") || pick("hook") || pick("hook_angle") || brief?.title || "";
}

function deriveProofRestrictions(master: MasterRow | null): string | null {
  const row = masterAsRecord(master);
  if (!row) return null;
  const value = row["what_not_to_claim"] ?? row["notes"];
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Idempotently create/refresh the distribution record for an approved asset
 * group, deriving the publish payload from the production brief, the asset
 * rows, the source master row and the calendar. Also records the Assets →
 * Distribution transition + archive snapshot. Never overwrites a record that
 * has already been scheduled/published (that would drop user edits / status).
 */
export async function promoteAssetGroupToDistribution(input: {
  clientId: string; executionMonth: string; sourceRef: string; assetGroupRef: string;
  productionBriefId: string | null; assetFormat: string; title: string | null;
  assetRows: Array<Pick<ClientAssetRow, "id" | "storage_bucket" | "storage_path" | "sequence_index" | "mime_type" | "width" | "height" | "status">>;
}): Promise<DistributionRecordRow> {
  await transitionAssetsToDistribution({
    clientId: input.clientId, executionMonth: input.executionMonth, sourceRef: input.sourceRef,
    assetGroupRef: input.assetGroupRef, productionBriefId: input.productionBriefId,
    title: input.title, assetFormat: input.assetFormat,
    assetSnapshot: { asset_group_ref: input.assetGroupRef, files: input.assetRows.map((row) => ({ id: row.id, storage_path: row.storage_path, sequence_index: row.sequence_index, status: row.status })) },
  }).catch(() => { /* non-fatal — visibility stays correct via presence */ });

  const existing = await fetchDistributionRecordByGroup(input.clientId, input.assetGroupRef);
  // Don't clobber a record that has moved past 'ready' — preserve edits/status.
  if (existing && existing.publish_status !== "ready") return existing;

  const [master, brief, cells] = await Promise.all([
    fetchMasterRowByRef(input.clientId, input.sourceRef).catch(() => null),
    input.productionBriefId ? fetchProductionBrief(input.productionBriefId).catch(() => null) : Promise.resolve(null),
    fetchCalendarCells(input.clientId, input.executionMonth).catch(() => [] as Array<{ ref: string; date: string }>),
  ]);
  const cell = cells.find((entry) => entry.ref === input.sourceRef);
  const masterRow = master?.row ?? null;
  const masterRecord = masterAsRecord(masterRow);
  const plannedDate = cell?.date
    ?? (masterRecord && typeof masterRecord.distribution_date === "string" ? masterRecord.distribution_date as string : null)
    ?? (masterRecord && typeof masterRecord.start_date === "string" ? masterRecord.start_date as string : null);
  const defaults = distributionDefaults(input.assetFormat);

  const payload: DistributionPublishPayload = {
    caption: deriveCaption(masterRow, brief),
    hashtags: [],
    media: [...input.assetRows].sort((a, b) => a.sequence_index - b.sequence_index).map((row) => ({
      storage_bucket: row.storage_bucket, storage_path: row.storage_path, sequence_index: row.sequence_index,
      mime_type: row.mime_type, width: row.width, height: row.height,
    })),
    source_ref: input.sourceRef, asset_group_ref: input.assetGroupRef, asset_format: input.assetFormat,
  };
  const settings: DistributionPublishSettings = {
    platform: "instagram", destination: null,
    content_type: defaults.contentType, aspect_ratio: defaults.aspectRatio,
    proof_restrictions: deriveProofRestrictions(masterRow),
    safety_checklist: [
      "Caption reviewed for accuracy and approved claims only",
      "No unapproved testimonials, metrics, or guarantees",
      "Media matches the approved asset group",
      "Destination account is the correct client profile",
    ],
    meta: {},
  };

  const now = new Date().toISOString();
  const record = {
    client_id: input.clientId, execution_month: input.executionMonth, source_ref: input.sourceRef,
    asset_group_ref: input.assetGroupRef, production_brief_id: input.productionBriefId,
    asset_format: input.assetFormat, title: input.title,
    publish_status: "ready" as const, platform: "instagram",
    planned_publish_date: plannedDate ?? null,
    publish_payload: payload as unknown as Record<string, unknown>,
    publish_settings: settings as unknown as Record<string, unknown>,
    updated_at: now,
  };
  const { data, error } = await supabase.from(DISTRIBUTION_TABLE)
    .upsert(record, { onConflict: "client_id,asset_group_ref" })
    .select("*").single();
  if (error) throw error;
  return data as DistributionRecordRow;
}

export async function fetchDistributionRecords(clientId: string, executionMonth: string): Promise<DistributionRecordRow[]> {
  const { data, error } = await supabase.from(DISTRIBUTION_TABLE).select("*")
    .eq("client_id", clientId).eq("execution_month", executionMonth).order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DistributionRecordRow[];
}

export async function fetchDistributionRecordByGroup(clientId: string, assetGroupRef: string): Promise<DistributionRecordRow | null> {
  const { data, error } = await supabase.from(DISTRIBUTION_TABLE).select("*")
    .eq("client_id", clientId).eq("asset_group_ref", assetGroupRef).maybeSingle();
  if (error) throw error;
  return (data as DistributionRecordRow | null) ?? null;
}

/** Save edited payload/settings/destination/planned date without publishing. */
export async function saveDistributionRecord(recordId: string, patch: {
  publishPayload?: Record<string, unknown>; publishSettings?: Record<string, unknown>;
  destination?: string | null; plannedPublishDate?: string | null;
}): Promise<DistributionRecordRow> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.publishPayload !== undefined) update.publish_payload = patch.publishPayload;
  if (patch.publishSettings !== undefined) update.publish_settings = patch.publishSettings;
  if (patch.destination !== undefined) update.destination = patch.destination;
  if (patch.plannedPublishDate !== undefined) update.planned_publish_date = patch.plannedPublishDate;
  const { data, error } = await supabase.from(DISTRIBUTION_TABLE).update(update).eq("id", recordId).select("*").single();
  if (error) throw error;
  return data as DistributionRecordRow;
}

/**
 * Schedule (no immediate publish): the scheduled worker publishes it when
 * `scheduled_publish_at` elapses via the shared publisher — no per-asset cron.
 */
export async function scheduleDistributionRecord(recordId: string, input: {
  scheduledPublishAt: string; publishPayload: Record<string, unknown>; publishSettings: Record<string, unknown>; destination?: string | null;
}): Promise<DistributionRecordRow> {
  const { data, error } = await supabase.from(DISTRIBUTION_TABLE).update({
    publish_status: "scheduled", publish_mode: "scheduled",
    scheduled_publish_at: input.scheduledPublishAt,
    publish_payload: input.publishPayload, publish_settings: input.publishSettings,
    destination: input.destination ?? null, last_error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", recordId).select("*").single();
  if (error) throw error;
  return data as DistributionRecordRow;
}

export async function cancelDistributionRecord(recordId: string): Promise<DistributionRecordRow> {
  const { data, error } = await supabase.from(DISTRIBUTION_TABLE).update({
    publish_status: "cancelled", updated_at: new Date().toISOString(),
  }).eq("id", recordId).select("*").single();
  if (error) throw error;
  return data as DistributionRecordRow;
}

export interface PublishResult {
  ok: boolean;
  status: PublishStatus | null;
  record?: DistributionRecordRow;
  missing_config?: string[];
  message?: string;
  error?: string;
}

/**
 * Manual Publish Now → the shared edge publisher. It checks Meta credentials
 * first and, if any are missing, returns `missing_config` WITHOUT marking the
 * record published. Success is only ever set by the edge function after a real
 * Meta API call — the frontend never fabricates a published state.
 */
export async function publishDistributionRecordNow(recordId: string, payloadOverrides: Record<string, unknown> = {}): Promise<PublishResult> {
  return invokeFn<PublishResult>("publish-instagram-asset", {
    distribution_record_id: recordId, mode: "publish_now", payload_overrides: payloadOverrides,
  });
}

export async function fetchAnalyticsRecords(clientId: string, executionMonth: string): Promise<AnalyticsRecordRow[]> {
  const { data, error } = await supabase.from("client_analytics_records").select("*")
    .eq("client_id", clientId).eq("execution_month", executionMonth).order("published_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AnalyticsRecordRow[];
}

export async function fetchAnalyticsRecordBySourceRef(clientId: string, executionMonth: string, sourceRef: string): Promise<AnalyticsRecordRow | null> {
  const { data, error } = await supabase.from("client_analytics_records").select("*")
    .eq("client_id", clientId).eq("execution_month", executionMonth).eq("source_ref", sourceRef).maybeSingle();
  if (error) throw error;
  return (data as AnalyticsRecordRow | null) ?? null;
}

/**
 * Save operator-entered metrics/notes/status on a published asset's analytics
 * row. Editing metrics never touches publish status and never auto-completes.
 * Only an explicit analytics_status = 'complete' advances the lifecycle:
 * snapshot the analytics stage + move pipeline state to `analysis` (iteration
 * readiness). No iteration output is generated.
 */
export async function saveAnalyticsRecord(record: AnalyticsRecordRow, patch: {
  metrics?: Record<string, unknown>; notes?: string | null; analyticsStatus?: AnalyticsStatus;
}): Promise<AnalyticsRecordRow> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.metrics !== undefined) update.metrics = patch.metrics;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.analyticsStatus !== undefined) update.analytics_status = patch.analyticsStatus;
  const { data, error } = await supabase.from("client_analytics_records").update(update).eq("id", record.id).select("*").single();
  if (error) throw error;
  const saved = data as AnalyticsRecordRow;

  if (patch.analyticsStatus === "complete") {
    // Snapshot analytics-as-left, then advance to the analysis/iteration stage.
    await createArchiveSnapshot({
      clientId: record.client_id, executionMonth: record.execution_month, sourceRef: record.source_ref,
      stage: "analytics", sourceTable: "client_analytics_records", sourceRowId: record.id,
      assetGroupRef: record.asset_group_ref, title: record.title, assetFormat: record.asset_format,
      snapshotData: { metrics: saved.metrics, published_url: saved.published_url, published_at: saved.published_at, notes: saved.notes },
      reason: "analytics_complete",
    }).catch(() => { /* best-effort memory */ });
    await upsertPipelineState({
      clientId: record.client_id, executionMonth: record.execution_month, sourceRef: record.source_ref,
      currentStage: "analysis", previousStage: "analytics", assetGroupRef: record.asset_group_ref,
      title: record.title, assetFormat: record.asset_format, transitionReason: "analytics_complete", stageChanged: true,
    }).catch(() => { /* best-effort */ });
  }
  return saved;
}

// ── PHASE H4: ARCHIVE LIFECYCLE + PIPELINE METRICS ───────────────────────────

export async function fetchAssetsBySourceRef(clientId: string, sourceRef: string): Promise<ClientAssetRow[]> {
  const { data, error } = await supabase.from("client_assets")
    .select("*, production_brief:client_production_briefs(production_mode,source_table,source_row_id)")
    .eq("client_id", clientId).eq("source_ref", sourceRef).order("created_at", { ascending: false }).order("sequence_index");
  if (error) throw error;
  return addSignedAssetUrls((data ?? []) as ClientAssetRow[]);
}

export async function fetchDistributionRecordBySourceRef(clientId: string, executionMonth: string, sourceRef: string): Promise<DistributionRecordRow | null> {
  const { data, error } = await supabase.from(DISTRIBUTION_TABLE).select("*")
    .eq("client_id", clientId).eq("execution_month", executionMonth).eq("source_ref", sourceRef)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return (data as DistributionRecordRow | null) ?? null;
}

export interface ArchiveDetail {
  sourceRef: string;
  pipelineState: PipelineStateRow | null;
  snapshots: ArchiveSnapshotRow[];
  master: { table: MasterTable; row: MasterRow } | null;
  brief: ProductionBriefRow | null;
  assets: ClientAssetRow[];
  distribution: DistributionRecordRow | null;
  analytics: AnalyticsRecordRow | null;
}

/**
 * The full lifecycle for one ref: current live records from every source table
 * PLUS the immutable stage snapshots. Nothing here writes, moves, or deletes.
 */
export async function fetchArchiveDetail(clientId: string, executionMonth: string, sourceRef: string): Promise<ArchiveDetail> {
  const [pipelineState, snapshots, master, brief, assets, distribution, analytics] = await Promise.all([
    fetchPipelineStateByRef(clientId, executionMonth, sourceRef).catch(() => null),
    fetchArchiveSnapshotsByRef(clientId, executionMonth, sourceRef).catch(() => [] as ArchiveSnapshotRow[]),
    fetchMasterRowByRef(clientId, sourceRef).catch(() => null),
    fetchProductionBriefBySourceRef(clientId, executionMonth, sourceRef).catch(() => null),
    fetchAssetsBySourceRef(clientId, sourceRef).catch(() => [] as ClientAssetRow[]),
    fetchDistributionRecordBySourceRef(clientId, executionMonth, sourceRef).catch(() => null),
    fetchAnalyticsRecordBySourceRef(clientId, executionMonth, sourceRef).catch(() => null),
  ]);
  return { sourceRef, pipelineState, snapshots, master, brief, assets, distribution, analytics };
}

export interface ArchiveIndexEntry {
  source_ref: string;
  title: string | null;
  asset_format: string | null;
  current_stage: PipelineStage;
  stages_present: PipelineStage[];
  latest_status: string;
  updated_at: string;
}

const REAL_STAGES: PipelineStage[] = ["master", "content_creation", "assets", "distribution", "analytics", "analysis"];

/**
 * Lifecycle index for the Archive tab. Includes every ref that has moved beyond
 * master (has a brief/asset/distribution/analytics or advanced pipeline state).
 * Pure aggregation — reads only.
 */
export async function fetchArchiveIndex(clientId: string, executionMonth: string): Promise<ArchiveIndexEntry[]> {
  const [stageMapResult, distributionResult, analyticsResult] = await Promise.allSettled([
    fetchEffectiveStageMap(clientId, executionMonth),
    fetchDistributionRecords(clientId, executionMonth),
    fetchAnalyticsRecords(clientId, executionMonth),
  ]);
  const stageMap = settledValue("archiveIndex:stageMap", stageMapResult, new Map<string, EffectiveStageEntry>());
  const distribution = settledValue("archiveIndex:distribution", distributionResult, [] as DistributionRecordRow[]);
  const analytics = settledValue("archiveIndex:analytics", analyticsResult, [] as AnalyticsRecordRow[]);
  const distByRef = new Map(distribution.map((row) => [row.source_ref, row]));
  const analyticsByRef = new Map(analytics.map((row) => [row.source_ref, row]));

  const entries: ArchiveIndexEntry[] = [];
  for (const entry of stageMap.values()) {
    const hasDist = distByRef.has(entry.source_ref);
    const hasAnalytics = analyticsByRef.has(entry.source_ref);
    // Only refs that have actually progressed belong in the lifecycle archive.
    if (stageRank(entry.stage) < stageRank("content_creation") && !hasDist && !hasAnalytics) continue;
    const stagesPresent = REAL_STAGES.filter((stage) => stageRank(stage) <= stageRank(entry.stage));
    const dist = distByRef.get(entry.source_ref);
    const ana = analyticsByRef.get(entry.source_ref);
    const latestStatus = ana ? `analytics: ${ana.analytics_status}` : dist ? `distribution: ${dist.publish_status}` : entry.stage;
    entries.push({
      source_ref: entry.source_ref, title: entry.title, asset_format: entry.asset_format,
      current_stage: entry.stage, stages_present: stagesPresent, latest_status: latestStatus, updated_at: entry.updated_at,
    });
  }
  return entries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export interface PipelineMetrics {
  active: Record<"master" | "content_creation" | "assets" | "distribution" | "analytics" | "analysis" | "completed", number>;
  totals: {
    entered: number; produced: number; approved: number;
    distributionReady: number; scheduled: number; published: number; analyticsComplete: number;
  };
}

/**
 * Active-per-stage counts + lifecycle totals, all derived from real records —
 * pipeline state, effective stage map, master rows, distribution and analytics
 * records. No invented numbers.
 */
export async function fetchPipelineMetrics(clientId: string, executionMonth: string): Promise<PipelineMetrics> {
  const [organic, stories, ads, stageMap, distribution, analytics] = await Promise.all([
    fetchOrganicMasterRows(clientId, executionMonth).catch(() => []),
    fetchStoryMasterRows(clientId, executionMonth).catch(() => []),
    fetchAdsMasterRows(clientId, executionMonth).catch(() => []),
    fetchEffectiveStageMap(clientId, executionMonth),
    fetchDistributionRecords(clientId, executionMonth).catch(() => []),
    fetchAnalyticsRecords(clientId, executionMonth).catch(() => []),
  ]);
  const masterRefs = [...organic, ...stories, ...ads].map((row) => row.ref);

  const active = { master: 0, content_creation: 0, assets: 0, distribution: 0, analytics: 0, analysis: 0, completed: 0 };
  // Master-only refs never enter the stage map; count them here.
  for (const ref of masterRefs) {
    const entry = stageMap.get(ref);
    if (!entry || entry.stage === "master") active.master += 1;
  }
  // Progressed refs are counted from their effective stage.
  for (const entry of stageMap.values()) {
    if (entry.stage in active && entry.stage !== "master") active[entry.stage as keyof typeof active] += 1;
  }

  let produced = 0, approved = 0;
  for (const entry of stageMap.values()) {
    if (entry.has_produced_asset) produced += 1;
    if (entry.has_approved_asset) approved += 1;
  }
  return {
    active,
    totals: {
      entered: masterRefs.length,
      produced, approved,
      distributionReady: distribution.filter((row) => row.publish_status === "ready").length,
      scheduled: distribution.filter((row) => row.publish_status === "scheduled").length,
      published: distribution.filter((row) => row.publish_status === "published").length,
      analyticsComplete: analytics.filter((row) => row.analytics_status === "complete").length,
    },
  };
}
