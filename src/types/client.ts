export type PackageTier = 'proof_sprint' | 'proof_brand' | 'proof_brand_scale';
export type ClientStatus = 'prospect' | 'active' | 'paused' | 'churned';
export type StageStatus = 'not_run' | 'running' | 'complete' | 'error';
export type ReviewState = 'needs_review' | 'approved' | 'rejected' | 'archived';
export type UserRole = 'admin' | 'account_manager' | 'editor' | 'client';
export type IntegrationStatus = 'not_configured' | 'configured' | 'error';
export type AutomationType =
  | 'marketing_intelligence'
  | 'creative_intelligence'
  | 'story_intelligence'
  | 'distribution'
  | 'opportunity_detector'
  | 'ai_receptionist';

export interface Client {
  id: string;
  name: string;
  slug: string;
  is_internal_client: boolean;
  package_tier: PackageTier;
  status: ClientStatus;
  account_manager_id: string | null;
  geography: string | null;
  primary_platform: string | null;
  secondary_platform: string | null;
  stage1_status: StageStatus;
  stage1_completed_at: string | null;
  stage2_status: StageStatus;
  stage2_completed_at: string | null;
  health_score: number;
  health_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateClientPayload {
  name: string;
  slug: string;
  package_tier: PackageTier;
  geography?: string;
  primary_platform?: string;
  secondary_platform?: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  avatar_url: string | null;
  created_at: string;
}

export interface ActivityLogEntry {
  id: string;
  client_id: string | null;
  actor_id: string | null;
  event_type: string;
  plain_english_message: string;
  object_type: string | null;
  object_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  clients?: { name: string; slug: string } | null;
  users?: { full_name: string | null; email: string } | null;
}

export interface Integration {
  id: string;
  name: string;
  status: IntegrationStatus;
  notes: string | null;
}

export interface Automation {
  id: string;
  client_id: string;
  automation_type: AutomationType;
  enabled: boolean;
  configured: boolean;
  status: string;
  last_run_at: string | null;
  last_error: string | null;
}

export interface ClientHealth {
  id: string;
  name: string;
  slug: string;
  package_tier: PackageTier;
  status: ClientStatus;
  stage1_status: StageStatus;
  stage2_status: StageStatus;
  health_score: number;
}

export const TIER_LABELS: Record<PackageTier, string> = {
  proof_sprint: 'Proof Sprint',
  proof_brand: 'Proof Brand',
  proof_brand_scale: 'Proof Brand Scale',
};

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  not_run: 'Not Run',
  running: 'Running',
  complete: 'Complete',
  error: 'Error',
};
