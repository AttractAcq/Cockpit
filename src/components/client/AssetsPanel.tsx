import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/primitives";
import { fetchClientAssets } from "@/lib/api";
import type { ClientAssetRow } from "@/types/phase";

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { message?: string; code?: string; details?: string; hint?: string };
    return [value.message, value.code && `Code: ${value.code}`, value.details, value.hint].filter(Boolean).join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

function statusStyle(status: ClientAssetRow["status"]): string {
  if (status === "approved") return "border-teal/20 bg-teal/10 text-teal";
  if (status === "rejected") return "border-neg/20 bg-neg/10 text-neg";
  if (status === "archived") return "border-line bg-ink text-paper-3";
  return "border-warn/20 bg-warn/10 text-warn";
}

export function AssetsPanel({ clientId }: { clientId: string }) {
  const [assets, setAssets] = useState<ClientAssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setAssets(await fetchClientAssets(clientId)); }
    catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const reload = () => { void load(); };
    window.addEventListener("aa:reload", reload);
    return () => window.removeEventListener("aa:reload", reload);
  }, [load]);
  const groups = useMemo(() => {
    const map = new Map<string, ClientAssetRow[]>();
    for (const asset of assets) map.set(asset.asset_group_ref, [...(map.get(asset.asset_group_ref) ?? []), asset]);
    return [...map.entries()].map(([ref, rows]) => ({ ref, rows: rows.sort((a, b) => a.sequence_index - b.sequence_index) }))
      .sort((a, b) => b.rows[0].created_at.localeCompare(a.rows[0].created_at));
  }, [assets]);

  if (loading && !assets.length) return <div className="p-6 text-xs text-paper-3">Loading generated assets…</div>;
  return <div className="min-h-0 flex-1 overflow-y-auto p-4">
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[10px] border border-line bg-ink-200 px-4 py-3">
      <div><div className="text-sm text-paper">Generated Assets</div><div className="mt-1 text-2xs text-paper-3">Private Supabase Storage previews. Signed links expire after one hour.</div></div>
      <span className="ml-auto font-mono text-2xs text-paper-3">{groups.length} groups · {assets.length} files</span>
      <Button size="sm" variant="ghost" disabled={loading} onClick={() => void load()}>{loading ? "Reloading…" : "Reload"}</Button>
    </div>
    {error && <div role="alert" className="mb-3 rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
    {!groups.length ? <div className="rounded-[10px] border border-dashed border-line p-10 text-center"><div className="text-sm text-paper">No generated assets yet.</div><div className="mt-2 text-xs text-paper-3">Open an approved production brief in Content Creation and choose Produce → AI.</div></div> : <div className="space-y-4">{groups.map(({ ref, rows }) => <section key={ref} className="overflow-hidden rounded-[10px] border border-line bg-ink-200">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3"><div className="min-w-0 flex-1"><div className="font-mono text-2xs text-teal">{rows[0].source_ref}</div><div className="mt-1 break-words text-xs text-paper">{rows[0].title ?? rows[0].asset_format.replaceAll("_", " ")}</div></div><span className="text-2xs text-paper-3">{rows.length} {rows.length === 1 ? "image" : "images"}</span><span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${statusStyle(rows[0].status)}`}>{rows[0].status.replaceAll("_", " ")}</span></header>
      <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">{rows.map((asset) => <article key={asset.id} className="min-w-0 overflow-hidden rounded-lg border border-line bg-ink">
        <div className="flex aspect-[4/5] items-center justify-center bg-black/20">{asset.signed_url ? <img src={asset.signed_url} alt={asset.title ?? asset.source_ref} className="h-full w-full object-contain" /> : <span className="px-4 text-center text-xs text-paper-3">Preview unavailable. Reload to refresh the signed link.</span>}</div>
        <div className="space-y-1.5 p-3"><div className="flex items-center gap-2"><span className="font-mono text-2xs text-teal">#{asset.sequence_index}</span><span className="truncate text-xs text-paper">{asset.title ?? asset.source_ref}</span></div><div className="text-2xs text-paper-3">{asset.width}×{asset.height} · {asset.mime_type} · {asset.generation_model}</div>{asset.signed_url && <a href={asset.signed_url} target="_blank" rel="noreferrer" className="inline-block text-2xs text-teal hover:underline">Open full image ↗</a>}</div>
      </article>)}</div>
    </section>)}</div>}
  </div>;
}
