// Stage 2 Phase 05 — Marketing IA consolidation. The Campaigns object,
// v1: name, channel, an approved offer, an approved avatar, dates, status.
// Budget and results are real columns on the table but never surfaced here
// -- explicit empty shells pending Finance (08) and real Distribution
// linkage. Asset linkage deferred entirely.

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, Panel } from "@/components/primitives";
import {
  fetchMarketingCampaigns, fetchMainOfferOptions, fetchAvatarReleaseOptions,
  createMarketingCampaign, updateMarketingCampaignStatus,
} from "@/lib/marketing-campaigns";
import type { MarketingCampaignRow, MarketingCampaignStatus, MainOfferOption, AvatarReleaseOption } from "@/types/marketing-campaign";
import { fmtRelative } from "@/lib/format";

const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";
const STATUS_COLOR: Record<MarketingCampaignStatus, string> = { planning: "text-paper-3", active: "text-teal", completed: "text-info", archived: "text-paper-3" };
const NEXT_STATUS: Record<MarketingCampaignStatus, MarketingCampaignStatus | null> = { planning: "active", active: "completed", completed: "archived", archived: null };

export function MarketingCampaignsPanel({ clientId }: { clientId: string }) {
  const [campaigns, setCampaigns] = useState<MarketingCampaignRow[]>([]);
  const [offers, setOffers] = useState<MainOfferOption[]>([]);
  const [avatars, setAvatars] = useState<AvatarReleaseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", channel: "", mainOfferId: "", avatarReleaseId: "" });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [c, o, a] = await Promise.all([fetchMarketingCampaigns(clientId), fetchMainOfferOptions(clientId), fetchAvatarReleaseOptions(clientId)]);
      setCampaigns(c); setOffers(o); setAvatars(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (!form.name.trim()) return;
    setBusy("create"); setError(null);
    try {
      await createMarketingCampaign({
        clientId, name: form.name, channel: form.channel || null,
        mainOfferId: form.mainOfferId || null, avatarReleaseId: form.avatarReleaseId || null,
      });
      setForm({ name: "", channel: "", mainOfferId: "", avatarReleaseId: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function advance(campaign: MarketingCampaignRow) {
    const next = NEXT_STATUS[campaign.status];
    if (!next) return;
    setBusy(campaign.id); setError(null);
    try { await updateMarketingCampaignStatus(campaign.id, next); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  const offerName = (id: string | null) => (id ? offers.find((o) => o.id === id)?.offer_name ?? id : null);
  const avatarTitle = (id: string | null) => (id ? avatars.find((a) => a.id === id)?.title ?? id : null);

  if (loading) return <p className="p-4 text-2xs text-paper-3">Loading…</p>;

  return (
    <div className="flex flex-col gap-3 p-4">
      {error && <p className="text-2xs text-neg">{error}</p>}
      <div className="flex flex-wrap items-end gap-2 rounded border border-line bg-ink-200 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-2xs text-paper-3">Name</span>
          <input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-2xs text-paper-3">Channel</span>
          <input className={field} placeholder="e.g. instagram" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-2xs text-paper-3">Offer (optional)</span>
          <select className={field} value={form.mainOfferId} onChange={(e) => setForm({ ...form, mainOfferId: e.target.value })}>
            <option value="">None</option>
            {offers.map((o) => <option key={o.id} value={o.id}>{o.offer_name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-2xs text-paper-3">Avatar (optional)</span>
          <select className={field} value={form.avatarReleaseId} onChange={(e) => setForm({ ...form, avatarReleaseId: e.target.value })}>
            <option value="">None</option>
            {avatars.map((a) => <option key={a.id} value={a.id}>{a.title} (v{a.version})</option>)}
          </select>
        </label>
        <Button size="sm" variant="primary" disabled={busy === "create" || !form.name.trim()} onClick={() => void submit()}>Create campaign</Button>
      </div>

      <Panel title="Campaigns" meta={`${campaigns.length}`}>
        {campaigns.length === 0 ? (
          <EmptyState icon="campaign" title="No campaigns yet" body="Create one above to link an offer and avatar to a cross-channel push." />
        ) : (
          <div className="space-y-1 p-2">
            {campaigns.map((c) => (
              <div key={c.id} className="rounded border border-line bg-ink p-2 text-2xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-paper font-medium">{c.name}</span>
                  <span className={`font-mono uppercase ${STATUS_COLOR[c.status]}`}>{c.status}</span>
                  {c.channel && <span className="text-paper-3">· {c.channel}</span>}
                  <span className="text-paper-3 font-mono ml-auto">{fmtRelative(c.created_at)}</span>
                </div>
                <p className="mt-1 text-paper-2">
                  {offerName(c.main_offer_id) ? `Offer: ${offerName(c.main_offer_id)}` : "No offer linked"}
                  {" · "}
                  {avatarTitle(c.avatar_release_id) ? `Avatar: ${avatarTitle(c.avatar_release_id)}` : "No avatar linked"}
                </p>
                <p className="mt-1 text-paper-3">Budget and results are not tracked yet — pending Finance and Distribution linkage.</p>
                {NEXT_STATUS[c.status] && (
                  <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => void advance(c)}>
                    Move to {NEXT_STATUS[c.status]}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
