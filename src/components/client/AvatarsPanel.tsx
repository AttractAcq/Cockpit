import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Panel, StatusDot, Tabs, Tag } from "@/components/primitives";
import {
  driveAvatarAppearanceBuild,
  driveAvatarAssetLibraryBuild,
  driveAvatarOperatingContextBuild,
  driveAvatarStrategyBuild,
  driveAvatarWorldBuild,
  fetchAvatarWorkspace,
  generateAvatarAsset,
  reviewAvatarRelease,
} from "@/lib/avatar-os";
import type {
  AvatarApprovalDecision,
  AvatarAsset,
  AvatarAssetType,
  AvatarComponent,
  AvatarComponentType,
  AvatarWorkspace,
  RunAvatarStrategyStepResponse,
} from "@/types/avatar-os";

type AvatarTab = AvatarComponentType;

const AVATAR_TABS: Array<{ id: AvatarTab; label: string }> = [
  { id: "avatar_strategy", label: "Avatar Strategy" },
  { id: "appearance", label: "Appearance" },
  { id: "environment", label: "Environment" },
  { id: "voice_personality", label: "Voice & Personality" },
  { id: "creative_direction", label: "Creative Direction" },
  { id: "knowledge_expertise", label: "Knowledge" },
  { id: "content_format", label: "Content Formats" },
  { id: "asset_library", label: "Assets" },
];

const AVATAR_ASSET_TYPES: AvatarAssetType[] = [
  "canonical_image",
  "pose_reference",
  "expression_reference",
  "environment_reference",
  "character_sheet",
  "environment_sheet",
  "prompt_pack",
  "voice_reference",
  "production_reference",
  "other",
];

