/**
 * Shared primitive types used across the domain.
 * Mirrors the real AA-OS Supabase schema in project xivewedajschthjlblfb.
 */

export type UUID = string;
export type ISODate = string;
export type ZAR = number;
export type Percent = number;

// 8-stage pipeline spine (order matters for the board display)
export type PipelineStage =
  | "source"
  | "cold"
  | "contacted"
  | "engaged"
  | "booked"
  | "onboarding"
  | "active"
  | "delivering";

// Not in the strip but exists as a terminal state
export type PipelineStageOrChurned = PipelineStage | "churned";

export type Channel = "instagram" | "whatsapp" | "email" | "sms";

export type Tier = "proof_sprint" | "proof_brand" | "authority_brand";

export type Role = "admin" | "delivery" | "distribution" | "client";

export const PIPELINE_STAGES: PipelineStage[] = [
  "source",
  "cold",
  "contacted",
  "engaged",
  "booked",
  "onboarding",
  "active",
  "delivering",
];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  source: "Source",
  cold: "Cold",
  contacted: "Contacted",
  engaged: "Engaged",
  booked: "Booked",
  onboarding: "Onboarding",
  active: "Active",
  delivering: "Delivering",
};

export const CHANNEL_LABELS: Record<Channel, string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  email: "Email",
  sms: "SMS",
};

export const TIER_LABELS: Record<Tier, string> = {
  proof_sprint: "Proof Sprint",
  proof_brand: "Proof Brand",
  authority_brand: "Authority Brand",
};
