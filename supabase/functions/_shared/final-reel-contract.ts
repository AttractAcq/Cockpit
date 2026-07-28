// Reel Studio Phase 3: the authoritative contract for the FINAL edited Reel.
//
// Production boundary (fixed for Phase 3):
//   Cockpit generates and manages individual shot clips. An external editor
//   combines them with voiceover, captions, music, transitions and grading.
//   Cockpit receives the finished MP4 and owns versioning, review, approval,
//   distribution and publication. Cockpit never assembles or edits video.
//
// Source of truth: `public.video_project_deliverables`. One row per uploaded
// final MP4 version. `video_projects.current_deliverable_id` answers "what is the
// current final Reel?" explicitly — never inferred from timestamps, filenames,
// asset groups or storage listings.
//
// Deliberately NOT stored in `client_assets`: that table requires non-null
// `prompt_md`, `generation_provider` and `generation_model` (a human-edited
// upload has none, and inventing them would be fabrication), has no reviewer or
// review-feedback columns, no duration/file-size columns, and already holds the
// Phase 2 shot clips as `asset_format = 'reel_video'` — so reusing it would make
// a shot clip and the final deliverable structurally indistinguishable, which
// Phase 3 must prevent. The final MP4 therefore has exactly ONE authoritative
// row, in one table.
//
// Imported by Edge Functions AND the frontend so one decision renders in both.

export const FINAL_REEL_BUCKET = "video-assets";
export const FINAL_REEL_MIME = "video/mp4";
export const FINAL_REEL_EXTENSION = "mp4";

/**
 * Upload ceiling. The `video-assets` bucket enforces 200 MB server-side and
 * Meta's documented Reels limit is 300 MB, so the bucket is the binding
 * constraint; we validate against it explicitly rather than relying on the
 * storage error.
 */
export const FINAL_REEL_MAX_BYTES = 200 * 1024 * 1024;
export const FINAL_REEL_MIN_BYTES = 1024;

/**
 * Meta's documented Reels media constraints (developers.facebook.com,
 * IG User Media reference). Recorded here so validation and operator messaging
 * agree; only the values we can actually verify are enforced.
 */
export const REEL_MEDIA_SPEC = {
  container: "MP4 (MPEG-4 Part 14) or MOV, moov atom at front, no edit lists",
  videoCodec: "H264 or HEVC, progressive scan, closed GOP, 4:2:0",
  audioCodec: "AAC, up to 48kHz, 1-2 channels",
  minDurationSec: 3,
  maxDurationSec: 15 * 60,
  maxHorizontalPixels: 1920,
  minAspectRatio: 0.01,
  maxAspectRatio: 10,
  recommendedAspectRatio: "9:16",
  maxFileSizeBytesMeta: 300 * 1024 * 1024,
} as const;

export type DeliverableReviewStatus = "needs_review" | "approved" | "rejected" | "archived";

/**
 * Where the media metadata came from. We never fabricate width/height/duration:
 * the Deno edge runtime has no media probe, so values supplied by the browser are
 * marked `client_reported` and anything unknown stays null.
 */
export type MediaMetadataSource = "unknown" | "client_reported" | "server_probed";

export interface FinalReelDeliverable {
  id: string;
  client_id: string;
  video_project_id: string;
  client_production_brief_id: string | null;
  source_table: string | null;
  source_row_id: string | null;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  file_format: string;
  file_size_bytes: number;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  media_metadata_source: MediaMetadataSource;
  version: number;
  is_current: boolean;
  status: DeliverableReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_feedback: string | null;
  uploaded_by: string | null;
  upload_completed_at: string | null;
  superseded_at: string | null;
  original_filename: string | null;
  created_at: string;
  updated_at: string;
}

export type ContractResult<T> = { ok: true; value: T } | { ok: false; error: string; code: string };

// ── Upload validation ───────────────────────────────────────────────────────

function fail(code: string, error: string): { ok: false; error: string; code: string } {
  return { ok: false, code, error };
}

