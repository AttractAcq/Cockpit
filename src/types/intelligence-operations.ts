import type { IntelligenceDomain, IntelligenceFreshness, IntelligenceReleaseStatus } from "./intelligence";

export interface IntelligenceOperationalStatus {
  client_id: string;
  client_name: string;
  intelligence_domain: IntelligenceDomain;
  active_release_id: string | null;
  active_version: number | null;
  approved_at: string | null;
  latest_release_id: string | null;
  latest_version: number | null;
  latest_release_status: IntelligenceReleaseStatus | null;
  latest_run_status: string | null;
  failure_code: string | null;
  failure_message: string | null;
  refresh_interval_days: number | null;
  due_warning_days: number | null;
  scheduled_refresh_enabled: boolean | null;
  freshness: IntelligenceFreshness;
  dependency_status: "missing" | "current" | "drifted";
  refresh_pending: boolean;
  pending_proposal_count: number;
}

export interface IntelligenceRefreshRequest {
  id: string;
  client_id: string;
  intelligence_domain: IntelligenceDomain;
  request_type: "manual" | "scheduled" | "dependency";
  status: "requested" | "claimed" | "completed" | "cancelled" | "failed";
  reason: string;
  source_release_id: string | null;
  requested_at: string;
  failure_code: string | null;
  failure_message: string | null;
  metadata: Record<string, unknown>;
}

export interface IntelligenceChangeProposal {
  id: string;
  client_id: string;
  target_kind: "context" | "intelligence";
  target_domain: IntelligenceDomain | null;
  target_release_id: string | null;
  proposal_type: "correct" | "add" | "retire" | "investigate" | "refresh";
  title: string;
  summary: string;
  rationale: string;
  evidence: Record<string, unknown>;
  priority: "low" | "normal" | "high" | "urgent";
  status: "needs_review" | "approved" | "dismissed" | "converted_to_draft";
  source_type: string;
  source_key: string | null;
  reviewer_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface IntelligenceConsumption {
  id: string;
  client_id: string;
  consumer_type: string;
  consumer_key: string;
  purpose: string;
  authority_snapshot: Record<string, unknown>;
  consumed_at: string;
  invalidated_at: string | null;
  invalidation_reason: string | null;
}
