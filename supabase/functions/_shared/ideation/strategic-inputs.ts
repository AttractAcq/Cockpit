import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createEvidenceSource, type IdeationEvidenceSource } from "./evidence.ts";
import { sha256, stableJson } from "./hash.ts";

export type SourceKind = "campaign_intelligence" | "main_offer" | "seasonal_offer" | "avatar";
const ALL_SOURCE_KINDS: SourceKind[] = ["campaign_intelligence", "main_offer", "seasonal_offer", "avatar"];

interface CampaignPeriodRow {
  id: string;
  release_id: string;
  title: string;
  strategic_theme: string;
  timing_label: string;
  icp_context: string;
  emotional_states: string[];
  pain_point_salience: string[];
  desired_outcome: string;
  awareness_shift: string;
  strategic_messaging_direction: string;
  positioning_direction: string;
  campaign_objective: string;
  customer_journey_stage: string;
  display_order: number;
}

interface MainOfferRow {
  id: string;
  release_id: string;
  offer_name: string;
  offer_role: string;
  offer_stage: string;
  customer_segment: string;
  problem_addressed: string;
  promised_outcome: string;
  mechanism: string;
  dream_outcome: string;
  perceived_likelihood: string;
  time_delay: string;
  effort_sacrifice: string;
  price_risk_friction: string;
  value_stack: string[];
  bonus_stack: string[];
  risk_reversal: string;
  guarantee: string;
  pricing_model: string;
  delivery_model: string;
  proof_requirements: string;
  offer_sequence_note: string;
  money_model_notes: string;
  display_order: number;
}

interface SeasonalOfferRow {
  id: string;
  release_id: string;
  campaign_period_id: string;
  main_offer_id: string | null;
  title: string;
  campaign_period_title: string;
  offer_angle: string;
  packaging_direction: string;
  urgency_driver: string;
  bonus_direction: string;
  positioning_direction: string;
  mechanism_direction: string;
  reason_to_act_now: string;
  cta_direction: string;
  offer_risk: string;
  display_order: number;
}

interface ReleaseRow {
  id: string;
  version: number;
  title: string;
  summary: string;
  approved_at: string;
}

type AvatarComponentType =
  | "avatar_strategy"
  | "appearance"
  | "environment"
  | "voice_personality"
  | "creative_direction"
  | "knowledge_expertise"
  | "content_format"
  | "asset_library";

interface AvatarComponentRow {
  id: string;
  release_id: string;
  component_type: AvatarComponentType;
  component_key: string;
  title: string;
  summary: string;
  strategic_rationale: string;
  evidence_summary: string;
  structured_payload: Record<string, unknown>;
  display_order: number;
}

export interface IdeationStrategicInput {
  source_kind: SourceKind;
  source_release_id: string;
  campaign_period_id: string | null;
  main_offer_id: string | null;
  seasonal_offer_id: string | null;
  avatar_component_id: string | null;
  title: string;
  summary: string;
  source_url: string;
  payload: Record<string, unknown>;
  display_order: number;
}

export interface IdeationStrategicInputPack {
  inputs: IdeationStrategicInput[];
  evidenceSources: IdeationEvidenceSource[];
  snapshot: {
    policy: string;
    counts: Record<SourceKind, number>;
    inputs: Array<{
      source_kind: SourceKind;
      source_release_id: string;
      source_entity_id: string | null;
      title: string;
      content_hash: string;
    }>;
  };
}

function textLines(lines: Array<string | null | undefined>): string {
  return lines.filter((line): line is string => typeof line === "string" && line.trim().length > 0).join("\n");
}

function shortList(values: string[] | null | undefined): string {
  return Array.isArray(values) && values.length ? values.join(", ") : "";
}

function payloadText(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function payloadList(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).join(", ")
    : "";
}

