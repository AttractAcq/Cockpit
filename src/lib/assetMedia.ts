// Reel Studio Phase 2, Workstream D: authoritative media classification for
// client_assets.
//
// An asset's MEDIA type is decided by its stored MIME type first, then by its
// storage-path extension as a fallback. It is never inferred from the asset's
// logical content category (`asset_format`): a `reel_video` row is a video
// because its mime_type is video/mp4, not because of its name — and a future
// image-format row inside a video pipeline must still render as an image.
//
// Every preview and export control reads this module so the UI cannot classify
// one asset two different ways.

import type { ClientAssetRow } from "@/types/phase";

export type AssetMediaKind = "image" | "video" | "unsupported";

export interface MediaClassifiable {
  mime_type?: string | null;
  storage_path?: string | null;
}

const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/avif"]);
const VIDEO_MIME = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);
const VIDEO_EXT = new Set(["mp4", "mov", "webm", "m4v"]);

function normalizedMime(asset: MediaClassifiable): string {
  return (asset.mime_type ?? "").trim().toLowerCase().split(";")[0];
}

function pathExtension(asset: MediaClassifiable): string {
  const path = (asset.storage_path ?? "").trim().toLowerCase();
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}

export function assetMediaKind(asset: MediaClassifiable): AssetMediaKind {
  const mime = normalizedMime(asset);
  if (mime.startsWith("image/")) return IMAGE_MIME.has(mime) ? "image" : "unsupported";
  if (mime.startsWith("video/")) return VIDEO_MIME.has(mime) ? "video" : "unsupported";
  // Fallback only — used when a legacy row carries no usable MIME type.
  const extension = pathExtension(asset);
  if (IMAGE_EXT.has(extension)) return "image";
  if (VIDEO_EXT.has(extension)) return "video";
  return "unsupported";
}

export function isImageAsset(asset: MediaClassifiable): boolean {
  return assetMediaKind(asset) === "image";
}

export function isVideoAsset(asset: MediaClassifiable): boolean {
  return assetMediaKind(asset) === "video";
}

export function isUnsupportedAsset(asset: MediaClassifiable): boolean {
  return assetMediaKind(asset) === "unsupported";
}

/** True when every current file in a group is video. */
export function isVideoAssetGroup(rows: ReadonlyArray<MediaClassifiable>): boolean {
  return rows.length > 0 && rows.every(isVideoAsset);
}

/** Presentation aspect ratio: Reels and Stories are vertical, everything else 4:5. */
export function assetAspectClass(asset: Pick<ClientAssetRow, "asset_format"> & MediaClassifiable): string {
  if (isVideoAsset(asset)) return "aspect-[9/16]";
  return asset.asset_format === "story_sequence" || asset.asset_format === "reel_video" ? "aspect-[9/16]" : "aspect-[4/5]";
}

/** File extension to preserve when downloading the ORIGINAL bytes of an asset. */
export function assetOriginalExtension(asset: MediaClassifiable): string {
  const mime = normalizedMime(asset);
  switch (mime) {
    case "video/mp4": return "mp4";
    case "video/quicktime": return "mov";
    case "video/webm": return "webm";
    case "image/png": return "png";
    case "image/jpeg":
    case "image/jpg": return "jpg";
    case "image/webp": return "webp";
    default: return pathExtension(asset) || "bin";
  }
}

/** Human label for the media kind, used in buttons and empty/error states. */
export function assetMediaLabel(asset: MediaClassifiable): string {
  const kind = assetMediaKind(asset);
  if (kind === "video") return assetOriginalExtension(asset).toUpperCase();
  if (kind === "image") return "PNG";
  return "File";
}
