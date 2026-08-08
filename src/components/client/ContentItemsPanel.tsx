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
} from "@/lib/content-items";
import type { ContentItem, ContentBrief } from "@/types/content-brief";

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
          </div>
        )}
      </div>
    </div>
  );
}