function avatarComponentExcerpt(component: AvatarComponentRow, release: ReleaseRow): string {
  const payload = component.structured_payload;
  const base = [
    `Avatar OS v${release.version}: ${release.title}`,
    `Component: ${component.title}`,
    `Component type: ${component.component_type}`,
    `Summary: ${component.summary}`,
    `Strategic rationale: ${component.strategic_rationale}`,
    `Evidence summary: ${component.evidence_summary}`,
  ];
  const componentLines: Record<AvatarComponentType, string[]> = {
    avatar_strategy: [
      `Avatar recommendation: ${payloadText(payload, "avatar_recommendation")}`,
      `Avatar concept: ${payloadText(payload, "avatar_concept")}`,
      `Audience relationship: ${payloadText(payload, "audience_relationship")}`,
      `Proof relationship: ${payloadText(payload, "proof_relationship")}`,
      `Education role: ${payloadText(payload, "education_role")}`,
      `Downstream guidance: ${payloadText(payload, "downstream_usage_guidance")}`,
    ],
    appearance: [
      `Visual concept alignment: ${payloadText(payload, "visual_concept_alignment")}`,
      `Face direction: ${payloadText(payload, "face_direction")}`,
      `Clothing direction: ${payloadText(payload, "clothing_direction")}`,
      `Distinguishing characteristics: ${payloadList(payload, "distinguishing_characteristics")}`,
      `Consistency notes: ${payloadList(payload, "visual_consistency_rules")}`,
    ],
    environment: [
      `Primary environment: ${payloadText(payload, "primary_environment")}`,
      `Environment rationale: ${payloadText(payload, "environment_rationale")}`,
      `Recurring sets: ${payloadList(payload, "recurring_sets")}`,
      `Props and tools: ${payloadList(payload, "props_and_tools")}`,
    ],
    voice_personality: [
      `Voice direction: ${payloadText(payload, "voice_direction")}`,
      `Personality traits: ${payloadList(payload, "personality_traits")}`,
      `Vocabulary: ${payloadList(payload, "vocabulary")}`,
      `Teaching style: ${payloadText(payload, "teaching_style")}`,
      `Recurring phrases: ${payloadList(payload, "recurring_phrases")}`,
    ],
    creative_direction: [
      `Camera style: ${payloadText(payload, "camera_style")}`,
      `Editing pace: ${payloadText(payload, "editing_pace")}`,
      `Visual treatment: ${payloadText(payload, "visual_treatment")}`,
      `Graphic treatment: ${payloadText(payload, "graphic_treatment")}`,
      `Sound direction: ${payloadText(payload, "sound_direction")}`,
    ],
    knowledge_expertise: [
      `Knowledge boundaries: ${payloadText(payload, "knowledge_boundaries")}`,
      `Allowed topics: ${payloadList(payload, "allowed_topics")}`,
      `Proof usage rules: ${payloadList(payload, "proof_usage_rules")}`,
      `Do not claim: ${payloadList(payload, "disallowed_claims")}`,
    ],
    content_format: [
      `Format selection rules: ${payloadList(payload, "format_selection_rules")}`,
      `Production handoff fields: ${payloadList(payload, "production_handoff_fields")}`,
      `Excluded until reviewed: ${payloadList(payload, "excluded_formats_until_reviewed")}`,
    ],
    asset_library: [
      `Generation requirements: ${payloadList(payload, "downstream_generation_requirements")}`,
      `Asset guardrails: ${payloadList(payload, "asset_generation_guardrails")}`,
    ],
  };
  return textLines([...base, ...componentLines[component.component_type]]).slice(0, 4000);
}

async function withHash(input: Omit<IdeationStrategicInputPack["snapshot"]["inputs"][number], "content_hash"> & {
  excerpt: string;
}) {
  return {
    source_kind: input.source_kind,
    source_release_id: input.source_release_id,
    source_entity_id: input.source_entity_id,
    title: input.title,
    content_hash: await sha256(input.excerpt),
  };
}