function readable(value: string): string {
  return value.replaceAll("_", " ");
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusTone(status: string | null | undefined): "live" | "idle" | "warn" | "error" | "paused" {
  if (status === "approved" || status === "completed") return "live";
  if (status === "needs_review" || status === "running" || status === "queued" || status === "waiting_provider") return "warn";
  if (status === "failed" || status === "cancelled") return "error";
  if (status === "archived" || status === "superseded") return "paused";
  return "idle";
}

function textValue(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : "Review required";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordText(value: Record<string, unknown>, key: string): string {
  const item = value[key];
  return typeof item === "string" && item.trim() ? item : "Review required";
}

function maybeAvatarAssetType(value: unknown): AvatarAssetType | null {
  return typeof value === "string" && AVATAR_ASSET_TYPES.includes(value as AvatarAssetType)
    ? value as AvatarAssetType
    : null;
}

function componentForTab(workspace: AvatarWorkspace | null, tab: AvatarTab): AvatarComponent | null {
  return workspace?.components.find((component) => component.component_type === tab) ?? null;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-ink px-3 py-2">
      <dt className="text-2xs uppercase text-paper-3">{label}</dt>
      <dd className="mt-1 text-xs leading-5 text-paper-2">{value || "Review required"}</dd>
    </div>
  );
}

function ListField({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="rounded border border-line bg-ink px-3 py-2">
      <dt className="text-2xs uppercase text-paper-3">{label}</dt>
      <dd className="mt-2 flex flex-wrap gap-1.5">
        {values.length > 0
          ? values.map((value, index) => <Tag key={`${value}-${index}`} kind="muted">{value}</Tag>)
          : <span className="text-xs text-paper-3">Review required</span>}
      </dd>
    </div>
  );
}

function ReviewHistory({ decisions }: { decisions: AvatarApprovalDecision[] }) {
  if (decisions.length === 0) return null;
  return (
    <Panel title="Review history" meta={`${decisions.length} decision(s)`}>
      <div className="divide-y divide-line">
        {decisions.map((decision) => (
          <div key={decision.id} className="px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Tag kind={decision.decision === "approved" ? "approve" : decision.decision === "rejected" ? "anomaly" : "decision"}>
                {readable(decision.decision)}
              </Tag>
              <span className="font-mono text-2xs text-paper-3">
                {readable(decision.previous_status)} {"->"} {readable(decision.resulting_status)}
              </span>
              <span className="ml-auto font-mono text-2xs text-paper-3">{formatDate(decision.decided_at)}</span>
            </div>
            {decision.note && <p className="mt-2 text-xs leading-5 text-paper-2">{decision.note}</p>}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function StrategyPanel({ component }: { component: AvatarComponent }) {
  const payload = component.structured_payload;
  const rightsNotes = stringList(payload.rights_safety_notes);
  const upstreamDigest = stringList(payload.upstream_context_digest);
  return (
    <div className="grid gap-4">
      <Panel title={component.title} meta={component.component_key}>
        <div className="grid gap-4 p-4">
          <div className="flex flex-wrap gap-1.5">
            {payload.stage_5b_scaffold === true && <Tag kind="decision">Stage 5B scaffold</Tag>}
            {payload.human_review_required === true && <Tag kind="anomaly">Human review required</Tag>}
            {payload.optional_content_level_usage === true && <Tag kind="muted">Optional content usage</Tag>}
          </div>
          <p className="text-xs leading-5 text-paper-2">{component.summary}</p>
          <dl className="grid gap-3 md:grid-cols-2">
            <Field label="Recommendation" value={textValue(payload, "avatar_recommendation")} />
            <Field label="Concept" value={textValue(payload, "avatar_concept")} />
            <Field label="Archetype" value={textValue(payload, "avatar_archetype")} />
            <Field label="Role within brand" value={textValue(payload, "role_within_brand")} />
            <Field label="Audience relationship" value={textValue(payload, "audience_relationship")} />
            <Field label="ICP fit" value={textValue(payload, "icp_fit")} />
            <Field label="Personality direction" value={textValue(payload, "personality_direction")} />
            <Field label="Education role" value={textValue(payload, "education_role")} />
          </dl>
        </div>
      </Panel>

      <Panel title="Strategic Rationale" meta="Proof remains substance">
        <div className="grid gap-3 p-4">
          <p className="text-xs leading-5 text-paper-2">{component.strategic_rationale}</p>
          <p className="rounded border border-line bg-ink px-3 py-2 text-xs leading-5 text-paper-2">
            {textValue(payload, "proof_relationship")}
          </p>
          <p className="text-xs leading-5 text-paper-3">{textValue(payload, "commercial_role")}</p>
        </div>
      </Panel>

      <Panel title="Evidence and Authority" meta={`${component.upstream_refs.length} refs`}>
        <div className="grid gap-4 p-4">
          <p className="text-xs leading-5 text-paper-2">{component.evidence_summary}</p>
          {upstreamDigest.length > 0 && (
            <div className="grid gap-2">
              {upstreamDigest.map((item, index) => (
                <p key={`${item}-${index}`} className="rounded border border-line bg-ink px-3 py-2 text-xs leading-5 text-paper-3">{item}</p>
              ))}
            </div>
          )}
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-ink p-3 text-[10px] leading-5 text-paper-3">
            {JSON.stringify(component.upstream_refs, null, 2)}
          </pre>
        </div>
      </Panel>

      <Panel title="Guardrails" meta="Before approval">
        <div className="grid gap-px bg-line">
          {rightsNotes.map((note, index) => (
            <div key={`${note}-${index}`} className="bg-ink-200 px-4 py-3 text-xs leading-5 text-paper-2">{note}</div>
          ))}
          <div className="bg-ink-200 px-4 py-3 text-xs leading-5 text-paper-2">
            No invented proof, expertise, legal rights, protected character mimicry, or media generation is approved by this scaffold.
          </div>
        </div>
      </Panel>
    </div>
  );
}

function AppearancePanel({ component }: { component: AvatarComponent }) {
  const payload = component.structured_payload;
  return (
    <div className="grid gap-4">
      <Panel title={component.title} meta={component.component_key}>
        <div className="grid gap-4 p-4">
          <div className="flex flex-wrap gap-1.5">
            {payload.stage_5c_scaffold === true && <Tag kind="decision">Stage 5C scaffold</Tag>}
            {payload.human_review_required === true && <Tag kind="anomaly">Human review required</Tag>}
            {payload.no_media_generation_in_stage_5c === true && <Tag kind="muted">No media generated</Tag>}
          </div>
          <p className="text-xs leading-5 text-paper-2">{component.summary}</p>
          <dl className="grid gap-3 md:grid-cols-2">
            <Field label="Visual concept alignment" value={textValue(payload, "visual_concept_alignment")} />
            <Field label="Archetype alignment" value={textValue(payload, "archetype_alignment")} />
            <Field label="Face direction" value={textValue(payload, "face_direction")} />
            <Field label="Apparent age" value={textValue(payload, "apparent_age_direction")} />
            <Field label="Body type" value={textValue(payload, "body_type_direction")} />
            <Field label="Hair" value={textValue(payload, "hair_direction")} />
            <Field label="Facial hair" value={textValue(payload, "facial_hair_direction")} />
            <Field label="Clothing" value={textValue(payload, "clothing_direction")} />
            <Field label="Accessories" value={textValue(payload, "accessory_direction")} />
            <Field label="Audience relationship" value={textValue(payload, "audience_relationship_alignment")} />
            <ListField label="Distinguishing characteristics" values={stringList(payload.distinguishing_characteristics)} />
            <ListField label="Expression set" values={stringList(payload.expression_set)} />
            <ListField label="Pose set" values={stringList(payload.pose_set)} />
            <ListField label="Canonical visual rules" values={stringList(payload.canonical_visual_rules)} />
          </dl>
        </div>
      </Panel>

      <Panel title="Reference Prompt Pack" meta="Review required">
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap p-4 text-[10px] leading-5 text-paper-3">
          {JSON.stringify(payload.reference_prompt_pack ?? {}, null, 2)}
        </pre>
      </Panel>

      <Panel title="Visual Guardrails" meta="Before media generation">
        <div className="grid gap-px bg-line">
          {stringList(payload.negative_prompt_boundaries).map((note, index) => (
            <div key={`${note}-${index}`} className="bg-ink-200 px-4 py-3 text-xs leading-5 text-paper-2">{note}</div>
          ))}
          <div className="bg-ink-200 px-4 py-3 text-xs leading-5 text-paper-2">
            Approval of Appearance is required before any image or video generation can consume these visual rules.
          </div>
        </div>
      </Panel>
    </div>
  );
}

function EnvironmentPanel({ component }: { component: AvatarComponent }) {
  const payload = component.structured_payload;
  return (
    <div className="grid gap-4">
      <Panel title={component.title} meta={component.component_key}>
        <div className="grid gap-4 p-4">
          <div className="flex flex-wrap gap-1.5">
            {payload.stage_5c_scaffold === true && <Tag kind="decision">Stage 5C scaffold</Tag>}
            {payload.human_review_required === true && <Tag kind="anomaly">Human review required</Tag>}
            {payload.no_media_generation_in_stage_5c === true && <Tag kind="muted">No media generated</Tag>}
          </div>
          <p className="text-xs leading-5 text-paper-2">{component.summary}</p>
          <dl className="grid gap-3 md:grid-cols-2">
            <Field label="Primary environment" value={textValue(payload, "primary_environment_concept")} />
            <Field label="Set layout" value={textValue(payload, "set_layout_notes")} />
            <Field label="Lighting" value={textValue(payload, "lighting_direction")} />
            <Field label="Visual atmosphere" value={textValue(payload, "visual_atmosphere")} />
            <Field label="Avatar concept alignment" value={textValue(payload, "avatar_concept_alignment")} />
            <Field label="Wardrobe alignment" value={textValue(payload, "wardrobe_alignment")} />
            <ListField label="Recurring sets" values={stringList(payload.recurring_sets)} />
            <ListField label="Props and tools" values={stringList(payload.props_and_tools)} />
            <ListField label="Background elements" values={stringList(payload.background_elements)} />
            <ListField label="Camera framing context" values={stringList(payload.camera_framing_context)} />
          </dl>
        </div>
      </Panel>

      <Panel title="Environment Prompt Pack" meta="Review required">
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap p-4 text-[10px] leading-5 text-paper-3">
          {JSON.stringify(payload.environment_prompt_pack ?? {}, null, 2)}
        </pre>
      </Panel>

      <Panel title="Environment Guardrails" meta="Before media generation">
        <div className="grid gap-px bg-line">
          {stringList(payload.negative_prompt_boundaries).map((note, index) => (
            <div key={`${note}-${index}`} className="bg-ink-200 px-4 py-3 text-xs leading-5 text-paper-2">{note}</div>
          ))}
          <div className="bg-ink-200 px-4 py-3 text-xs leading-5 text-paper-2">
            Approval is required before image or video systems can use these environment rules.
          </div>
        </div>
      </Panel>
    </div>
  );
}

function VoicePersonalityPanel({ component }: { component: AvatarComponent }) {
  const payload = component.structured_payload;
  return (
    <div className="grid gap-4">
      <Panel title={component.title} meta={component.component_key}>
        <div className="grid gap-4 p-4">
          <div className="flex flex-wrap gap-1.5">
            {payload.stage_5c_scaffold === true && <Tag kind="decision">Stage 5C scaffold</Tag>}
            {payload.human_review_required === true && <Tag kind="anomaly">Human review required</Tag>}
            {payload.no_audio_generation_in_stage_5c === true && <Tag kind="muted">No audio generated</Tag>}
            {payload.no_script_generation_in_stage_5c === true && <Tag kind="muted">No scripts generated</Tag>}
          </div>
          <p className="text-xs leading-5 text-paper-2">{component.summary}</p>
          <dl className="grid gap-3 md:grid-cols-2">
            <Field label="Accent" value={textValue(payload, "accent_direction")} />
            <Field label="Vocabulary" value={textValue(payload, "vocabulary_direction")} />
            <Field label="Slang" value={textValue(payload, "slang_direction")} />
            <Field label="Technical sophistication" value={textValue(payload, "technical_sophistication")} />
            <Field label="Sentence structure" value={textValue(payload, "sentence_structure")} />
            <Field label="Humour" value={textValue(payload, "humour_direction")} />
            <Field label="Confidence / warmth / directness" value={textValue(payload, "confidence_warmth_directness")} />
            <Field label="Energy level" value={textValue(payload, "energy_level")} />
            <Field label="Local language usage" value={textValue(payload, "local_language_usage")} />
            <Field label="Teaching style" value={textValue(payload, "teaching_style")} />
            <Field label="Storytelling style" value={textValue(payload, "storytelling_style")} />
            <Field label="Audience relationship" value={textValue(payload, "audience_relationship_alignment")} />
            <ListField label="Recurring phrases" values={stringList(payload.recurring_phrases)} />
            <ListField label="Mannerisms" values={stringList(payload.mannerisms)} />
            <ListField label="Do say" values={stringList(payload.do_say)} />
            <ListField label="Do not say" values={stringList(payload.do_not_say)} />
          </dl>
        </div>
      </Panel>

      <Panel title="Voice Prompt Pack" meta="Review required">
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap p-4 text-[10px] leading-5 text-paper-3">
          {JSON.stringify(payload.voice_prompt_pack ?? {}, null, 2)}
        </pre>
      </Panel>
    </div>
  );
}

function CreativeDirectionPanel({ component }: { component: AvatarComponent }) {
  const payload = component.structured_payload;
  return (
    <div className="grid gap-4">
      <Panel title={component.title} meta={component.component_key}>
        <div className="grid gap-4 p-4">
          <div className="flex flex-wrap gap-1.5">
            {payload.stage_5c_scaffold === true && <Tag kind="decision">Stage 5C scaffold</Tag>}
            {payload.human_review_required === true && <Tag kind="anomaly">Human review required</Tag>}
            {payload.no_media_generation_in_stage_5c === true && <Tag kind="muted">No media generated</Tag>}
            {payload.no_script_generation_in_stage_5c === true && <Tag kind="muted">No scripts generated</Tag>}
          </div>
          <p className="text-xs leading-5 text-paper-2">{component.summary}</p>
          <dl className="grid gap-3 md:grid-cols-2">
            <Field label="Avatar concept alignment" value={textValue(payload, "avatar_concept_alignment")} />
            <Field label="Environment alignment" value={textValue(payload, "environment_alignment")} />
            <Field label="Voice alignment" value={textValue(payload, "voice_alignment")} />
            <Field label="Camera style" value={textValue(payload, "camera_style")} />
            <Field label="Editing pace" value={textValue(payload, "editing_pace")} />
            <Field label="Typography" value={textValue(payload, "typography_treatment")} />
            <Field label="Transitions" value={textValue(payload, "transition_style")} />
            <Field label="Sound design" value={textValue(payload, "sound_design_direction")} />
            <Field label="Music" value={textValue(payload, "music_direction")} />
            <ListField label="Shot types" values={stringList(payload.shot_types)} />
            <ListField label="Framing rules" values={stringList(payload.framing_rules)} />
            <ListField label="Camera movement" values={stringList(payload.camera_movement)} />
            <ListField label="Colour tendencies" values={stringList(payload.colour_tendencies)} />
            <ListField label="Graphical overlays" values={stringList(payload.graphical_overlays)} />
            <ListField label="Recurring motifs" values={stringList(payload.recurring_motifs)} />
          </dl>
        </div>
      </Panel>

      <Panel title="Creative Prompt Pack" meta="Review required">
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap p-4 text-[10px] leading-5 text-paper-3">
          {JSON.stringify(payload.creative_prompt_pack ?? {}, null, 2)}
        </pre>
      </Panel>

      <Panel title="Creative Guardrails" meta="Before production">
        <div className="grid gap-px bg-line">
          {stringList(payload.creative_guardrails).map((note, index) => (
            <div key={`${note}-${index}`} className="bg-ink-200 px-4 py-3 text-xs leading-5 text-paper-2">{note}</div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function KnowledgePanel({ component }: { component: AvatarComponent }) {
  const payload = component.structured_payload;
  return (
    <div className="grid gap-4">
      <Panel title={component.title} meta={component.component_key}>
        <div className="grid gap-4 p-4">
          <div className="flex flex-wrap gap-1.5">
            {payload.stage_5c_scaffold === true && <Tag kind="decision">Stage 5C scaffold</Tag>}
            {payload.human_review_required === true && <Tag kind="anomaly">Human review required</Tag>}
            {payload.no_content_ideation_in_stage_5c === true && <Tag kind="muted">No ideas generated</Tag>}
            {payload.no_script_generation_in_stage_5c === true && <Tag kind="muted">No scripts generated</Tag>}
          </div>
          <p className="text-xs leading-5 text-paper-2">{component.summary}</p>
          <dl className="grid gap-3 md:grid-cols-2">
            <Field label="Avatar concept alignment" value={textValue(payload, "avatar_concept_alignment")} />
            <Field label="Teaching style alignment" value={textValue(payload, "teaching_style_alignment")} />
            <Field label="Evidence policy" value={textValue(payload, "required_evidence_policy")} />
            <ListField label="Approved knowledge domains" values={stringList(payload.approved_knowledge_domains)} />
            <ListField label="Proof sources" values={stringList(payload.proof_sources_to_reference)} />
            <ListField label="Services / products" values={stringList(payload.services_products_to_reference)} />
            <ListField label="Proprietary methods" values={stringList(payload.proprietary_methods_to_reference)} />
            <ListField label="FAQs / questions" values={stringList(payload.faqs_and_customer_questions)} />
            <ListField label="Objections" values={stringList(payload.objections_avatar_can_address)} />
            <ListField label="Case-study boundaries" values={stringList(payload.case_study_boundaries)} />
            <ListField label="Client input markers" values={stringList(payload.needs_client_input_markers)} />
          </dl>
        </div>
      </Panel>

      <Panel title="Claim Boundaries" meta="No invented expertise">
        <div className="grid gap-px bg-line">
          {stringList(payload.claim_boundaries).map((note, index) => (
            <div key={`${note}-${index}`} className="bg-ink-200 px-4 py-3 text-xs leading-5 text-paper-2">{note}</div>
          ))}
        </div>
      </Panel>

      <Panel title="Knowledge Prompt Pack" meta="Review required">
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap p-4 text-[10px] leading-5 text-paper-3">
          {JSON.stringify(payload.knowledge_prompt_pack ?? {}, null, 2)}
        </pre>
      </Panel>
    </div>
  );
}

function ContentFormatsPanel({ component }: { component: AvatarComponent }) {
  const payload = component.structured_payload;
  const formats = Array.isArray(payload.reusable_formats) ? payload.reusable_formats : [];
  return (
    <div className="grid gap-4">
      <Panel title={component.title} meta={component.component_key}>
        <div className="grid gap-4 p-4">
          <div className="flex flex-wrap gap-1.5">
            {payload.stage_5c_scaffold === true && <Tag kind="decision">Stage 5C scaffold</Tag>}
            {payload.human_review_required === true && <Tag kind="anomaly">Human review required</Tag>}
            {payload.no_content_ideation_in_stage_5c === true && <Tag kind="muted">No ideas generated</Tag>}
            {payload.no_media_generation_in_stage_5c === true && <Tag kind="muted">No media generated</Tag>}
          </div>
          <p className="text-xs leading-5 text-paper-2">{component.summary}</p>
          <dl className="grid gap-3 md:grid-cols-2">
            <Field label="Avatar concept alignment" value={textValue(payload, "avatar_concept_alignment")} />
            <Field label="Environment alignment" value={textValue(payload, "primary_environment_alignment")} />
            <Field label="Teaching style alignment" value={textValue(payload, "teaching_style_alignment")} />
            <ListField label="Format selection rules" values={stringList(payload.format_selection_rules)} />
            <ListField label="Production handoff fields" values={stringList(payload.production_handoff_fields)} />
            <ListField label="Excluded until reviewed" values={stringList(payload.excluded_formats_until_reviewed)} />
          </dl>
        </div>
      </Panel>

      <Panel title="Reusable Formats" meta={`${formats.length} format(s)`}>
        <div className="grid gap-px bg-line">
          {formats.map((format, index) => (
            <div key={index} className="bg-ink-200 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Tag kind="muted">{typeof format === "object" && format && "format_key" in format ? String(format.format_key) : `format_${index + 1}`}</Tag>
                <span className="text-xs font-medium text-paper">
                  {typeof format === "object" && format && "format_name" in format ? String(format.format_name) : "Review required"}
                </span>
              </div>
              <pre className="mt-2 whitespace-pre-wrap text-[10px] leading-5 text-paper-3">{JSON.stringify(format, null, 2)}</pre>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function AssetLibraryPanel({
  component,
  assets,
  busy,
  canGenerateAssets,
  onGenerateAsset,
}: {
  component: AvatarComponent;
  assets: AvatarAsset[];
  busy: boolean;
  canGenerateAssets: boolean;
  onGenerateAsset: (assetType: AvatarAssetType) => void;
}) {
  const payload = component.structured_payload;
  const slots = Array.isArray(payload.planned_asset_slots) ? payload.planned_asset_slots : [];
  return (
    <div className="grid gap-4">
      <Panel title={component.title} meta={component.component_key}>
        <div className="grid gap-4 p-4">
          <div className="flex flex-wrap gap-1.5">
            {payload.stage_5d_asset_library_foundation === true && <Tag kind="decision">Stage 5D foundation</Tag>}
            {payload.human_review_required === true && <Tag kind="anomaly">Human review required</Tag>}
            {payload.no_image_generation_in_stage_5d === true && <Tag kind="muted">No images generated</Tag>}
            {payload.no_storage_write_in_stage_5d === true && <Tag kind="muted">No storage writes</Tag>}
            {payload.no_asset_rows_created_in_stage_5d === true && <Tag kind="muted">No asset rows</Tag>}
          </div>
          <p className="text-xs leading-5 text-paper-2">{component.summary}</p>
          <dl className="grid gap-3 md:grid-cols-2">
            <Field label="Appearance reference" value={textValue(payload, "canonical_appearance_reference")} />
            <Field label="Environment reference" value={textValue(payload, "canonical_environment_reference")} />
            <Field label="Voice reference" value={textValue(payload, "canonical_voice_reference")} />
            <Field label="Creative reference" value={textValue(payload, "canonical_creative_reference")} />
            <Field label="Knowledge boundary" value={textValue(payload, "knowledge_boundary_reference")} />
            <ListField label="Generation requirements" values={stringList(payload.downstream_generation_requirements)} />
          </dl>
        </div>
      </Panel>

      <Panel title="Planned Asset Slots" meta={`${slots.length} slot(s)`}>
        <div className="grid gap-px bg-line">
          {slots.map((slot, index) => {
            const record = isRecord(slot) ? slot : {};
            const assetType = maybeAvatarAssetType(record.asset_type);
            return (
              <div key={index} className="bg-ink-200 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag kind="muted">{recordText(record, "asset_type")}</Tag>
                  <span className="text-xs font-medium text-paper">{recordText(record, "title")}</span>
                  <span className="ml-auto font-mono text-2xs text-paper-3">{recordText(record, "status")}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-paper-3">{recordText(record, "purpose")}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {stringList(record.source_component_types).map((value) => <Tag key={value} kind="muted">{value}</Tag>)}
                  <Button
                    disabled={busy || !assetType || !canGenerateAssets}
                    onClick={() => assetType ? onGenerateAsset(assetType) : undefined}
                  >
                    {canGenerateAssets ? "Generate Asset Record" : "Approve Asset Library first"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Prompt Pack Foundation" meta="Review required">
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap p-4 text-[10px] leading-5 text-paper-3">
          {JSON.stringify(payload.prompt_pack_foundation ?? {}, null, 2)}
        </pre>
      </Panel>

      <Panel title="Asset Guardrails" meta="Before generate-avatar-asset">
        <div className="grid gap-px bg-line">
          {stringList(payload.asset_generation_guardrails).map((note, index) => (
            <div key={`${note}-${index}`} className="bg-ink-200 px-4 py-3 text-xs leading-5 text-paper-2">{note}</div>
          ))}
        </div>
      </Panel>

      <Panel title="Stored Assets" meta={`${assets.length} row(s)`}>
        {assets.length === 0 ? (
          <div className="p-4 text-xs text-paper-3">No generated avatar assets yet. Generate an approved planned slot to create a review-gated asset record.</div>
        ) : (
          <div className="grid gap-px bg-line">
            {assets.map((asset) => (
              <div key={asset.id} className="bg-ink-200 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag kind={asset.status === "approved" ? "approve" : asset.status === "needs_review" ? "decision" : "muted"}>{readable(asset.status)}</Tag>
                  <Tag kind="muted">{readable(asset.asset_type)}</Tag>
                  <span className="text-xs font-medium text-paper">{asset.title}</span>
                  <span className="ml-auto font-mono text-2xs text-paper-3">v{asset.version}</span>
                </div>
                {asset.description && <p className="mt-2 text-xs leading-5 text-paper-3">{asset.description}</p>}
                <div className="mt-2 grid gap-1 text-2xs text-paper-3 sm:grid-cols-2">
                  <span>Provider: {asset.generation_provider ?? "none"}</span>
                  <span>Model: {asset.generation_model ?? "none"}</span>
                  <span>Storage: {asset.storage_path ?? "none"}</span>
                  <span>External: {asset.external_url ?? "none"}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function LockedTabPanel({
  tab,
  hasApprovedStrategy,
  hasApprovedAppearance,
  hasApprovedWorld,
  hasApprovedOperatingContext,
}: {
  tab: AvatarTab;
  hasApprovedStrategy: boolean;
  hasApprovedAppearance: boolean;
  hasApprovedWorld: boolean;
  hasApprovedOperatingContext: boolean;
}) {
  const label = AVATAR_TABS.find((candidate) => candidate.id === tab)?.label ?? readable(tab);
  return (
    <div className="rounded-[10px] border border-dashed border-line bg-ink-200 p-8 text-center">
      <h3 className="text-sm font-medium text-paper">{label} is not built yet</h3>
      <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-paper-3">
        {tab === "appearance" && hasApprovedStrategy
          ? "Use Generate Appearance to create a review-gated visual identity scaffold from the approved Avatar Strategy."
          : (tab === "environment" || tab === "voice_personality" || tab === "creative_direction") && hasApprovedAppearance
            ? "Use Generate Environment, Voice & Creative Direction to create review-gated world and audiovisual grammar scaffolds from the approved Appearance release."
          : (tab === "environment" || tab === "voice_personality" || tab === "creative_direction")
            ? "Approve Appearance first. Environment, Voice, and Creative Direction should inherit from approved visual identity rather than inventing a disconnected world."
          : (tab === "knowledge_expertise" || tab === "content_format") && hasApprovedWorld
            ? "Use Generate Knowledge & Formats to create review-gated knowledge boundaries and reusable avatar-led format mechanics from the approved Avatar World."
          : (tab === "knowledge_expertise" || tab === "content_format")
            ? "Approve Environment, Voice, and Creative Direction first. Knowledge and format mechanics should inherit from approved avatar world authority."
          : tab === "asset_library" && hasApprovedOperatingContext
            ? "Use Generate Asset Library to create the reusable avatar asset inventory and prompt-pack foundation. No media will be generated."
          : tab === "asset_library"
            ? "Approve Knowledge and Content Formats first. Asset slots should inherit from the full approved Avatar OS show bible."
          : hasApprovedStrategy
            ? "This component can be generated in a later Stage 5 cut using the approved Avatar Strategy as authority."
          : "Approve Avatar Strategy first. Later tabs should inherit from approved strategy rather than inventing a disconnected character world."}
      </p>
    </div>
  );
}

export function AvatarsPanel({ clientId }: { clientId: string }) {
  const [workspace, setWorkspace] = useState<AvatarWorkspace | null>(null);
  const [selectedTab, setSelectedTab] = useState<AvatarTab>("avatar_strategy");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<RunAvatarStrategyStepResponse["progress"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setWorkspace(await fetchAvatarWorkspace(clientId));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void reload(); }, [reload]);

  const latest = workspace?.latestRelease ?? null;
  const active = workspace?.activeRelease ?? null;
  const run = workspace?.latestRun ?? null;
  const waitingForReview = latest?.status === "needs_review";
  const selectedComponent = useMemo(() => componentForTab(workspace, selectedTab), [selectedTab, workspace]);
  const strategyComponent = useMemo(() => componentForTab(workspace, "avatar_strategy"), [workspace]);
  const appearanceComponent = useMemo(() => componentForTab(workspace, "appearance"), [workspace]);
  const environmentComponent = useMemo(() => componentForTab(workspace, "environment"), [workspace]);
  const voiceComponent = useMemo(() => componentForTab(workspace, "voice_personality"), [workspace]);
  const creativeComponent = useMemo(() => componentForTab(workspace, "creative_direction"), [workspace]);
  const knowledgeComponent = useMemo(() => componentForTab(workspace, "knowledge_expertise"), [workspace]);
  const contentFormatsComponent = useMemo(() => componentForTab(workspace, "content_format"), [workspace]);
  const assetLibraryComponent = useMemo(() => componentForTab(workspace, "asset_library"), [workspace]);
  const selectedGeneration = selectedTab === "avatar_strategy"
    ? "strategy"
    : selectedTab === "appearance"
      ? "appearance"
      : selectedTab === "environment" || selectedTab === "voice_personality" || selectedTab === "creative_direction"
        ? "world"
        : selectedTab === "knowledge_expertise" || selectedTab === "content_format"
          ? "operating_context"
        : selectedTab === "asset_library"
          ? "asset_library"
        : "unsupported";
  const canBuildAppearance = selectedGeneration === "appearance" && Boolean(active);
  const canBuildWorld = selectedGeneration === "world" && Boolean(active && appearanceComponent);
  const hasWorldAuthority = Boolean(active && environmentComponent && voiceComponent && creativeComponent);
  const canBuildOperatingContext = selectedGeneration === "operating_context" && hasWorldAuthority;
  const hasOperatingContextAuthority = Boolean(active && knowledgeComponent && contentFormatsComponent);
  const canBuildAssetLibrary = selectedGeneration === "asset_library" && hasOperatingContextAuthority;
  const canBuildSelected = selectedGeneration === "strategy" || canBuildAppearance || canBuildWorld || canBuildOperatingContext || canBuildAssetLibrary;
  const canGenerateAssetRows = Boolean(active && assetLibraryComponent && active.id === assetLibraryComponent.release_id);
  const buildLabel = working
    ? progress ? `Building ${progress.completed + progress.failed}/${progress.total}...` : "Preparing..."
    : selectedGeneration === "unsupported" ? "Generate in later stage"
      : selectedGeneration === "asset_library"
        ? assetLibraryComponent ? "Refresh Asset Library" : "Generate Asset Library"
      : selectedGeneration === "operating_context"
        ? knowledgeComponent && contentFormatsComponent ? "Refresh Knowledge & Formats" : "Generate Knowledge & Formats"
      : selectedGeneration === "world"
        ? environmentComponent && voiceComponent && creativeComponent ? "Refresh Environment, Voice & Creative" : "Generate Environment, Voice & Creative"
      : selectedGeneration === "appearance"
      ? appearanceComponent ? "Refresh Appearance" : "Generate Appearance"
      : active ? "Refresh Avatar Strategy"
        : run?.status === "failed" ? "Rebuild Avatar Strategy"
          : run ? "Resume Avatar Strategy" : "Generate Avatar Strategy";

  async function build() {
    if (selectedGeneration === "unsupported") {
      setError("This Avatar OS component belongs to a later Stage 5 cut.");
      return;
    }
    if (selectedGeneration === "appearance" && !canBuildAppearance) {
      setError("Approve Avatar Strategy before generating Appearance.");
      return;
    }
    if (selectedGeneration === "world" && !canBuildWorld) {
      setError("Approve Appearance before generating Environment, Voice & Personality, and Creative Direction.");
      return;
    }
    if (selectedGeneration === "operating_context" && !canBuildOperatingContext) {
      setError("Approve Environment, Voice & Personality, and Creative Direction before generating Knowledge and Content Formats.");
      return;
    }
    if (selectedGeneration === "asset_library" && !canBuildAssetLibrary) {
      setError("Approve Knowledge and Content Formats before generating the Asset Library foundation.");
      return;
    }
    setWorking(true);
    setError(null);
    setMessage(null);
    setProgress(null);
    try {
      const result = selectedGeneration === "appearance"
        ? await driveAvatarAppearanceBuild(clientId, setProgress)
        : selectedGeneration === "world"
          ? await driveAvatarWorldBuild(clientId, setProgress)
        : selectedGeneration === "operating_context"
          ? await driveAvatarOperatingContextBuild(clientId, setProgress)
        : selectedGeneration === "asset_library"
          ? await driveAvatarAssetLibraryBuild(clientId, setProgress)
        : await driveAvatarStrategyBuild(clientId, setProgress);
      setMessage(result.message);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      await reload();
    } finally {
      setWorking(false);
    }
  }

  async function review(decision: "approved" | "changes_requested" | "rejected") {
    const release = workspace?.latestRelease;
    if (!release) return;
    let note: string | undefined;
    if (decision === "approved") {
      if (!window.confirm(`Approve and activate ${release.title}?\n\nApproved Avatars become downstream creative identity authority.`)) return;
    } else {
      const promptLabel = decision === "changes_requested" ? "What must change before approval?" : "Why archive this release?";
      const entered = window.prompt(promptLabel);
      if (entered === null) return;
      note = entered;
    }
    setWorking(true);
    setError(null);
    try {
      await reviewAvatarRelease(release.id, decision, note);
      setMessage(decision === "approved" ? "Avatar release approved and activated." : decision === "changes_requested" ? "Changes requested. The release is back in draft." : "Avatar release archived.");
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setWorking(false);
    }
  }

  async function createAssetRecord(assetType: AvatarAssetType) {
    if (!canGenerateAssetRows) {
      setError("Approve and activate the Avatar Asset Library before generating asset records.");
      return;
    }
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const result = await generateAvatarAsset(clientId, { asset_type: assetType });
      if (!result.ok) throw new Error(result.message);
      setMessage(result.message);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      await reload();
    } finally {
      setWorking(false);
    }
  }

  if (loading && !workspace) {
    return <div className="flex flex-1 items-center justify-center text-xs text-paper-3">Loading Avatars...</div>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-[10px] border border-line bg-ink-200 p-4">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center gap-2">
              <StatusDot status={active ? statusTone("approved") : statusTone(latest?.status ?? run?.status)} />
              <span className="font-mono text-[9.5px] uppercase tracking-cap text-paper-3">
                {active ? "Approved avatar authority" : latest ? readable(latest.status) : "Not started"}
              </span>
            </div>
            <h2 className="text-base font-medium text-paper">Avatars</h2>
            <p className="mt-1 text-xs leading-5 text-paper-3">
              Owned communication identity and creative-world authority. Proof remains substance; avatars are delivery, familiarity, education, and production consistency.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {waitingForReview ? (
              <>
                <Button disabled={working} onClick={() => void review("changes_requested")}>Request changes</Button>
                <Button variant="danger" disabled={working} onClick={() => void review("rejected")}>Archive</Button>
                <Button variant="primary" disabled={working} onClick={() => void review("approved")}>Approve &amp; activate</Button>
              </>
            ) : (
              <Button variant="primary" disabled={working || !canBuildSelected} onClick={() => void build()}>{buildLabel}</Button>
            )}
          </div>
        </div>

        {progress && working && (
          <div className="rounded-[10px] border border-teal/20 bg-teal/5 px-4 py-3 text-xs text-paper">
            Avatar {selectedGeneration === "appearance" ? "Appearance" : selectedGeneration === "world" ? "Environment, Voice & Creative" : selectedGeneration === "operating_context" ? "Knowledge & Formats" : selectedGeneration === "asset_library" ? "Asset Library" : "Strategy"} workflow: {progress.completed} completed, {progress.failed} failed, {progress.total} total steps.
          </div>
        )}
        {message && <div className="rounded-[10px] border border-teal/20 bg-teal/5 px-4 py-3 text-xs text-teal">{message}</div>}
        {error && <div className="rounded-[10px] border border-neg/30 bg-neg/5 px-4 py-3 text-xs leading-5 text-neg">{error}</div>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <span className="text-2xs uppercase text-paper-3">Authority</span>
            <span className="text-sm text-paper">{active ? `Active v${active.version}` : "No active release"}</span>
            <span className="text-2xs text-paper-3">{active ? formatDate(active.approved_at) : "Human approval required"}</span>
          </Card>
          <Card>
            <span className="text-2xs uppercase text-paper-3">Latest draft</span>
            <span className="text-sm capitalize text-paper">{latest ? `v${latest.version} - ${readable(latest.status)}` : "Not built"}</span>
            <span className="text-2xs text-paper-3">{latest ? formatDate(latest.generated_at ?? latest.created_at) : "-"}</span>
          </Card>
          <Card>
            <span className="text-2xs uppercase text-paper-3">Components</span>
            <span className="text-sm text-paper">{workspace?.components.length ?? 0} component(s)</span>
            <span className="text-2xs text-paper-3">{assetLibraryComponent ? "Asset library foundation present" : knowledgeComponent && contentFormatsComponent ? "Operating context present" : environmentComponent && voiceComponent && creativeComponent ? "World and creative scaffold present" : appearanceComponent ? "Appearance scaffold present" : strategyComponent ? "Strategy scaffold present" : "Strategy first"}</span>
          </Card>
          <Card>
            <span className="text-2xs uppercase text-paper-3">Assets</span>
            <span className="text-sm text-paper">{workspace?.assets.length ?? 0} reusable asset(s)</span>
            <span className="text-2xs text-paper-3">No media generation in Stage 5C; asset rows review-gated</span>
          </Card>
        </div>

        {(workspace?.steps.length ?? 0) > 0 && (
          <Panel title="Research workflow" meta={run ? readable(run.status) : undefined}>
            <div className="divide-y divide-line">
              {workspace?.steps.map((step) => (
                <div key={step.id} className="flex items-center gap-3 px-3.5 py-3">
                  <StatusDot status={statusTone(step.status)} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-paper">{step.title}</div>
                    {step.failure_message && <div className="mt-1 truncate text-2xs text-neg">{step.failure_message}</div>}
                  </div>
                  <span className="font-mono text-2xs capitalize text-paper-3">{readable(step.status)}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        <div className="rounded-[10px] border border-line bg-ink-200 px-4 pt-2">
          <Tabs
            tabs={AVATAR_TABS.map((tab) => ({
              ...tab,
              count: workspace?.components.filter((component) => component.component_type === tab.id).length ?? 0,
            }))}
            active={selectedTab}
            onChange={(next) => setSelectedTab(next as AvatarTab)}
          />
          <div className="py-4">
            {selectedComponent ? (
              selectedComponent.component_type === "avatar_strategy" ? (
                <StrategyPanel component={selectedComponent} />
              ) : selectedComponent.component_type === "appearance" ? (
                <AppearancePanel component={selectedComponent} />
              ) : selectedComponent.component_type === "environment" ? (
                <EnvironmentPanel component={selectedComponent} />
              ) : selectedComponent.component_type === "voice_personality" ? (
                <VoicePersonalityPanel component={selectedComponent} />
              ) : selectedComponent.component_type === "creative_direction" ? (
                <CreativeDirectionPanel component={selectedComponent} />
              ) : selectedComponent.component_type === "knowledge_expertise" ? (
                <KnowledgePanel component={selectedComponent} />
              ) : selectedComponent.component_type === "content_format" ? (
                <ContentFormatsPanel component={selectedComponent} />
              ) : selectedComponent.component_type === "asset_library" ? (
                <AssetLibraryPanel
                  component={selectedComponent}
                  assets={workspace?.assets ?? []}
                  busy={working}
                  canGenerateAssets={canGenerateAssetRows}
                  onGenerateAsset={(assetType) => void createAssetRecord(assetType)}
                />
              ) : (
                <Panel title={selectedComponent.title} meta={selectedComponent.component_key}>
                  <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap p-4 text-[10px] leading-5 text-paper-3">
                    {JSON.stringify(selectedComponent.structured_payload, null, 2)}
                  </pre>
                </Panel>
              )
            ) : (
              <LockedTabPanel
                tab={selectedTab}
                hasApprovedStrategy={Boolean(active)}
                hasApprovedAppearance={Boolean(active && appearanceComponent)}
                hasApprovedWorld={hasWorldAuthority}
                hasApprovedOperatingContext={hasOperatingContextAuthority}
              />
            )}
          </div>
        </div>

        <ReviewHistory decisions={workspace?.approvalDecisions ?? []} />
      </div>
    </div>
  );
}
