// Client-side PNG/ZIP export for generated image assets.
//
// Safety: never exposes private storage paths — media is fetched through a fresh
// signed URL (re-signed at click time, not a possibly-stale one). Non-PNG sources
// (jpeg/webp) are converted to PNG via the browser canvas API (no encoder is
// hand-rolled). ZIP packaging uses jszip. Filenames follow
// {source_ref}-{sequence_index}-v{version}.png and preserve sequence order.
import JSZip from "jszip";
import { signDistributionMedia } from "./api";
import type { ClientAssetRow } from "@/types/phase";

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "asset";
}

/** The frame's version — the real column (H7), falling back to metadata, then 1. */
export function assetVersion(asset: Pick<ClientAssetRow, "version" | "metadata">): number {
  if (typeof asset.version === "number" && Number.isFinite(asset.version) && asset.version > 0) return Math.trunc(asset.version);
  const value = (asset.metadata as { version?: unknown } | undefined)?.version;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 1;
}

export function assetPngFilename(asset: ClientAssetRow): string {
  return `${sanitize(asset.source_ref)}-${String(asset.sequence_index).padStart(2, "0")}-v${assetVersion(asset)}.png`;
}

async function convertToPng(blob: Blob, label: string): Promise<Blob> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(blob); }
  catch { throw new Error(`Could not decode the image for ${label}.`); }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(`Canvas is unavailable for ${label}.`);
    ctx.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error(`PNG conversion failed for ${label}.`);
    return png;
  } finally { bitmap.close(); }
}

/** Fetch one asset via a fresh signed URL and return its bytes as a PNG blob. */
async function assetPngBlob(asset: ClientAssetRow): Promise<Blob> {
  const label = `${asset.source_ref} #${asset.sequence_index}`;
  const url = await signDistributionMedia(asset.storage_bucket, asset.storage_path);
  if (!url) throw new Error(`Could not create a signed link for ${label}; the stored object may be missing.`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed for ${label} (HTTP ${res.status}); the object may be missing.`);
  const blob = await res.blob();
  if (blob.type === "image/png" || (blob.type === "" && asset.mime_type === "image/png")) return blob;
  return convertToPng(blob, label);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download a single asset as PNG. */
export async function downloadAssetPng(asset: ClientAssetRow): Promise<void> {
  triggerDownload(await assetPngBlob(asset), assetPngFilename(asset));
}

/**
 * Download several assets. One asset → a direct PNG; multiple → a ZIP with
 * sequence-ordered, human-readable filenames. Objects that cannot be fetched are
 * skipped and reported (the ZIP still downloads with what succeeded).
 */
export async function downloadAssetsZip(assets: ClientAssetRow[], zipBaseName: string): Promise<void> {
  const ordered = [...assets].sort((a, b) => a.sequence_index - b.sequence_index);
  if (ordered.length === 0) throw new Error("No assets were selected to export.");
  if (ordered.length === 1) return downloadAssetPng(ordered[0]);

  const zip = new JSZip();
  const used = new Set<string>();
  const errors: string[] = [];
  for (const asset of ordered) {
    try {
      const blob = await assetPngBlob(asset);
      let name = assetPngFilename(asset);
      if (used.has(name)) name = name.replace(/\.png$/, `-${asset.id.slice(0, 6)}.png`); // defensive de-dup
      used.add(name);
      zip.file(name, blob);
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  const packaged = Object.keys(zip.files).length;
  if (packaged === 0) throw new Error(`Nothing could be exported. ${errors.join(" ")}`.trim());
  triggerDownload(await zip.generateAsync({ type: "blob" }), `${sanitize(zipBaseName)}.zip`);
  if (errors.length) throw new Error(`Exported ${packaged} of ${ordered.length}. Some files could not be fetched: ${errors.join(" ")}`);
}