export async function loadIdeationStrategicInputs(
  sb: SupabaseClient,
  clientId: string,
  options: { sourceKinds?: SourceKind[] } = {},
): Promise<IdeationStrategicInputPack> {
  const selectedKinds = options.sourceKinds ?? ALL_SOURCE_KINDS;
  const include = new Set<SourceKind>(selectedKinds);
  const inputs: IdeationStrategicInput[] = [];
  const evidenceSources: IdeationEvidenceSource[] = [];
  const snapshotInputs: IdeationStrategicInputPack["snapshot"]["inputs"] = [];
  let displayOrder = 1;

  const campaignPointer = include.has("campaign_intelligence")
    ? await sb.from("client_campaign_intelligence_active_releases")
    .select("release_id")
    .eq("client_id", clientId)
    .maybeSingle()
    : { data: null, error: null };
  if (campaignPointer.error) throw new Error(campaignPointer.error.message);
  if (campaignPointer.data?.release_id) {
    const [releaseResult, periodsResult] = await Promise.all([
      sb.from("client_campaign_intelligence_releases")
        .select("id,version,title,summary,approved_at")
        .eq("client_id", clientId)
        .eq("id", campaignPointer.data.release_id)
        .eq("status", "approved")
        .maybeSingle(),
      sb.from("client_campaign_periods")
        .select("id,release_id,title,strategic_theme,timing_label,icp_context,emotional_states,pain_point_salience,desired_outcome,awareness_shift,strategic_messaging_direction,positioning_direction,campaign_objective,customer_journey_stage,display_order")
        .eq("client_id", clientId)
        .eq("release_id", campaignPointer.data.release_id)
        .order("display_order"),
    ]);
    if (releaseResult.error || periodsResult.error) {
      throw new Error(releaseResult.error?.message ?? periodsResult.error?.message ?? "Campaign Intelligence inputs could not be loaded.");
    }
    const release = releaseResult.data as ReleaseRow | null;
    if (release) {
      for (const period of (periodsResult.data ?? []) as CampaignPeriodRow[]) {
        const excerpt = textLines([
          `Campaign Intelligence v${release.version}: ${release.title}`,
          `Period: ${period.title}`,
          `Timing: ${period.timing_label}`,
          `Theme: ${period.strategic_theme}`,
          `ICP context: ${period.icp_context}`,
          `Emotional states: ${shortList(period.emotional_states)}`,
          `Pain salience: ${shortList(period.pain_point_salience)}`,
          `Desired outcome: ${period.desired_outcome}`,
          `Awareness shift: ${period.awareness_shift}`,
          `Messaging direction: ${period.strategic_messaging_direction}`,
          `Positioning direction: ${period.positioning_direction}`,
          `Objective: ${period.campaign_objective}`,
        ]).slice(0, 4000);
        const sourceUrl = `aa-authority://client/${clientId}/campaign-intelligence/period/${period.id}`;
        inputs.push({
          source_kind: "campaign_intelligence",
          source_release_id: release.id,
          campaign_period_id: period.id,
          main_offer_id: null,
          seasonal_offer_id: null,
          avatar_component_id: null,
          title: period.title,
          summary: period.strategic_theme,
          source_url: sourceUrl,
          payload: { release_version: release.version, customer_journey_stage: period.customer_journey_stage },
          display_order: displayOrder++,
        });
        evidenceSources.push(await createEvidenceSource({
          sourceId: `campaign:${period.id}:v${release.version}`,
          sourceRef: `Campaign Intelligence:${period.title}`,
          sourceType: "approved_campaign_intelligence",
          sourceUrl,
          excerpt,
        }));
        snapshotInputs.push(await withHash({
          source_kind: "campaign_intelligence",
          source_release_id: release.id,
          source_entity_id: period.id,
          title: period.title,
          excerpt,
        }));
      }
    }
  }

  const mainPointer = include.has("main_offer")
    ? await sb.from("client_offer_architecture_active_releases")
    .select("release_id")
    .eq("client_id", clientId)
    .maybeSingle()
    : { data: null, error: null };
  if (mainPointer.error) throw new Error(mainPointer.error.message);
  if (mainPointer.data?.release_id) {
    const [releaseResult, offersResult] = await Promise.all([
      sb.from("client_offer_architecture_releases")
        .select("id,version,title,summary,approved_at")
        .eq("client_id", clientId)
        .eq("id", mainPointer.data.release_id)
        .eq("status", "approved")
        .maybeSingle(),
      sb.from("client_main_offers")
        .select("id,release_id,offer_name,offer_role,offer_stage,customer_segment,problem_addressed,promised_outcome,mechanism,dream_outcome,perceived_likelihood,time_delay,effort_sacrifice,price_risk_friction,value_stack,bonus_stack,risk_reversal,guarantee,pricing_model,delivery_model,proof_requirements,offer_sequence_note,money_model_notes,display_order")
        .eq("client_id", clientId)
        .eq("release_id", mainPointer.data.release_id)
        .order("display_order"),
    ]);
    if (releaseResult.error || offersResult.error) {
      throw new Error(releaseResult.error?.message ?? offersResult.error?.message ?? "Main Offer inputs could not be loaded.");
    }
    const release = releaseResult.data as ReleaseRow | null;
    if (release) {
      for (const offer of (offersResult.data ?? []) as MainOfferRow[]) {
        const excerpt = textLines([
          `Main Offers v${release.version}: ${release.title}`,
          `Offer: ${offer.offer_name}`,
          `Role: ${offer.offer_role}`,
          `Stage: ${offer.offer_stage}`,
          `Customer segment: ${offer.customer_segment}`,
          `Problem addressed: ${offer.problem_addressed}`,
          `Promised outcome: ${offer.promised_outcome}`,
          `Mechanism: ${offer.mechanism}`,
          `Dream outcome: ${offer.dream_outcome}`,
          `Perceived likelihood: ${offer.perceived_likelihood}`,
          `Time delay: ${offer.time_delay}`,
          `Effort and sacrifice: ${offer.effort_sacrifice}`,
          `Price, risk, and friction: ${offer.price_risk_friction}`,
          `Value stack: ${shortList(offer.value_stack)}`,
          `Bonus stack: ${shortList(offer.bonus_stack)}`,
          `Risk reversal: ${offer.risk_reversal}`,
          `Guarantee: ${offer.guarantee}`,
          `Pricing model: ${offer.pricing_model}`,
          `Delivery model: ${offer.delivery_model}`,
          `Proof requirements: ${offer.proof_requirements}`,
          `Offer sequence: ${offer.offer_sequence_note}`,
          `Money model notes: ${offer.money_model_notes}`,
        ]).slice(0, 4000);
        const sourceUrl = `aa-authority://client/${clientId}/main-offers/${offer.id}`;
        inputs.push({
          source_kind: "main_offer",
          source_release_id: release.id,
          campaign_period_id: null,
          main_offer_id: offer.id,
          seasonal_offer_id: null,
          avatar_component_id: null,
          title: offer.offer_name,
          summary: offer.promised_outcome || offer.problem_addressed,
          source_url: sourceUrl,
          payload: { release_version: release.version, offer_role: offer.offer_role, offer_stage: offer.offer_stage },
          display_order: displayOrder++,
        });
        evidenceSources.push(await createEvidenceSource({
          sourceId: `main-offer:${offer.id}:v${release.version}`,
          sourceRef: `Main Offer:${offer.offer_name}`,
          sourceType: "approved_main_offer",
          sourceUrl,
          excerpt,
        }));
        snapshotInputs.push(await withHash({
          source_kind: "main_offer",
          source_release_id: release.id,
          source_entity_id: offer.id,
          title: offer.offer_name,
          excerpt,
        }));
      }
    }
  }

  const seasonalPointer = include.has("seasonal_offer")
    ? await sb.from("client_seasonal_offer_active_releases")
    .select("release_id")
    .eq("client_id", clientId)
    .maybeSingle()
    : { data: null, error: null };
  if (seasonalPointer.error) throw new Error(seasonalPointer.error.message);
  if (seasonalPointer.data?.release_id) {
    const [releaseResult, offersResult] = await Promise.all([
      sb.from("client_seasonal_offer_releases")
        .select("id,version,title,summary,approved_at")
        .eq("client_id", clientId)
        .eq("id", seasonalPointer.data.release_id)
        .eq("status", "approved")
        .maybeSingle(),
      sb.from("client_seasonal_offers")
        .select("id,release_id,campaign_period_id,main_offer_id,title,campaign_period_title,offer_angle,packaging_direction,urgency_driver,bonus_direction,positioning_direction,mechanism_direction,reason_to_act_now,cta_direction,offer_risk,display_order")
        .eq("client_id", clientId)
        .eq("release_id", seasonalPointer.data.release_id)
        .order("display_order"),
    ]);
    if (releaseResult.error || offersResult.error) {
      throw new Error(releaseResult.error?.message ?? offersResult.error?.message ?? "Seasonal Offer inputs could not be loaded.");
    }
    const release = releaseResult.data as ReleaseRow | null;
    if (release) {
      for (const offer of (offersResult.data ?? []) as SeasonalOfferRow[]) {
        const excerpt = textLines([
          `Seasonal Offers v${release.version}: ${release.title}`,
          `Seasonal offer: ${offer.title}`,
          `Campaign period: ${offer.campaign_period_title}`,
          `Offer angle: ${offer.offer_angle}`,
          `Packaging direction: ${offer.packaging_direction}`,
          `Urgency driver: ${offer.urgency_driver}`,
          `Bonus direction: ${offer.bonus_direction}`,
          `Positioning direction: ${offer.positioning_direction}`,
          `Mechanism direction: ${offer.mechanism_direction}`,
          `Reason to act now: ${offer.reason_to_act_now}`,
          `CTA direction: ${offer.cta_direction}`,
          `Offer risk: ${offer.offer_risk}`,
        ]).slice(0, 4000);
        const sourceUrl = `aa-authority://client/${clientId}/seasonal-offers/${offer.id}`;
        inputs.push({
          source_kind: "seasonal_offer",
          source_release_id: release.id,
          campaign_period_id: null,
          main_offer_id: null,
          seasonal_offer_id: offer.id,
          avatar_component_id: null,
          title: offer.title,
          summary: offer.offer_angle || offer.packaging_direction,
          source_url: sourceUrl,
          payload: {
            release_version: release.version,
            campaign_period_id: offer.campaign_period_id,
            main_offer_id: offer.main_offer_id,
          },
          display_order: displayOrder++,
        });
        evidenceSources.push(await createEvidenceSource({
          sourceId: `seasonal-offer:${offer.id}:v${release.version}`,
          sourceRef: `Seasonal Offer:${offer.title}`,
          sourceType: "approved_seasonal_offer",
          sourceUrl,
          excerpt,
        }));
        snapshotInputs.push(await withHash({
          source_kind: "seasonal_offer",
          source_release_id: release.id,
          source_entity_id: offer.id,
          title: offer.title,
          excerpt,
        }));
      }
    }
  }

  const avatarPointer = include.has("avatar")
    ? await sb.from("client_avatar_active_releases")
    .select("release_id")
    .eq("client_id", clientId)
    .maybeSingle()
    : { data: null, error: null };
  if (avatarPointer.error) throw new Error(avatarPointer.error.message);
  if (avatarPointer.data?.release_id) {
    const [releaseResult, componentsResult] = await Promise.all([
      sb.from("client_avatar_releases")
        .select("id,version,title,summary,approved_at")
        .eq("client_id", clientId)
        .eq("id", avatarPointer.data.release_id)
        .eq("status", "approved")
        .maybeSingle(),
      sb.from("client_avatar_components")
        .select("id,release_id,component_type,component_key,title,summary,strategic_rationale,evidence_summary,structured_payload,display_order")
        .eq("client_id", clientId)
        .eq("release_id", avatarPointer.data.release_id)
        .in("component_type", ["avatar_strategy", "voice_personality", "creative_direction", "knowledge_expertise", "content_format"])
        .order("display_order"),
    ]);
    if (releaseResult.error || componentsResult.error) {
      throw new Error(releaseResult.error?.message ?? componentsResult.error?.message ?? "Avatar OS inputs could not be loaded.");
    }
    const release = releaseResult.data as ReleaseRow | null;
    if (release) {
      for (const component of (componentsResult.data ?? []) as AvatarComponentRow[]) {
        const excerpt = avatarComponentExcerpt(component, release);
        const sourceUrl = `aa-authority://client/${clientId}/avatars/component/${component.id}`;
        inputs.push({
          source_kind: "avatar",
          source_release_id: release.id,
          campaign_period_id: null,
          main_offer_id: null,
          seasonal_offer_id: null,
          avatar_component_id: component.id,
          title: component.title,
          summary: component.summary,
          source_url: sourceUrl,
          payload: {
            release_version: release.version,
            component_type: component.component_type,
            component_key: component.component_key,
            avatar_led_optional: true,
          },
          display_order: displayOrder++,
        });
        evidenceSources.push(await createEvidenceSource({
          sourceId: `avatar:${component.id}:v${release.version}`,
          sourceRef: `Avatar OS:${component.title}`,
          sourceType: "approved_avatar_os",
          sourceUrl,
          excerpt,
        }));
        snapshotInputs.push(await withHash({
          source_kind: "avatar",
          source_release_id: release.id,
          source_entity_id: component.id,
          title: component.title,
          excerpt,
        }));
      }
    }
  }

  const counts: Record<SourceKind, number> = {
    campaign_intelligence: inputs.filter((input) => input.source_kind === "campaign_intelligence").length,
    main_offer: inputs.filter((input) => input.source_kind === "main_offer").length,
    seasonal_offer: inputs.filter((input) => input.source_kind === "seasonal_offer").length,
    avatar: inputs.filter((input) => input.source_kind === "avatar").length,
  };
  return {
    inputs,
    evidenceSources,
    snapshot: {
      policy: "ideation_hub_optional_campaign_offer_avatar_inputs_v1",
      selected_source_kinds: selectedKinds,
      counts,
      inputs: snapshotInputs,
    },
  };
}

export async function hashStrategicInputSnapshot(snapshot: IdeationStrategicInputPack["snapshot"]): Promise<string> {
  return await sha256(stableJson(snapshot));
}
