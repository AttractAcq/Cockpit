import type { ClientContextFile, ClientContextPatchDraft, ContextPatchStatus } from "@/types/phase";

export const CONTEXT_PATCH_TYPES = ["add","revise","remove","clarify","emphasize","de_emphasize","replace_section","other"] as const;
export const CONTEXT_PATCH_STATUSES = ["draft","needs_review","approved","applied","dismissed","superseded"] as const;

export function validContextPatchTransition(from: ContextPatchStatus, to: ContextPatchStatus): boolean {
  return (from==="draft" && (to==="needs_review"||to==="dismissed"))
    || (from==="needs_review" && (to==="approved"||to==="dismissed"))
    || (from==="approved" && to==="dismissed")
    || (from==="dismissed" && to==="dismissed");
}

export function contextPatchHasReviewContent(patch: Pick<ClientContextPatchDraft,"proposed_content"|"proposed_diff">): boolean {
  return Boolean(patch.proposed_content?.trim() || patch.proposed_diff?.trim());
}

export function isContextPatchStale(
  patch: Pick<ClientContextPatchDraft,"base_file_version"|"base_content_hash">,
  file: Pick<ClientContextFile,"version"> | null,
  currentContentHash?: string | null,
): boolean {
  if (!file || file.version !== patch.base_file_version) return true;
  return currentContentHash != null && currentContentHash !== patch.base_content_hash;
}

export function contextPatchVersionLabel(
  patch: Pick<ClientContextPatchDraft,"base_file_version">,
  file: Pick<ClientContextFile,"version"> | null,
): string {
  if (!file) return "target unavailable";
  return file.version === patch.base_file_version ? `current v${file.version} · hash rechecked on apply` : `stale · base v${patch.base_file_version}, current v${file.version}`;
}
