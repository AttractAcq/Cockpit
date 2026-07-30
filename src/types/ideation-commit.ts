// Ideation Stage 4 — commit types shared by the panel, the API client, and the
// request coordinator. Type-only: this module holds no runtime value, so it can
// be imported from anywhere without pulling code into a bundle.

export type IdeationCommitStatus = "running" | "completed" | "failed";

export type IdeationCommitAssetType = "reel" | "carousel" | "static" | "story";

export type IdeationCommitMasterTable = "organic_master" | "story_master";

export interface IdeationCommitRun {
  id: string;
  client_id: string;
  ideation_cycle_id: string;
  scoring_run_id: string;
  proposal_id: string;
  status: IdeationCommitStatus;
  proposal_version: number;
  proposal_edit_revision: number;
  period_start: string;
  period_end: string;
  expected_item_count: number;
  committed_item_count: number;
  organic_item_count: number;
  story_item_count: number;
  failed_item_count: number;
  failure_code: string | null;
  failure_message: string | null;
  failed_proposal_slot_key: string | null;
  warnings: unknown[];
  completed_at: string | null;
  failed_at: string | null;
  created_at: string;
}

export interface IdeationCommitItem {
  id: string;
  commit_run_id: string;
  proposal_slot_id: string;
  proposal_slot_key: string;
  candidate_id: string;
  candidate_rank_snapshot: number;
  candidate_score_snapshot: number;
  asset_type: IdeationCommitAssetType;
  target_master_table: IdeationCommitMasterTable;
  target_master_id: string;
  target_calendar_cell_id: string;
  calendar_row_type: string;
  operational_ref: string;
  committed_date: string;
  execution_month: string;
}

export interface IdeationCommitFailure {
  code: string;
  message: string;
  retryable: boolean;
  commit_run_id: string | null;
  proposal_id: string | null;
  ideation_cycle_id: string | null;
  scoring_run_id: string | null;
  commit_status: string | null;
  expected_item_count: number;
  committed_item_count: number;
  organic_item_count: number;
  story_item_count: number;
  failed_item_count: number;
  current_edit_revision: number | null;
  failed_proposal_slot_key: string | null;
  warnings: unknown[];
  details: Record<string, unknown> | null;
}

export interface IdeationCommitResponse {
  ok: boolean;
  function: string;
  committed: boolean;
  replayed?: boolean;
  commit_run_id?: string;
  commit?: IdeationCommitRun;
  items?: IdeationCommitItem[];
  message?: string;
  error?: IdeationCommitFailure;
}

export interface IdeationCommitOverview {
  runs: IdeationCommitRun[];
  items: IdeationCommitItem[];
}

export interface IdeationCommitRequest {
  client_id: string;
  proposal_id: string;
  expected_edit_revision: number;
  confirm_commit: true;
}
