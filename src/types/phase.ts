import type { ReviewState } from "./client";
import type { ExecutionFileCode } from "../../supabase/functions/_shared/execution-manifest";

export type ContextFileStatus =
  | "not_started"
  | "generating"
  | "generated"
  | "needs_review"
  | "approved"
  | "needs_client_input";

export interface ClientInputs {
  id: string;
  client_id: string;
  business_description: string | null;
  website_url: string | null;
  social_links: Record<string, string>;
  offer_details: string | null;
  target_customer: string | null;
  geography: string | null;
  proof_notes: string | null;
  testimonials_notes: string | null;
  reviews_notes: string | null;
  case_studies_notes: string | null;
  before_after_notes: string | null;
  founder_team_notes: string | null;
  current_problems: string | null;
  uploaded_file_refs: string[];
  sales_process: string | null;
  current_marketing: string | null;
  brand_voice: string | null;
  competitors: string | null;
  constraints_approval_rules: string | null;
  raw_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientContextFile {
  id: string;
  client_id: string;
  file_number: number;
  file_name: string;
  content_md: string | null;
  storage_path: string | null;
  status: ContextFileStatus;
  confidence_level: string | null;
  generated_by_function: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ClientExecutionFile {
  id: string;
  client_id: string;
  month: string;
  file_name: string;
  file_number: number | null;
  file_type: string | null;
  content_md: string | null;
  status: string | null;
  review_state: ReviewState;
  version: number;
  generated_by_agent: string | null;
  generated_by_function: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganicMasterRow {
  id: string;
  client_id: string;
  month: string;
  ref: string;
  review_state: ReviewState;
  status: string;
  content_type: string;
  archetype: string | null;
  pillar: string | null;
  working_title: string | null;
  the_one_person: string | null;
  one_belief_to_change: string | null;
  hook: string | null;
  core_message: string | null;
  cta: string | null;
  storyboard_outline: string | null;
  caption_script: string | null;
  source_origin: string | null;
  distribution_date: string | null;
  distribution_channel: string | null;
  production_date: string | null;
  edit_date: string | null;
  production_brief: string | null;
  psychological_angle: string | null;
  repurposed_from_to: string | null;
  format_proven: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoryMasterRow {
  id: string;
  client_id: string;
  month: string;
  ref: string;
  review_state: ReviewState;
  status: string;
  story_type: string | null;
  story_theme: string | null;
  pillar: string | null;
  frame_1: string | null;
  frame_2: string | null;
  frame_3: string | null;
  frame_4_optional: string | null;
  cta_engagement_prompt: string | null;
  proof_used: string | null;
  source_origin: string | null;
  distribution_date: string | null;
  repurposed_from_to: string | null;
  what_not_to_claim: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdsMasterRow {
  id: string;
  client_id: string;
  month: string;
  ref: string;
  review_state: ReviewState;
  status: string;
  lane: string;
  stint_name: string | null;
  objective: string | null;
  funnel_stage: string | null;
  start_date: string | null;
  end_date: string | null;
  days: number | null;
  budget_split: string | null;
  primary_goal: string | null;
  conversion_action: string | null;
  meta_objective: string | null;
  audience: string | null;
  creative_source: string | null;
  hook_angle: string | null;
  kpi_watch: string | null;
  feeds_into: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProofMasterRow {
  id: string;
  client_id: string;
  month: string | null;
  ref: string;
  review_state: ReviewState;
  status: string;
  proof_type: string | null;
  proof_asset_name: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetBriefRow {
  id: string;
  client_id: string;
  execution_month: string;
  brief_id: string;
  source_ref: string;
  source_ref_type: string;
  asset_type: string | null;
  production_status: string;
  status: ReviewState;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarCellRow {
  id: string;
  client_id: string;
  month: string;
  date: string;
  row_type: string;
  ref: string;
  review_state: ReviewState;
  created_at: string;
  updated_at: string;
}

export type PhaseMode =
  | "stub"
  | "contract_ready"
  | "blocked"
  | "generated"
  | "started"
  | "generation_started"
  | "section_generated"
  | "file_generated"
  | "error";

export type Phase2Section = ExecutionFileCode;

export type Phase3Section =
  | "organic_reels_1"
  | "organic_reels_2"
  | "organic_reels_3"
  | "organic_reels_4"
  | "organic_carousels_1"
  | "organic_carousels_2"
  | "organic_feed_posts_1"
  | "organic_feed_posts_2"
  | "stories_education_1"
  | "stories_education_2"
  | "stories_conversion_1"
  | "stories_conversion_2"
  | "ads"
  | "calendar";

export type MasterTable = "organic_master" | "story_master" | "ads_master";
export type MasterRow = OrganicMasterRow | StoryMasterRow | AdsMasterRow;

export type AssetFormat = "ad_static" | "reel_video" | "story_sequence" | "carousel" | "feed_post";
export type ProductionMode = "human" | "ai";
export type ProductionStatus = "brief" | "assigned_human" | "ai_ready" | "producing" | "produced" | "failed";

export interface ProductionBriefRow {
  id: string;
  client_id: string;
  execution_month: string;
  source_table: MasterTable;
  source_row_id: string;
  source_ref: string;
  asset_format: AssetFormat;
  title: string;
  content_md: string;
  status: ReviewState;
  production_mode: ProductionMode | null;
  production_status: ProductionStatus;
  version: number;
  generated_by_function: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Phase1Result {
  ok: boolean;
  mode: PhaseMode;
  client_id?: string;
  message: string;
  warnings: string[];
  missingInputs: string[];
  error?: string;
  data?: Record<string, unknown>;
}

export interface Phase2Result {
  ok: boolean;
  mode: PhaseMode;
  client_id?: string;
  execution_month?: string;
  message: string;
  warnings: string[];
  missingContextFiles: string[];
  error?: string;
  data?: Record<string, unknown>;
}

export type Phase3Result = Phase2Result;

/** @deprecated use Phase1Result */
export type Phase1StubResult = Phase1Result;
/** @deprecated use Phase2Result */
export type Phase2StubResult = Phase2Result;

export const CONTEXT_FILE_DEFS: Array<{ number: number; file_name: string; title: string }> = [
  { number: 0,  file_name: "00_Master_Client_Context.md",                 title: "Master Client Context" },
  { number: 1,  file_name: "01_Business_Context.md",                      title: "Business Context" },
  { number: 2,  file_name: "02_Avatar_And_Buyer_Psychology.md",            title: "Avatar & Buyer Psychology" },
  { number: 3,  file_name: "03_Offer_And_Sales_Context.md",                title: "Offer & Sales Context" },
  { number: 4,  file_name: "04_Proof_Bank.md",                             title: "Proof Bank" },
  { number: 5,  file_name: "05_Proof_Gap_Report.md",                       title: "Proof Gap Report" },
  { number: 6,  file_name: "06_Positioning_And_Angle_Map.md",              title: "Positioning & Angle Map" },
  { number: 7,  file_name: "07_Brand_Voice_And_Style_Guide.md",            title: "Brand Voice & Style Guide" },
  { number: 8,  file_name: "08_Profile_Funnel_Context.md",                 title: "Profile Funnel Context" },
  { number: 9,  file_name: "09_Content_System.md",                         title: "Content System" },
  { number: 10, file_name: "10_Story_System.md",                           title: "Story System" },
  { number: 11, file_name: "11_Ad_System.md",                              title: "Ad System" },
  { number: 12, file_name: "12_Website_And_Landing_Page_Context.md",       title: "Website & Landing Page Context" },
  { number: 13, file_name: "13_Distribution_System.md",                    title: "Distribution System" },
  { number: 14, file_name: "14_Automation_And_AI_Instructions.md",         title: "Automation & AI Instructions" },
  { number: 15, file_name: "15_Content_Calendar.md",                       title: "Content Calendar" },
  { number: 16, file_name: "16_Performance_Report.md",                     title: "Performance Report" },
  { number: 17, file_name: "17_Iteration_Log.md",                          title: "Iteration Log" },
  { number: 18, file_name: "18_Client_Comms_And_Approval_Context.md",      title: "Client Comms & Approval Context" },
  { number: 19, file_name: "19_Sales_Enablement_Assets.md",                title: "Sales Enablement Assets" },
  { number: 20, file_name: "20_Retention_Upsell_And_Expansion_Context.md", title: "Retention, Upsell & Expansion Context" },
];
