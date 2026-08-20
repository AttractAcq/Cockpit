// Stage 2 Phase 03 — Automations, surfaced. A read-mostly observability
// layer over the cron/edge-function runtime that already exists. No new
// execution infrastructure: the Workflows list is the existing governed
// edge-function registry (already CI-enforced, already the source of
// truth); the Triggers list is pg_cron's real job table via a staff-only
// RPC. Nothing here invents a new workflow engine.

import registryJson from "../../supabase/functions/registry.json";
import { supabase } from "./supabase";

export interface WorkflowEntry {
  name: string;
  purpose: string;
  system: string;
  page: string;
  profile: string;
  databaseDomains: string[];
  externalProviders: string[];
}

export function fetchWorkflows(): WorkflowEntry[] {
  const registry = registryJson as { functions: WorkflowEntry[] };
  return registry.functions;
}

export interface ScheduledTrigger {
  jobname: string;
  schedule: string;
  active: boolean;
  target_function: string | null;
}

export async function fetchScheduledTriggers(): Promise<ScheduledTrigger[]> {
  const { data, error } = await supabase.rpc("list_scheduled_triggers");
  if (error) throw error;
  return (data ?? []) as ScheduledTrigger[];
}

// Deployed on xivewedajschthjlblfb but absent from this repo's registry as
// of the Stage 2 Phase 03 audit (2026-08-20) -- found by diffing
// list_edge_functions against the local registry, not something the
// running frontend can detect on its own (that needs Management API /
// service-role access this app never holds). Recorded here as a static,
// dated finding so it stays visible rather than silently disappearing the
// next time someone looks at "what's running." Re-audit before trusting
// this list at a later date -- it will drift.
export interface UndocumentedDeployment {
  slug: string;
  category: "unmerged_branch" | "retired_undeleted";
  note: string;
}

export const UNDOCUMENTED_DEPLOYMENTS: UndocumentedDeployment[] = [
  {
    slug: "collect-facebook-insights",
    category: "unmerged_branch",
    note: "Cron-triggered hourly (facebook-insights-worker) against real Meta accounts. verify_jwt=false at the platform level, but the function has its own CRON_SECRET/JWT auth internally, matching collect-instagram-insights' established pattern.",
  },
  { slug: "connect-facebook-page-destination", category: "unmerged_branch", note: "No cron trigger found; reachable only from other Stage 1B functions, which are themselves unreachable from main." },
  { slug: "create-facebook-rendition", category: "unmerged_branch", note: "No cron trigger found." },
  { slug: "update-facebook-rendition", category: "unmerged_branch", note: "No cron trigger found." },
  { slug: "review-facebook-rendition", category: "unmerged_branch", note: "No cron trigger found." },
  { slug: "discover-facebook-pages", category: "unmerged_branch", note: "No cron trigger found." },
  { slug: "publish-facebook-asset", category: "unmerged_branch", note: "No cron trigger found." },
  { slug: "verify-facebook-destination-capability", category: "unmerged_branch", note: "No cron trigger found." },
  { slug: "create-distribution-record-from-facebook-rendition", category: "unmerged_branch", note: "No cron trigger found." },
  { slug: "manage-platform-experiment", category: "unmerged_branch", note: "No cron trigger found." },
  { slug: "approve-calendar-proposal", category: "retired_undeleted", note: "Retired by the Ideation Phase 6 migration (DB objects dropped); no frontend caller; still deployed only because no delete_edge_function tool was available in the session that retired it." },
  { slug: "create-calendar-proposal", category: "retired_undeleted", note: "Same Ideation Phase 6 retirement as approve-calendar-proposal." },
  { slug: "update-calendar-proposal-slot", category: "retired_undeleted", note: "Same Ideation Phase 6 retirement as approve-calendar-proposal." },
  { slug: "create-content-opportunity", category: "retired_undeleted", note: "Retired by the Pipeline B retirement (nav consolidation Phase 5); DB objects dropped, no frontend caller." },
  { slug: "generate-content-opportunities", category: "retired_undeleted", note: "Same Pipeline B retirement as create-content-opportunity." },
  { slug: "score-content-opportunity", category: "retired_undeleted", note: "Same Pipeline B retirement as create-content-opportunity." },
  { slug: "update-content-opportunity-status", category: "retired_undeleted", note: "Same Pipeline B retirement as create-content-opportunity." },
  { slug: "create-distribution-record-from-content-item", category: "retired_undeleted", note: "Same Pipeline B retirement as create-content-opportunity." },
  { slug: "generate-content-brief", category: "retired_undeleted", note: "Superseded by generate-production-brief; no frontend caller." },
  { slug: "review-content-brief", category: "retired_undeleted", note: "Superseded by generate-production-brief; no frontend caller." },
  { slug: "route-content-brief-to-studio", category: "retired_undeleted", note: "Retired with Production Studio (nav consolidation Phase 5)." },
  { slug: "submit-production-review", category: "retired_undeleted", note: "Retired with Production Studio (nav consolidation Phase 5)." },
];
