/**
 * The mockApi facade — single import point for all data access.
 *
 * Phase 2 (Claude Code backend wiring) replaces each underlying function body
 * with a Supabase query while keeping these call signatures identical.
 *
 * Example future replacement for `mockApi.clients.list()`:
 *
 *   async list(): Promise<Entity[]> {
 *     const { data, error } = await supabase
 *       .from("entities")
 *       .select("*")
 *       .order("updated_at", { ascending: false });
 *     if (error) throw error;
 *     return data;
 *   }
 */

import { clientsApi } from "./clients";
import { conversationsApi } from "./conversations";
import { campaignsApi } from "./campaigns";
import { triageApi } from "./triage";
import { operationsApi } from "./operations";
import { pulseApi } from "./pulse";
import { studioApi } from "./assets";

export const mockApi = {
  clients: clientsApi,
  conversations: conversationsApi,
  campaigns: campaignsApi,
  triage: triageApi,
  operations: operationsApi,
  pulse: pulseApi,
  studio: studioApi,
};

export type MockApi = typeof mockApi;