export interface FinalReelUploadRequest {
  filename: string;
  mimeType: string;
  fileSizeBytes: number;
}

export interface ValidatedFinalReelUpload {
  safeFilename: string;
  mimeType: string;
  fileSizeBytes: number;
}

/**
 * Strip anything that could escape the server-built path. Never trusts the
 * browser. The extension is removed FIRST so a degenerate name like "....mp4"
 * collapses to the default rather than to a confusing "mp4.mp4"; the result is
 * always exactly one `.mp4` path segment with no separators.
 */
export function safeFinalReelFilename(filename: string): string {
  const base = (filename ?? "").split(/[\\/]/).pop() ?? "";
  const withoutExtension = base.replace(/\.[a-zA-Z0-9]+$/, "");
  const cleaned = withoutExtension
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
  return `${cleaned || "final-reel"}.${FINAL_REEL_EXTENSION}`;
}

export function validateFinalReelUpload(request: FinalReelUploadRequest): ContractResult<ValidatedFinalReelUpload> {
  const mime = (request.mimeType ?? "").trim().toLowerCase().split(";")[0];
  if (mime !== FINAL_REEL_MIME) {
    return fail("UNSUPPORTED_MIME", `The final Reel must be ${FINAL_REEL_MIME}. Received "${request.mimeType || "nothing"}".`);
  }
  // Extension is a SECONDARY check only — MIME is authoritative.
  const extension = (request.filename ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (extension && extension !== FINAL_REEL_EXTENSION) {
    return fail("UNSUPPORTED_EXTENSION", `The final Reel file must end in .${FINAL_REEL_EXTENSION}. Received ".${extension}".`);
  }
  const size = request.fileSizeBytes;
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return fail("EMPTY_FILE", "The final Reel file is empty or its size could not be determined.");
  }
  if (size < FINAL_REEL_MIN_BYTES) {
    return fail("EMPTY_FILE", "The final Reel file is too small to be a real video.");
  }
  if (size > FINAL_REEL_MAX_BYTES) {
    return fail(
      "FILE_TOO_LARGE",
      `The final Reel is ${(size / 1024 / 1024).toFixed(1)} MB. The maximum is ${FINAL_REEL_MAX_BYTES / 1024 / 1024} MB.`,
    );
  }
  return { ok: true, value: { safeFilename: safeFinalReelFilename(request.filename), mimeType: mime, fileSizeBytes: size } };
}

/**
 * Deterministic, client-scoped, SERVER-BUILT storage path. The browser never
 * supplies any path component; `version` and `clientId`/`projectId` come from the
 * database, and the filename is sanitised above.
 */
export function finalReelStoragePath(input: {
  clientId: string; videoProjectId: string; version: number; safeFilename: string;
}): string {
  return `${input.clientId}/${input.videoProjectId}/final/v${input.version}/${input.safeFilename}`;
}

/** Confirm an object actually landed under the path we minted for this client. */
export function finalReelPathBelongsToProject(path: string, clientId: string, videoProjectId: string): boolean {
  return path.startsWith(`${clientId}/${videoProjectId}/final/v`);
}

// ── Optional client-reported media metadata ─────────────────────────────────

export interface ReportedMediaMetadata {
  width?: unknown;
  height?: unknown;
  durationSec?: unknown;
}

export interface ResolvedMediaMetadata {
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  media_metadata_source: MediaMetadataSource;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 100_000
    ? Math.round(value)
    : null;
}

/**
 * Accept browser-probed dimensions/duration as ADVISORY only. Anything missing
 * or implausible stays null and is reported as unknown — never invented. The Deno
 * edge runtime cannot decode video, so `server_probed` is not produced today.
 */
export function resolveReportedMediaMetadata(reported: ReportedMediaMetadata | null | undefined): ResolvedMediaMetadata {
  const width = positiveInt(reported?.width);
  const height = positiveInt(reported?.height);
  const rawDuration = reported?.durationSec;
  const duration = typeof rawDuration === "number" && Number.isFinite(rawDuration) && rawDuration > 0 && rawDuration < 24 * 3600
    ? Math.round(rawDuration * 100) / 100
    : null;
  const any = width !== null || height !== null || duration !== null;
  return {
    width, height, duration_sec: duration,
    media_metadata_source: any ? "client_reported" : "unknown",
  };
}

