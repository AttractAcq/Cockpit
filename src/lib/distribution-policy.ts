// Programme Stage K — Organic Distribution Consolidation data access.

import { supabase, invokeFn } from "./supabase";
import type { ClientDistributionPolicyRow, ApprovalMode, BlackoutPeriod } from "@/types/distribution-policy";

export async function fetchClientDistributionPolicy(clientId: string): Promise<ClientDistributionPolicyRow | null> {
  const { data, error } = await supabase.from("client_distribution_policies").select("*").eq("client_id", clientId).maybeSingle();
  if (error) throw error;
  return (data as ClientDistributionPolicyRow | null) ?? null;
}

export async function setClientDistributionPolicy(input: {
  clientId: string;
  approvalMode: ApprovalMode;
  autoScheduleAfterApproval: boolean;
  manualPublishOnly: boolean;
  blackoutPeriods: BlackoutPeriod[];
  restrictedWeekdays: number[];
}): Promise<{ ok: true; policy: ClientDistributionPolicyRow }> {
  return await invokeFn("set-client-distribution-policy", {
    client_id: input.clientId,
    approval_mode: input.approvalMode,
    auto_schedule_after_approval: input.autoScheduleAfterApproval,
    manual_publish_only: input.manualPublishOnly,
    blackout_periods: input.blackoutPeriods,
    restricted_weekdays: input.restrictedWeekdays,
  });
}
