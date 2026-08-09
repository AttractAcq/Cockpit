// Programme Stage H — operator surface for Content Items: the canonical
// parent of production, distribution and performance. List + detail with
// the current Brief's full structured breakdown, generate/review actions.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/primitives";
import {
  fetchContentItems,
  fetchContentBriefsForItem,
  generateContentBrief,
  reviewContentBrief,
  fetchRenditionsForItem,
  createFacebookRendition,
  updateFacebookRendition,
  reviewFacebookRendition,
} from "@/lib/content-items";
import { fetchAssetsForItem } from "@/lib/production-studio";
import type { ContentItem, ContentBrief, ContentItemRendition, RenditionFormat } from "@/types/content-brief";
import type { ContentItemAsset } from "@/types/production-studio";

const RENDITION_FORMATS: RenditionFormat[] = ["IMAGE", "VIDEO", "REELS", "TEXT_LINK", "CAROUSEL", "STORIES"];
const RENDITION_STATUS_COLOR: Record<string, string> = {
  draft: "text-paper-3", in_review: "text-warn", approved: "text-teal", superseded: "text-paper-3",
};

function RenditionsSection({ clientId, contentItemId }: { clientId: string; contentItemId: string }) {
  const [renditions, setRenditions] = useState<ContentItemRendition[]>([]);
  const [assets, setAssets] = useState<ContentItemAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftFormat, setDraftFormat] = useState<RenditionFormat>("IMAGE");
  const [draftCopy, setDraftCopy] = useState("");
  const [draftCta, setDraftCta] = useState("");
  const [draftMedia, setDraftMedia] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCopy, setEditCopy] = useState("");
  const [editCta, setEditCta] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [r, a] = await Promise.all([fetchRenditionsForItem(contentItemId), fetchAssetsForItem(contentItemId)]);
      setRenditions(r); setAssets(a);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, [contentItemId]);
  useEffect(() => { void load(); }, [load]);

  const activeRenditions = renditions.filter((r) => r.status !== "superseded");

  async function handleCreate() {
    setBusy(true); setError(null);
    try {
      await createFacebookRendition({ clientId, contentItemId, format: draftFormat, copy: draftCopy, cta: draftCta, media: draftMedia });
      setCreating(false); setDraftCopy(""); setDraftCta(""); setDraftMedia([]);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  function startEdit(r: ContentItemRendition) {
    setEditingId(r.id); setEditCopy(r.copy); setEditCta(r.cta);
  }

  async function saveEdit(renditionId: string) {
    setBusy(true); setError(null);
    try { await updateFacebookRendition({ clientId, renditionId, copy: editCopy, cta: editCta }); setEditingId(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  async function review(renditionId: string, action: "submit_for_review" | "approve" | "request_changes") {
    setBusy(true); setError(null);
    try { await reviewFacebookRendition({ clientId, renditionId, action }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <div className="mt-6 border-t border-line pt-4">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-xs font-medium text-paper">Platform Renditions</h4>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => setCreating((v) => !v)}>
          {creating ? "Cancel" : "Create Facebook rendition"}
        </Button>
      </div>
      {error && <p className="mb-2 text-2xs text-neg">{error}</p>}
      {loading && <p className="text-2xs text-paper-3">Loading renditions…</p>}

      {creating && (
        <div className="mb-3 rounded border border-line p-3">
          <label className="mb-2 block text-2xs text-paper-3">
            Format
            <select className="ml-2 border border-line bg-ink px-1 py-0.5 text-2xs text-paper" value={draftFormat} onChange={(e) => setDraftFormat(e.target.value as RenditionFormat)}>
              {RENDITION_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <textarea className="mb-2 w-full border border-line bg-ink p-1 text-2xs text-paper" placeholder="Facebook copy…" value={draftCopy} onChange={(e) => setDraftCopy(e.target.value)} />
          <input className="mb-2 w-full border border-line bg-ink p-1 text-2xs text-paper" placeholder="Call to action…" value={draftCta} onChange={(e) => setDraftCta(e.target.value)} />
          {assets.length > 0 && (
            <div className="mb-2">
              <span className="text-2xs text-paper-3">Media:</span>
              {assets.map((a) => (
                <label key={a.id} className="ml-2 text-2xs text-paper-2">
                  <input
                    type="checkbox"
                    checked={draftMedia.includes(a.id)}
                    onChange={(e) => setDraftMedia((m) => e.target.checked ? [...m, a.id] : m.filter((id) => id !== a.id))}
                  />
                  {" "}{a.asset_category ?? a.kind}
                </label>
              ))}
            </div>
          )}
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void handleCreate()}>Create</Button>
        </div>
      )}

      {!loading && activeRenditions.length === 0 && <p className="text-2xs text-paper-3">No platform renditions yet.</p>}

      {activeRenditions.map((r) => (
        <div key={r.id} className="mb-2 rounded border border-line p-3">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-2xs uppercase text-paper">{r.platform}</span>
            <span className="text-2xs text-paper-3">{r.format}</span>
            <span className="text-2xs text-paper-3">v{r.rendition_version}</span>
            <span className={`text-2xs ${RENDITION_STATUS_COLOR[r.status]}`}>{r.status}</span>
            {!r.capability_snapshot.supported && (
              <span className="text-2xs text-neg">Unsupported: {r.capability_snapshot.reason}</span>
            )}
          </div>

          {editingId === r.id ? (
            <div>
              <textarea className="mb-2 w-full border border-line bg-ink p-1 text-2xs text-paper" value={editCopy} onChange={(e) => setEditCopy(e.target.value)} />
              <input className="mb-2 w-full border border-line bg-ink p-1 text-2xs text-paper" value={editCta} onChange={(e) => setEditCta(e.target.value)} />
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void saveEdit(r.id)}>Save</Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => setEditingId(null)}>Cancel</Button>
            </div>
          ) : (
            <>
              <p className="text-2xs text-paper-2">{r.copy || <em className="text-paper-3">No copy yet.</em>}</p>
              <p className="text-2xs text-paper-3">CTA: {r.cta || <em>none</em>}</p>
              <p className="text-2xs text-paper-3">{r.media.length} media asset(s)</p>
              {r.change_request_notes && <p className="text-2xs text-warn">Changes requested: {r.change_request_notes}</p>}
            </>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            {r.status === "draft" && editingId !== r.id && (
              <>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => startEdit(r)}>Edit</Button>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void review(r.id, "submit_for_review")}>Submit for review</Button>
              </>
            )}
            {r.status === "in_review" && (
              <>
                <Button variant="primary" size="sm" disabled={busy} onClick={() => void review(r.id, "approve")}>Approve</Button>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void review(r.id, "request_changes")}>Request changes</Button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

type Notice = { kind: "success" | "error" | "info"; text: string } | null;

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const v = error as { message?: string; code?: string };
    return [v.message, v.code && `Code: ${v.code}`].filter(Boolean).join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

const STATUS_COLOR: Record<string, string> = {
  draft: "text-paper-3",
  in_review: "text-warn",
  approved: "text-teal",
  superseded: "text-paper-3",
};

interface Props {
  clientId: string;
}

export function ContentItemsPanel({ clientId }: Props) {
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [items, setItems] = useState<ContentItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [briefs, setBriefs] = useState<ContentBrief[]>([]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchContentItems(clientId);
      setItems(rows);
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const loadBriefs = useCallback(async (itemId: string) => {
    try {
      setBriefs(await fetchContentBriefsForItem(itemId));
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    }
  }, []);

  useEffect(() => { if (selectedItemId) loadBriefs(selectedItemId); }, [selectedItemId, loadBriefs]);

  const selectedItem = items.find((i) => i.id === selectedItemId) ?? null;
  const currentBrief = briefs.find((b) => b.id === selectedItem?.current_content_brief_id) ?? briefs[0] ?? null;

  const handleGenerate = useCallback(async () => {
    if (!selectedItemId) return;
    setBusy(true);
    setNotice(null);
    try {
      await generateContentBrief({ clientId, contentItemId: selectedItemId });
      setNotice({ kind: "success", text: "Brief generated." });
      await loadItems();
      await loadBriefs(selectedItemId);
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }, [clientId, selectedItemId, loadItems, loadBriefs]);

  const handleReview = useCallback(async (action: "submit_for_review" | "approve" | "request_changes") => {
    if (!currentBrief) return;
    setBusy(true);
    setNotice(null);
    try {
      await reviewContentBrief({ clientId, contentBriefId: currentBrief.id, action });
      setNotice({ kind: "success", text: `${action.replace(/_/g, " ")} applied.` });
      if (selectedItemId) await loadBriefs(selectedItemId);
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }, [clientId, currentBrief, selectedItemId, loadBriefs]);

  return (
    <div className="flex gap-6">
      <div className="w-64 flex-none">
        {loading && <p className="text-xs text-paper-3">Loading…</p>}
        {!loading && items.length === 0 && (
          <p className="text-xs text-paper-3">
            No Content Items yet. These are created by approving a Calendar Proposal in Calendar Planning.
          </p>
        )}
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => setSelectedItemId(item.id)}
            className={`block w-full border-b border-line px-2 py-2 text-left text-xs ${selectedItemId === item.id ? "text-teal" : "text-paper hover:text-teal"}`}
          >
            {item.title}
            <span className="ml-2 text-2xs text-paper-3">{item.status}</span>
          </button>
        ))}
      </div>

      <div className="flex-1">
        {notice && (
          <p className={`mb-3 text-2xs ${notice.kind === "error" ? "text-neg" : notice.kind === "success" ? "text-teal" : "text-paper-3"}`}>
            {notice.text}
          </p>
        )}

        {!selectedItem && <p className="text-xs text-paper-3">Select a Content Item.</p>}

        {selectedItem && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm text-paper">{selectedItem.title}</h3>
              <span className="text-2xs text-paper-3">{selectedItem.status}</span>
              <Button variant="secondary" size="sm" disabled={busy} onClick={handleGenerate}>
                {currentBrief ? "Re-generate brief" : "Generate brief"}
              </Button>
            </div>

            {!currentBrief && <p className="text-xs text-paper-3">No Brief generated yet.</p>}

            {currentBrief && (
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-2xs text-paper-3">Version {currentBrief.brief_version}</span>
                  <span className={`text-2xs ${STATUS_COLOR[currentBrief.status]}`}>{currentBrief.status}</span>
                  {currentBrief.body.proof_required && (
                    <span className="text-2xs text-warn">Requires verified Proof to approve</span>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 border-b border-line pb-3">
                  {currentBrief.status === "draft" && (
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => handleReview("submit_for_review")}>
                      Submit for review
                    </Button>
                  )}
                  {currentBrief.status === "in_review" && (
                    <>
                      <Button variant="primary" size="sm" disabled={busy} onClick={() => handleReview("approve")}>
                        Approve
                      </Button>
                      <Button variant="secondary" size="sm" disabled={busy} onClick={() => handleReview("request_changes")}>
                        Request changes
                      </Button>
                    </>
                  )}
                </div>

                {currentBrief.rendered_markdown && (
                  <pre className="mt-3 whitespace-pre-wrap text-xs text-paper-2">{currentBrief.rendered_markdown}</pre>
                )}

                {briefs.length > 1 && (
                  <p className="mt-3 text-2xs text-paper-3">{briefs.length} version(s) recorded.</p>
                )}
              </div>
            )}

            <RenditionsSection clientId={clientId} contentItemId={selectedItem.id} />
          </div>
        )}
      </div>
    </div>
  );
}