/**
 * Advisory compatibility warnings against Meta's documented Reels specification.
 * These NEVER block upload or approval — the metadata is client-reported and may
 * be absent. They are surfaced to the operator so a likely rejection is caught
 * before scheduling rather than after Meta rejects the container.
 */
export function reelSpecWarnings(deliverable: Pick<FinalReelDeliverable, "width" | "height" | "duration_sec" | "file_size_bytes">): string[] {
  const warnings: string[] = [];
  const { width, height, duration_sec: duration } = deliverable;
  if (duration !== null) {
    if (duration < REEL_MEDIA_SPEC.minDurationSec) warnings.push(`Duration is ${duration}s; Instagram requires at least ${REEL_MEDIA_SPEC.minDurationSec}s.`);
    if (duration > REEL_MEDIA_SPEC.maxDurationSec) warnings.push(`Duration is ${Math.round(duration / 60)} minutes; Instagram allows at most ${REEL_MEDIA_SPEC.maxDurationSec / 60} minutes.`);
  }
  if (width !== null && width > REEL_MEDIA_SPEC.maxHorizontalPixels) {
    warnings.push(`Width is ${width}px; Instagram allows at most ${REEL_MEDIA_SPEC.maxHorizontalPixels}px.`);
  }
  if (width !== null && height !== null && height > 0) {
    const ratio = width / height;
    if (ratio < REEL_MEDIA_SPEC.minAspectRatio || ratio > REEL_MEDIA_SPEC.maxAspectRatio) {
      warnings.push(`Aspect ratio ${ratio.toFixed(2)}:1 is outside Instagram's accepted range.`);
    } else if (Math.abs(ratio - 9 / 16) > 0.02) {
      warnings.push(`Aspect ratio is ${ratio.toFixed(2)}:1; ${REEL_MEDIA_SPEC.recommendedAspectRatio} is recommended to avoid cropping.`);
    }
  }
  if (deliverable.file_size_bytes > REEL_MEDIA_SPEC.maxFileSizeBytesMeta) {
    warnings.push("File exceeds Instagram's 300 MB Reels limit.");
  }
  return warnings;
}

// ── Publication eligibility ────────────────────────────────────────────────

export type ReelPublicationCode =
  | "SUPPORTED"
  | "BLOCKED_NO_FINAL_REEL"
  | "BLOCKED_FINAL_REEL_NOT_APPROVED"
  | "BLOCKED_SHOT_CLIP_NOT_PUBLISHABLE"
  | "BLOCKED_UNSUPPORTED_MEDIA"
  | "BLOCKED_SUPERSEDED_VERSION"
  | "BLOCKED_MISSING_STORAGE_OBJECT"
  | "BLOCKED_ACCOUNT_CONFIGURATION"
  | "BLOCKED_PROJECT_RELATIONSHIP"
  | "BLOCKED_SOURCE_INELIGIBLE";

export interface ReelPublicationEligibility {
  supported: boolean;
  code: ReelPublicationCode;
  reason: string;
  /** False when an operator action can resolve it (upload/approve/configure). */
  permanent: boolean;
}

export interface ReelPublicationContext {
  /** The deliverable a Reel draft/record points at, or null when there is none. */
  deliverable: Pick<
    FinalReelDeliverable,
    "id" | "client_id" | "video_project_id" | "status" | "is_current" | "mime_type" | "storage_bucket" | "storage_path" | "superseded_at"
  > | null;
  /** The project the publication claims to belong to. */
  project: { id: string; client_id: string } | null;
  /** Client the distribution record belongs to. */
  recordClientId: string;
  /** Whether the storage object was confirmed present (null = not checked here). */
  storageObjectPresent?: boolean | null;
  /** Whether a usable Instagram destination account is configured. */
  destinationConfigured?: boolean;
}

