// Stage 2 Phase 02 — Business Selector data access. Reads businesses
// directly (RLS-scoped, staff-only); writes go through the admin-only
// create_business RPC, matching the established direct-supabase.rpc(...)
// convention for this class of administrative operation.

import { supabase } from "./supabase";
import type { BusinessRow } from "@/types/business";

export async function fetchBusinesses(): Promise<BusinessRow[]> {
  const { data, error } = await supabase.from("businesses").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as BusinessRow[];
}

export async function fetchBusiness(id: string): Promise<BusinessRow | null> {
  const { data, error } = await supabase.from("businesses").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as BusinessRow | null) ?? null;
}

export async function createBusiness(name: string, slug: string, clientId: string | null): Promise<string> {
  const { data, error } = await supabase.rpc("create_business", { p_name: name, p_slug: slug, p_client_id: clientId });
  if (error) throw error;
  return data as string;
}
