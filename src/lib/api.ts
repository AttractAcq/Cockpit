// src/lib/api.ts
// LIVE data layer — every method maps to the real AA-OS Supabase schema.
// Pipeline spine (8 stages): source · cold · contacted · engaged · booked · onboarding · active · delivering
import { supabase, invokeFn } from "./supabase";

// Helper: normalise entity_name from Supabase foreign-key joins
function entityName(row: Record<string, unknown>): string | null {
  const ent = row.entities as { business_name?: string } | null;
  return ent?.business_name ?? (row.entity_name as string | null) ?? null;
}

export const api = {
  // ----- TRIAGE -----
  triage: {
    async list() {
      const { data, error } = await supabase
        .from("triage_items")
        .select("*, entities(business_name, stage, niche)")
        .eq("status", "open")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        entity_name: entityName(row as Record<string, unknown>),
      }));
    },
    async resolve(id: string) {
      const { error } = await supabase
        .from("triage_items")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
  },

  // ----- CLIENTS / PROSPECTS (unified entities table) -----
  clients: {
    async list() {
      const { data, error } = await supabase
        .from("entities").select("*").eq("kind", "client")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    async byId(id: string) {
      const { data, error } = await supabase
        .from("entities").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
    async stageCounts() {
      const { data, error } = await supabase
        .from("entities").select("stage");
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        counts[row.stage] = (counts[row.stage] ?? 0) + 1;
      }
      return counts;
    },
  },
  prospects: {
    async list() {
      const { data, error } = await supabase
        .from("entities").select("*").eq("kind", "prospect")
        .order("icp_fit_score", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  },
  entities: {
    async list() {
      const { data, error } = await supabase
        .from("entities").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    async byStage() {
      const { data, error } = await supabase
        .from("entities")
        .select("id, business_name, kind, stage, niche, city, icp_fit_score, contact_name, whatsapp_number, instagram_handle, email, source, created_at, updated_at, notes");
      if (error) throw error;
      return data ?? [];
    },
    async advanceStage(id: string, stage: string) {
      const { error } = await supabase.from("entities").update({ stage }).eq("id", id);
      if (error) throw error;
    },
  },

  // ----- CONVERSATIONS / INBOX -----
  conversations: {
    async list() {
      const { data, error } = await supabase
        .from("conversations")
        .select("*, entities(business_name)")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        entity_name: entityName(row as Record<string, unknown>),
      }));
    },
    async byId(id: string) {
      const { data, error } = await supabase
        .from("conversations")
        .select("*, entities(business_name)")
        .eq("id", id).single();
      if (error) throw error;
      if (!data) return null;
      return {
        ...data,
        entity_name: entityName(data as Record<string, unknown>),
      };
    },
    async messages(conversationId: string) {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("sent_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    async send(args: { entity_id: string; conversation_id?: string; to: string; body: string; client_slug?: string }) {
      return invokeFn("dialog360-send", { ...args, approved: true });
    },
  },

  // ----- CAMPAIGNS -----
  campaigns: {
    async list() {
      const { data, error } = await supabase
        .from("campaigns").select("*, entities(business_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        entity_name: entityName(row as Record<string, unknown>),
      }));
    },
    async byId(id: string) {
      const { data, error } = await supabase
        .from("campaigns").select("*, ad_metrics(*), entities(business_name)").eq("id", id).single();
      if (error) throw error;
      if (!data) return null;
      return { ...data, entity_name: entityName(data as Record<string, unknown>) };
    },
    async create(args: { entity_id: string; client_slug?: string; params: Record<string, unknown> }) {
      return invokeFn("meta-ad-ops", { action: "create_campaign", ...args });
    },
    async pause(args: { entity_id: string; campaign_id: string }) {
      return invokeFn("meta-ad-ops", { action: "pause", ...args });
    },
  },

  // ----- STUDIO (assets + briefs) -----
  assets: {
    async list() {
      const { data, error } = await supabase
        .from("assets").select("*, entities(business_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        entity_name: entityName(row as Record<string, unknown>),
      }));
    },
    async approve(id: string) {
      const { error } = await supabase.from("assets").update({ status: "approved" }).eq("id", id);
      if (error) throw error;
    },
    async reject(id: string) {
      const { error } = await supabase.from("assets").update({ status: "draft" }).eq("id", id);
      if (error) throw error;
    },
  },
  // Alias: some scaffold code used mockApi.studio
  get studio() { return this.assets; },

  briefs: {
    async list() {
      const { data, error } = await supabase
        .from("briefs").select("*, entities(business_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
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

  // ----- OPERATIONS (automations + agent trail) -----
  operations: {
    async automations() {
      const { data, error } = await supabase
        .from("automations").select("*, entities(business_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    async runScrape() {
      return invokeFn("apify-scrape", {});
    },
    // Compatibility alias — scaffold called mockApi.operations.agentEvents(limit)
    async agentEvents(limit = 100) {
      const { data, error } = await supabase
        .from("agent_events").select("*, entities(business_name)")
        .order("created_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  },
  agentEvents: {
    async list(limit = 100) {
      const { data, error } = await supabase
        .from("agent_events").select("*, entities(business_name)")
        .order("created_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  },

  // ----- PULSE / MONEY -----
  pulse: {
    async metrics() {
      const { data, error } = await supabase
        .from("pulse_metrics").select("*")
        .order("metric_date", { ascending: false }).limit(200);
      if (error) throw error;
      return data ?? [];
    },
  },
  money: {
    async mrr() {
      const { data, error } = await supabase
        .from("mrr_snapshots").select("*")
        .order("snapshot_date", { ascending: false }).limit(90);
      if (error) throw error;
      return data ?? [];
    },
    async revenueByClient() {
      const { data, error } = await supabase
        .from("contracts")
        .select("entity_id, mrr_cents, tier, status, entities(business_name)")
        .eq("status", "active");
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        entity_name: entityName(row as Record<string, unknown>),
      }));
    },
  },

  // ----- ONBOARDING (deposit gate) -----
  onboarding: {
    async start(args: { entity_id: string; amount_cents: number; tier?: string }) {
      return invokeFn("onboarding", args);
    },
  },
};

export type Api = typeof api;