const OK: ReelPublicationEligibility = { supported: true, code: "SUPPORTED", reason: "", permanent: false };

function blocked(code: ReelPublicationCode, reason: string, permanent = false): ReelPublicationEligibility {
  return { supported: false, code, reason, permanent };
}

/**
 * The authoritative Reel publication decision. Every layer (Reel Studio, Assets,
 * Distribution UI, scheduling backend, publishing worker, Instagram publisher)
 * routes through this so no layer can permit what another blocks.
 */
export function resolveReelPublicationEligibility(context: ReelPublicationContext): ReelPublicationEligibility {
  const { deliverable, project } = context;
  if (!deliverable) {
    return blocked(
      "BLOCKED_NO_FINAL_REEL",
      "This publication is not linked to a final Reel. Individual shot clips are production material, not the publishable deliverable — upload the finished edit to the Reel Studio project first.",
    );
  }
  if (deliverable.mime_type !== FINAL_REEL_MIME) {
    return blocked("BLOCKED_UNSUPPORTED_MEDIA", `The final Reel must be ${FINAL_REEL_MIME}.`, true);
  }
  if (deliverable.storage_bucket !== FINAL_REEL_BUCKET || !deliverable.storage_path) {
    return blocked("BLOCKED_MISSING_STORAGE_OBJECT", "The final Reel's stored file could not be located.");
  }
  if (deliverable.client_id !== context.recordClientId) {
    return blocked("BLOCKED_PROJECT_RELATIONSHIP", "The final Reel does not belong to this client.", true);
  }
  if (!project || project.id !== deliverable.video_project_id || project.client_id !== deliverable.client_id) {
    return blocked("BLOCKED_PROJECT_RELATIONSHIP", "The final Reel is not linked to this Reel Studio project.", true);
  }
  if (!deliverable.is_current || deliverable.superseded_at !== null) {
    return blocked(
      "BLOCKED_SUPERSEDED_VERSION",
      "This final Reel version has been superseded by a newer upload. Only the current version can be published.",
    );
  }
  if (deliverable.status === "rejected") {
    return blocked("BLOCKED_FINAL_REEL_NOT_APPROVED", "This final Reel was returned for revision. Upload a corrected version and approve it before publishing.");
  }
  if (deliverable.status !== "approved") {
    return blocked("BLOCKED_FINAL_REEL_NOT_APPROVED", "The final Reel must be approved before it can be scheduled or published.");
  }
  if (context.storageObjectPresent === false) {
    return blocked("BLOCKED_MISSING_STORAGE_OBJECT", "The final Reel's stored file is missing from the private bucket.");
  }
  if (context.destinationConfigured === false) {
    return blocked("BLOCKED_ACCOUNT_CONFIGURATION", "No Instagram business account is configured for this client. Add one in Client Settings before scheduling.");
  }
  return OK;
}

/** A distribution record that points at no deliverable is, by definition, clips. */
export function shotClipPublicationBlocked(): ReelPublicationEligibility {
  return blocked(
    "BLOCKED_SHOT_CLIP_NOT_PUBLISHABLE",
    "Individual Reel Studio shot clips cannot be published. They are the production package for the external editor; publish the finished Reel instead.",
    true,
  );
}

// ── Version / replacement rules ────────────────────────────────────────────

export interface ReplacementCheckInput {
  current: Pick<FinalReelDeliverable, "id" | "status" | "version"> | null;
  /** Publication state of the current version, if any distribution record exists. */
  currentPublishStatus: string | null;
  /** Operator explicitly confirmed replacing an approved-but-unpublished version. */
  acknowledgedReplaceApproved?: boolean;
}

export type ReplacementDecision =
  | { ok: true; supersedesVersion: number | null }
  | { ok: false; code: string; error: string };

const ACTIVE_PUBLICATION = new Set(["publishing", "published"]);

