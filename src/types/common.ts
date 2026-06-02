/**
 * Shared primitive types used across the domain.
 * Mirrors Supabase schema patterns from AA-OS where applicable.
 */

export type UUID = string;
export type ISODate = string; // e.g. "2026-05-28T14:32:00Z"
export type ZAR = number; // amount in Rand (whole units, e.g. 4200 = R 4,200)
export type Percent = number; // 0-100

export type PipelineStage =
  | "cold"
  | "contacted"
  | "engaged"
  | "booked"
  | "onboarding"
  | "active"
  | "delivering"
  | "churned";

export type Channel = "instagram" | "whatsapp" | "email" | "sms";

export type Tier = "proof_sprint" | "proof_brand" | "authority_brand";

export type Role = "admin" | "delivery" | "distribution" | "client";

export const PIPELINE_STAGES: PipelineStage[] = [
  "cold",
  "contacted",
  "engaged",
  "booked",
  "onboarding",
  "active",
  "delivering",
];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  cold: "Cold",
  contacted: "Contacted",
  engaged: "Engaged",
  booked: "Booked",
  onboarding: "Onboarding",
  active: "Active",
  delivering: "Delivering",
  churned: "Churned",
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