/**
 * Guard a new upload against silently replacing something that must not be
 * replaced. A version that is publishing or already published is never
 * superseded by an upload; an approved-but-unpublished version requires a
 * deliberate confirmation.
 */
export function validateFinalReelReplacement(input: ReplacementCheckInput): ReplacementDecision {
  const current = input.current;
  if (!current) return { ok: true, supersedesVersion: null };
  if (input.currentPublishStatus && ACTIVE_PUBLICATION.has(input.currentPublishStatus)) {
    return {
      ok: false,
      code: "CURRENT_VERSION_PUBLISHING",
      error: `Version ${current.version} is ${input.currentPublishStatus === "published" ? "already published" : "being published"} and cannot be replaced. Cancel or reconcile the publication first.`,
    };
  }
  if (current.status === "approved" && !input.acknowledgedReplaceApproved) {
    return {
      ok: false,
      code: "REPLACE_APPROVED_UNCONFIRMED",
      error: `Version ${current.version} is already approved. Confirm explicitly that you want to replace it with a new version.`,
    };
  }
  return { ok: true, supersedesVersion: current.version };
}

// ── Review transitions ─────────────────────────────────────────────────────

export type FinalReelReviewAction = "approve" | "request_revision";

export interface ReviewCheckInput {
  deliverable: Pick<FinalReelDeliverable, "id" | "status" | "is_current" | "mime_type" | "storage_path" | "superseded_at">;
  action: FinalReelReviewAction;
  feedback?: string | null;
  storageObjectPresent: boolean;
}

export function validateFinalReelReview(input: ReviewCheckInput): ContractResult<{ nextStatus: DeliverableReviewStatus }> {
  const d = input.deliverable;
  if (!d.is_current || d.superseded_at !== null) {
    return fail("NOT_CURRENT", "Only the current final Reel version can be reviewed. This version has been superseded.");
  }
  if (d.mime_type !== FINAL_REEL_MIME) {
    return fail("UNSUPPORTED_MEDIA", `Only ${FINAL_REEL_MIME} final Reels can be reviewed.`);
  }
  if (input.action === "approve") {
    if (!input.storageObjectPresent) {
      return fail("MISSING_OBJECT", "The uploaded file is missing from storage. Re-upload the final Reel before approving.");
    }
    if (d.status === "approved") return fail("ALREADY_APPROVED", "This final Reel version is already approved.");
    return { ok: true, value: { nextStatus: "approved" } };
  }
  const feedback = (input.feedback ?? "").trim();
  if (feedback.length < 8) {
    return fail("FEEDBACK_REQUIRED", "Explain what needs to change so the editor has actionable revision notes (at least 8 characters).");
  }
  return { ok: true, value: { nextStatus: "rejected" } };
}

// ── Shot package (external editing handoff) ────────────────────────────────

export interface ShotPackageClip {
  shot_number: number;
  status: string;
  clip_url: string | null;
  approved: boolean;
  is_current: boolean;
}

export interface ShotPackageSummary {
  totalShots: number;
  renderedClips: number;
  approvedClips: number;
  allClipsPresent: boolean;
  missingShotNumbers: number[];
  readyForExternalEdit: boolean;
}

/**
 * What the operator needs to know before sending the package to an editor:
 * is every expected clip actually rendered, and are they approved.
 */
export function summariseShotPackage(clips: ShotPackageClip[]): ShotPackageSummary {
  const ordered = [...clips].sort((a, b) => a.shot_number - b.shot_number);
  const rendered = ordered.filter((clip) => clip.clip_url !== null && clip.status === "complete");
  const approved = ordered.filter((clip) => clip.approved);
  const missing = ordered.filter((clip) => clip.clip_url === null || clip.status !== "complete").map((clip) => clip.shot_number);
  return {
    totalShots: ordered.length,
    renderedClips: rendered.length,
    approvedClips: approved.length,
    allClipsPresent: ordered.length > 0 && missing.length === 0,
    missingShotNumbers: missing,
    readyForExternalEdit: ordered.length > 0 && missing.length === 0,
  };
}
