// Programme Stage L — Ad Studio and Paid Distribution. Ad Opportunity ->
// Ad Brief -> Creative Matrix -> Campaign, plus the per-client safety
// policy every launch is gated by. Launch calls a real, credential-gated
// edge function — in this environment no Meta ads credentials are
// configured, so it will correctly and honestly report "missing config"
// rather than pretend to spend money. See
// docs/programme/status/Stage_L_Status.md.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/primitives";
import {
  fetchAdOpportunities, createAdOpportunity, fetchAdBriefsForOpportunity, createAdBrief, reviewAdBrief,
  fetchCreativeVariantsForBrief, generateAdCreativeVariants, fetchAdBudgetPolicy, setAdBudgetPolicy,
  fetchAdCampaignsForBrief, createAdCampaign, launchAdCampaign, updateAdCampaignStatus, updateAdCampaignBudget,
  fetchLaunchAttemptsForCampaign,
} from "@/lib/ad-studio";
import { AD_OPPORTUNITY_ORIGIN_LABEL, AD_CAMPAIGN_STATUS_LABEL, type AdOpportunityRow, type AdOpportunityOrigin, type AdBriefRow, type AdBriefBody, type AdCreativeVariantRow, type AdBudgetPolicyRow, type AdCampaignRow, type AdLaunchAttemptRow } from "@/types/ad-studio";
import {
  fetchAdCampaignMetricSnapshots, fetchAdCampaignBusinessSignalSnapshots, upsertAdCampaignMetricSnapshot,
  upsertAdCampaignBusinessSignalSnapshot, fetchAdPerformanceScore, fetchAdPerformanceInsights, runAdCampaignPerformanceAnalysis,
} from "@/lib/api";
import type { AdCampaignMetricSnapshot, AdCampaignBusinessSignalSnapshot, ClientPerformanceScore, ClientPerformanceInsight, AdSupportedMetricKey } from "@/types/phase";

const AD_METRIC_KEYS: AdSupportedMetricKey[] = ["spend", "impressions", "cpm", "hook_rate", "ctr", "cpc", "landing_page_views"];

/**
 * Programme Stage M — paid metrics/business-signal entry and deterministic
 * scoring for one launched Ad Campaign. Mirrors AnalyticsPanel's manual
 * entry pattern (organic, Gate B) but keyed to ad_campaign_id and using the
 * paid-anchored siblings from src/lib/ad-performance-intelligence.ts. Only
 * shown for campaigns that have actually launched (active/paused/completed)
 * — the same "requires real evidence" rule the organic gates enforce.
 */
function AdCampaignPerformanceSection({ campaign }: { campaign: AdCampaignRow }) {
  const [metricSnapshots, setMetricSnapshots] = useState<AdCampaignMetricSnapshot[]>([]);
  const [signalSnapshots, setSignalSnapshots] = useState<AdCampaignBusinessSignalSnapshot[]>([]);
  const [score, setScore] = useState<ClientPerformanceScore | null>(null);
  const [insights, setInsights] = useState<ClientPerformanceInsight[]>([]);
  const [metricValues, setMetricValues] = useState<Record<string, string>>({});
  const [signalValues, setSignalValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    try {
      const [metrics, signals, scoreRow, insightRows] = await Promise.all([
        fetchAdCampaignMetricSnapshots(campaign.id), fetchAdCampaignBusinessSignalSnapshots(campaign.id),
        fetchAdPerformanceScore(campaign.id), fetchAdPerformanceInsights(campaign.id),
      ]);
      setMetricSnapshots(metrics); setSignalSnapshots(signals); setScore(scoreRow); setInsights(insightRows);
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
  }, [campaign.id]);
  useEffect(() => { void load(); }, [load]);

  async function saveMetrics() {
    setBusy(true); setNotice(null);
    try {
      const metrics: Record<string, number> = {};
      for (const key of AD_METRIC_KEYS) { const raw = metricValues[key]; if (raw?.trim()) metrics[key] = Number(raw); }
      await upsertAdCampaignMetricSnapshot({ adCampaignId: campaign.id, snapshotAt: new Date().toISOString(), snapshotLabel: "manual", metrics });
      setMetricValues({}); await load();
      setNotice({ kind: "success", text: "Paid metric snapshot saved." });
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); } finally { setBusy(false); }
  }

  async function saveSignals() {
    setBusy(true); setNotice(null);
    try {
      await upsertAdCampaignBusinessSignalSnapshot({
        adCampaignId: campaign.id, signalAt: new Date().toISOString(),
        leads: signalValues.leads ? Number(signalValues.leads) : null,
        qualifiedLeads: signalValues.qualified_leads ? Number(signalValues.qualified_leads) : null,
        appointments: signalValues.appointments ? Number(signalValues.appointments) : null,
        showUps: signalValues.show_ups ? Number(signalValues.show_ups) : null,
        cashCollected: signalValues.cash_collected ? Number(signalValues.cash_collected) : null,
        cac: signalValues.cac ? Number(signalValues.cac) : null,
        roas: signalValues.roas ? Number(signalValues.roas) : null,
      });
      setSignalValues({}); await load();
      setNotice({ kind: "success", text: "Business signals saved." });
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); } finally { setBusy(false); }
  }

  async function analyze() {
    setBusy(true); setNotice(null);
    try {
      const result = await runAdCampaignPerformanceAnalysis(campaign.id, campaign.name, campaign.created_at);
      setNotice({ kind: "success", text: `Scored ${result.score.overall_score}/100. ${result.insightsCreated} new insight(s).` });
      await load();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); } finally { setBusy(false); }
  }

  const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";
  return <div className="mt-3 rounded border border-line bg-ink-200 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h5 className="text-xs font-medium text-paper">Paid Performance &amp; Iteration</h5>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void analyze()}>Run performance analysis</Button>
    </div>
    {notice && <p className={`mt-1 text-2xs ${notice.kind === "error" ? "text-neg" : "text-teal"}`}>{notice.text}</p>}

    {score && <div className="mt-2 grid grid-cols-4 gap-2 text-center text-2xs">
      <div className="rounded border border-line bg-ink p-2"><div className="font-mono text-base text-paper">{score.overall_score}</div><div className="text-paper-3">Overall</div></div>
      <div className="rounded border border-line bg-ink p-2"><div className="font-mono text-base text-paper">{score.attention_score}</div><div className="text-paper-3">Efficiency</div></div>
      <div className="rounded border border-line bg-ink p-2"><div className="font-mono text-base text-paper">{score.engagement_score}</div><div className="text-paper-3">Volume</div></div>
      <div className="rounded border border-line bg-ink p-2"><div className="font-mono text-base text-paper">{score.conversion_signal_score}</div><div className="text-paper-3">Conversion</div></div>
    </div>}
    {!score && <p className="mt-2 text-2xs text-paper-3">No score yet — record metrics, then run analysis.</p>}

    {insights.length > 0 && <div className="mt-2 space-y-1">{insights.map((i) => <div key={i.id} className="rounded border border-line bg-ink p-2 text-2xs"><span className="text-paper">{i.title}</span><span className="ml-2 text-paper-3">{i.insight_type.replaceAll("_", " ")}</span><p className="mt-1 text-paper-3">{i.summary}</p>{i.recommended_action && <p className="mt-1 text-teal">{i.recommended_action}</p>}</div>)}</div>}

    <details className="mt-3"><summary className="cursor-pointer text-2xs text-paper-3">Record paid metrics ({metricSnapshots.length} snapshot{metricSnapshots.length === 1 ? "" : "s"})</summary>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {AD_METRIC_KEYS.map((key) => <label key={key} className="flex flex-col gap-1"><span className="text-2xs text-paper-3">{key.replaceAll("_", " ")}</span><input type="number" min="0" step="any" className={field} value={metricValues[key] ?? ""} onChange={(e) => setMetricValues((cur) => ({ ...cur, [key]: e.target.value }))} /></label>)}
      </div>
      <Button size="sm" variant="primary" className="mt-2" disabled={busy || campaign.status === "draft"} onClick={() => void saveMetrics()}>Save metric snapshot</Button>
    </details>

    <details className="mt-2"><summary className="cursor-pointer text-2xs text-paper-3">Record business signals ({signalSnapshots.length} snapshot{signalSnapshots.length === 1 ? "" : "s"})</summary>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["leads", "qualified_leads", "appointments", "show_ups", "cash_collected", "cac", "roas"] as const).map((key) => <label key={key} className="flex flex-col gap-1"><span className="text-2xs text-paper-3">{key.replaceAll("_", " ")}</span><input type="number" min="0" step={key === "cash_collected" || key === "cac" ? "0.01" : key === "roas" ? "0.0001" : "1"} className={field} value={signalValues[key] ?? ""} onChange={(e) => setSignalValues((cur) => ({ ...cur, [key]: e.target.value }))} /></label>)}
      </div>
      <Button size="sm" variant="primary" className="mt-2" disabled={busy} onClick={() => void saveSignals()}>Save business signals</Button>
    </details>
  </div>;
}

type Notice = { kind: "success" | "error" | "info"; text: string } | null;
function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const v = error as { message?: string; code?: string };
    return [v.message, v.code && `Code: ${v.code}`].filter(Boolean).join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

const ORIGINS: AdOpportunityOrigin[] = ["manual_idea", "proof", "research", "campaign_requirement", "organic_winner", "performance_insight", "offer_launch", "seasonal_trigger"];

function splitLines(value: string): string[] {
  return value.split("\n").map((s) => s.trim()).filter(Boolean);
}

function emptyBriefForm() {
  return {
    campaign_objective: "", awareness_stage: "problem_aware", audience: "", offer: "", landing_page: "",
    primary_claim: "", proof_required: false, hooks: "", visuals: "", copy: "", ctas: "", placement: "feed",
    testing_role: "hook_test", pixel_id: "", conversion_event: "",
  };
}

function BudgetPolicySection({ clientId }: { clientId: string }) {
  const [policy, setPolicy] = useState<AdBudgetPolicyRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [form, setForm] = useState({
    adAccountId: "", adAccountOwnerVerified: false, paymentMethodVerified: false,
    spendLimitDaily: "", spendLimitTotal: "", requiresClientApproval: true,
    allowedGeographies: "", restrictedAudienceFlags: "", regulatedCategories: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const row = await fetchAdBudgetPolicy(clientId);
      setPolicy(row);
      if (row) {
        setForm({
          adAccountId: row.ad_account_id ?? "", adAccountOwnerVerified: row.ad_account_owner_verified,
          paymentMethodVerified: row.payment_method_verified,
          spendLimitDaily: row.spend_limit_daily?.toString() ?? "", spendLimitTotal: row.spend_limit_total?.toString() ?? "",
          requiresClientApproval: row.requires_client_approval,
          allowedGeographies: row.allowed_geographies.join(", "), restrictedAudienceFlags: row.restricted_audience_flags.join(", "),
          regulatedCategories: row.regulated_categories.join(", "),
        });
      }
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setLoading(false); }
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setBusy(true); setNotice(null);
    try {
      await setAdBudgetPolicy({
        clientId, adAccountId: form.adAccountId || undefined,
        adAccountOwnerVerified: form.adAccountOwnerVerified, paymentMethodVerified: form.paymentMethodVerified,
        spendLimitDaily: form.spendLimitDaily ? Number(form.spendLimitDaily) : null,
        spendLimitTotal: form.spendLimitTotal ? Number(form.spendLimitTotal) : null,
        requiresClientApproval: form.requiresClientApproval,
        allowedGeographies: form.allowedGeographies.split(",").map((s) => s.trim()).filter(Boolean),
        restrictedAudienceFlags: form.restrictedAudienceFlags.split(",").map((s) => s.trim()).filter(Boolean),
        regulatedCategories: form.regulatedCategories.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setNotice({ kind: "success", text: "Ad safety policy saved." });
      await load();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";
  if (loading) return <div className="text-2xs text-paper-3">Loading policy…</div>;
  return <div className="rounded-[10px] border border-line bg-ink-200 p-4">
    <h3 className="mb-1 text-xs font-medium text-paper">Ad Safety Policy</h3>
    <p className="mb-3 text-2xs text-paper-3">No campaign can launch without an explicit, approved policy. {!policy && "No policy is set for this client yet — every launch will be blocked until one is."}</p>
    {notice && <p className={`mb-2 text-2xs ${notice.kind === "error" ? "text-neg" : "text-teal"}`}>{notice.text}</p>}
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Ad account ID</span><input className={field} value={form.adAccountId} onChange={(e) => setForm({ ...form, adAccountId: e.target.value })} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Daily spend limit</span><input type="number" className={field} value={form.spendLimitDaily} onChange={(e) => setForm({ ...form, spendLimitDaily: e.target.value })} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Total spend limit</span><input type="number" className={field} value={form.spendLimitTotal} onChange={(e) => setForm({ ...form, spendLimitTotal: e.target.value })} /></label>
      <label className="flex flex-col gap-1 sm:col-span-3"><span className="text-2xs text-paper-3">Allowed geographies (comma-separated, e.g. NL, DE)</span><input className={field} value={form.allowedGeographies} onChange={(e) => setForm({ ...form, allowedGeographies: e.target.value })} /></label>
      <label className="flex flex-col gap-1 sm:col-span-3"><span className="text-2xs text-paper-3">Restricted audience flags (comma-separated)</span><input className={field} value={form.restrictedAudienceFlags} onChange={(e) => setForm({ ...form, restrictedAudienceFlags: e.target.value })} /></label>
      <label className="flex flex-col gap-1 sm:col-span-3"><span className="text-2xs text-paper-3">Regulated categories (comma-separated)</span><input className={field} value={form.regulatedCategories} onChange={(e) => setForm({ ...form, regulatedCategories: e.target.value })} /></label>
    </div>
    <div className="mt-3 flex flex-wrap gap-4 text-2xs text-paper-2">
      <label className="flex items-center gap-2"><input type="checkbox" checked={form.adAccountOwnerVerified} onChange={(e) => setForm({ ...form, adAccountOwnerVerified: e.target.checked })} />Ad account ownership verified</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={form.paymentMethodVerified} onChange={(e) => setForm({ ...form, paymentMethodVerified: e.target.checked })} />Payment method verified</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={form.requiresClientApproval} onChange={(e) => setForm({ ...form, requiresClientApproval: e.target.checked })} />Requires client approval before launch</label>
    </div>
    <Button size="sm" variant="primary" className="mt-3" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save policy"}</Button>
  </div>;
}

export function AdStudioPanel({ clientId }: { clientId: string }) {
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [opportunities, setOpportunities] = useState<AdOpportunityRow[]>([]);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(null);
  const [briefs, setBriefs] = useState<AdBriefRow[]>([]);
  const [variants, setVariants] = useState<AdCreativeVariantRow[]>([]);
  const [campaigns, setCampaigns] = useState<AdCampaignRow[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<AdLaunchAttemptRow[]>([]);

  const [newOpp, setNewOpp] = useState({ title: "", origin: "manual_idea" as AdOpportunityOrigin, coreClaim: "" });
  const [briefForm, setBriefForm] = useState(emptyBriefForm());
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([]);
  const [campaignForm, setCampaignForm] = useState({ name: "", objective: "OUTCOME_TRAFFIC", budgetDaily: "" });

  const loadOpportunities = useCallback(async () => {
    setLoading(true);
    try { setOpportunities(await fetchAdOpportunities(clientId)); }
    catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setLoading(false); }
  }, [clientId]);
  useEffect(() => { void loadOpportunities(); }, [loadOpportunities]);

  const loadOpportunityDetail = useCallback(async (opportunityId: string) => {
    try { setBriefs(await fetchAdBriefsForOpportunity(opportunityId)); }
    catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
  }, []);
  useEffect(() => {
    setBriefs([]); setVariants([]); setCampaigns([]); setSelectedCampaignId(null);
    if (selectedOpportunityId) loadOpportunityDetail(selectedOpportunityId);
  }, [selectedOpportunityId, loadOpportunityDetail]);

  const approvedBrief = briefs.find((b) => b.status === "approved") ?? null;
  const latestBrief = briefs[0] ?? null;

  const loadBriefDetail = useCallback(async (briefId: string) => {
    try {
      const [variantRows, campaignRows] = await Promise.all([fetchCreativeVariantsForBrief(briefId), fetchAdCampaignsForBrief(briefId)]);
      setVariants(variantRows); setCampaigns(campaignRows);
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
  }, []);
  useEffect(() => { if (latestBrief) loadBriefDetail(latestBrief.id); }, [latestBrief, loadBriefDetail]);

  const loadAttempts = useCallback(async (campaignId: string) => {
    try { setAttempts(await fetchLaunchAttemptsForCampaign(campaignId)); }
    catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
  }, []);
  useEffect(() => { if (selectedCampaignId) loadAttempts(selectedCampaignId); }, [selectedCampaignId, loadAttempts]);

  async function handleCreateOpportunity() {
    setBusy(true); setNotice(null);
    try {
      const result = await createAdOpportunity({ clientId, title: newOpp.title, origin: newOpp.origin, coreClaim: newOpp.coreClaim || undefined });
      setOpportunities((cur) => [result.opportunity, ...cur]);
      setNewOpp({ title: "", origin: "manual_idea", coreClaim: "" });
      setNotice({ kind: "success", text: "Ad Opportunity created." });
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  async function handleCreateBrief() {
    if (!selectedOpportunityId) return;
    setBusy(true); setNotice(null);
    const body: AdBriefBody = {
      campaign_objective: briefForm.campaign_objective, awareness_stage: briefForm.awareness_stage,
      audience: briefForm.audience, offer: briefForm.offer, landing_page: briefForm.landing_page,
      primary_claim: briefForm.primary_claim, proof_required: briefForm.proof_required,
      hook_variants: splitLines(briefForm.hooks), visual_variants: splitLines(briefForm.visuals),
      copy_variants: splitLines(briefForm.copy), cta_variants: splitLines(briefForm.ctas),
      placement: splitLines(briefForm.placement), testing_role: briefForm.testing_role,
      attribution_requirements: { pixel_id: briefForm.pixel_id || null, conversion_event: briefForm.conversion_event || null },
    };
    try {
      await createAdBrief({ clientId, adOpportunityId: selectedOpportunityId, briefBody: body });
      setNotice({ kind: "success", text: "Ad Brief created." });
      await loadOpportunityDetail(selectedOpportunityId);
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  async function handleReview(action: "submit_for_review" | "approve" | "request_changes") {
    if (!latestBrief || !selectedOpportunityId) return;
    const feedback = action === "request_changes" ? window.prompt("What needs to change?") ?? "" : undefined;
    if (action === "request_changes" && !feedback) return;
    setBusy(true); setNotice(null);
    try {
      await reviewAdBrief({ clientId, adBriefId: latestBrief.id, action, feedback });
      setNotice({ kind: "success", text: `Brief ${action.replace(/_/g, " ")}.` });
      await loadOpportunityDetail(selectedOpportunityId);
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  async function handleGenerateVariants() {
    if (!approvedBrief) return;
    setBusy(true); setNotice(null);
    try {
      const result = await generateAdCreativeVariants({ clientId, adBriefId: approvedBrief.id, formats: ["feed_image", "story_image"] });
      setNotice({ kind: "success", text: `${result.new_variant_count} new variant(s) generated (${result.total_combinations} total in matrix).` });
      await loadBriefDetail(approvedBrief.id);
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  async function handleCreateCampaign() {
    if (!approvedBrief || selectedVariantIds.length === 0) return;
    setBusy(true); setNotice(null);
    try {
      const result = await createAdCampaign({
        clientId, adBriefId: approvedBrief.id, name: campaignForm.name, objective: campaignForm.objective,
        budgetDaily: campaignForm.budgetDaily ? Number(campaignForm.budgetDaily) : undefined,
        selectedVariantIds,
      });
      setNotice({ kind: "success", text: result.idempotent_replay ? "Campaign already exists for this brief/name." : "Campaign draft created." });
      await loadBriefDetail(approvedBrief.id);
      setSelectedVariantIds([]);
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  async function handleLaunch(campaign: AdCampaignRow) {
    if (!window.confirm(`Launch "${campaign.name}"? This will attempt to spend real money if Meta credentials are configured.`)) return;
    setBusy(true); setNotice(null);
    try {
      const result = await launchAdCampaign({ clientId, adCampaignId: campaign.id, requestedGeographies: [], requestedAudienceFlags: [] });
      setNotice({ kind: result.ok ? "success" : "error", text: result.ok ? "Campaign launched." : `Launch did not complete: ${result.campaign.last_error ?? "see attempt log"}` });
      if (approvedBrief) await loadBriefDetail(approvedBrief.id);
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  async function handleStatusAction(campaign: AdCampaignRow, action: "pause" | "resume" | "complete" | "archive") {
    setBusy(true); setNotice(null);
    try {
      await updateAdCampaignStatus({ clientId, adCampaignId: campaign.id, action });
      setNotice({ kind: "success", text: `Campaign ${action}d.` });
      if (approvedBrief) await loadBriefDetail(approvedBrief.id);
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  async function handleBudgetUpdate(campaign: AdCampaignRow) {
    const value = window.prompt("New daily budget:", campaign.budget_daily?.toString() ?? "");
    if (!value) return;
    setBusy(true); setNotice(null);
    try {
      await updateAdCampaignBudget({ clientId, adCampaignId: campaign.id, budgetDaily: Number(value) });
      setNotice({ kind: "success", text: "Budget updated." });
      if (approvedBrief) await loadBriefDetail(approvedBrief.id);
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";

  return <div className="flex flex-col gap-4 p-4">
    {notice && <p className={`text-2xs ${notice.kind === "error" ? "text-neg" : notice.kind === "success" ? "text-teal" : "text-paper-3"}`}>{notice.text}</p>}

    <BudgetPolicySection clientId={clientId} />

    <div className="flex gap-6">
      <div className="w-72 flex-none">
        <h3 className="mb-2 text-xs font-medium text-paper">Ad Opportunities</h3>
        <div className="mb-3 space-y-1.5 rounded border border-line bg-ink-200 p-2">
          <input className={`${field} w-full`} placeholder="Title" value={newOpp.title} onChange={(e) => setNewOpp({ ...newOpp, title: e.target.value })} />
          <select className={`${field} w-full`} value={newOpp.origin} onChange={(e) => setNewOpp({ ...newOpp, origin: e.target.value as AdOpportunityOrigin })}>
            {ORIGINS.map((o) => <option key={o} value={o}>{AD_OPPORTUNITY_ORIGIN_LABEL[o]}</option>)}
          </select>
          <input className={`${field} w-full`} placeholder="Core claim (optional)" value={newOpp.coreClaim} onChange={(e) => setNewOpp({ ...newOpp, coreClaim: e.target.value })} />
          <Button size="sm" variant="primary" disabled={busy || !newOpp.title} onClick={() => void handleCreateOpportunity()}>Create</Button>
        </div>
        {loading && <p className="text-2xs text-paper-3">Loading…</p>}
        {!loading && opportunities.length === 0 && <p className="text-2xs text-paper-3">No Ad Opportunities yet.</p>}
        {opportunities.map((o) => (
          <button key={o.id} onClick={() => setSelectedOpportunityId(o.id)} className={`block w-full border-b border-line px-2 py-2 text-left text-xs ${selectedOpportunityId === o.id ? "text-teal" : "text-paper hover:text-teal"}`}>
            {o.title}
            <span className="ml-2 text-2xs text-paper-3">{AD_OPPORTUNITY_ORIGIN_LABEL[o.origin]} · {o.status}</span>
          </button>
        ))}
      </div>

      <div className="flex-1">
        {!selectedOpportunityId && <p className="text-xs text-paper-3">Select an Ad Opportunity.</p>}

        {selectedOpportunityId && <div>
          {!latestBrief && <div className="rounded border border-line bg-ink-200 p-3">
            <h4 className="mb-2 text-xs font-medium text-paper">New Ad Brief</h4>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input className={field} placeholder="Campaign objective" value={briefForm.campaign_objective} onChange={(e) => setBriefForm({ ...briefForm, campaign_objective: e.target.value })} />
              <select className={field} value={briefForm.awareness_stage} onChange={(e) => setBriefForm({ ...briefForm, awareness_stage: e.target.value })}>
                {["unaware", "problem_aware", "solution_aware", "product_aware", "most_aware"].map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
              </select>
              <input className={field} placeholder="Audience" value={briefForm.audience} onChange={(e) => setBriefForm({ ...briefForm, audience: e.target.value })} />
              <input className={field} placeholder="Offer" value={briefForm.offer} onChange={(e) => setBriefForm({ ...briefForm, offer: e.target.value })} />
              <input className={field} placeholder="Landing page URL" value={briefForm.landing_page} onChange={(e) => setBriefForm({ ...briefForm, landing_page: e.target.value })} />
              <input className={field} placeholder="Testing role" value={briefForm.testing_role} onChange={(e) => setBriefForm({ ...briefForm, testing_role: e.target.value })} />
            </div>
            <textarea className={`${field} mt-2 w-full`} placeholder="Primary claim" value={briefForm.primary_claim} onChange={(e) => setBriefForm({ ...briefForm, primary_claim: e.target.value })} />
            <label className="mt-2 flex items-center gap-2 text-2xs text-paper-2"><input type="checkbox" checked={briefForm.proof_required} onChange={(e) => setBriefForm({ ...briefForm, proof_required: e.target.checked })} />This claim requires verified Proof to approve</label>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <textarea className={field} placeholder="Hook variants (one per line)" value={briefForm.hooks} onChange={(e) => setBriefForm({ ...briefForm, hooks: e.target.value })} />
              <textarea className={field} placeholder="Visual variants (one per line)" value={briefForm.visuals} onChange={(e) => setBriefForm({ ...briefForm, visuals: e.target.value })} />
              <textarea className={field} placeholder="Copy variants (one per line)" value={briefForm.copy} onChange={(e) => setBriefForm({ ...briefForm, copy: e.target.value })} />
              <textarea className={field} placeholder="CTA variants (one per line)" value={briefForm.ctas} onChange={(e) => setBriefForm({ ...briefForm, ctas: e.target.value })} />
            </div>
            <textarea className={`${field} mt-2 w-full`} placeholder="Placement (one per line, e.g. feed, story)" value={briefForm.placement} onChange={(e) => setBriefForm({ ...briefForm, placement: e.target.value })} />
            <Button size="sm" variant="primary" className="mt-2" disabled={busy} onClick={() => void handleCreateBrief()}>Create Brief</Button>
          </div>}

          {latestBrief && <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-paper">Brief v{latestBrief.brief_version}</span>
              <span className="text-2xs text-paper-3">{latestBrief.status}</span>
              {latestBrief.status === "draft" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleReview("submit_for_review")}>Submit for review</Button>}
              {latestBrief.status === "in_review" && <>
                <Button size="sm" variant="primary" disabled={busy} onClick={() => void handleReview("approve")}>Approve</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleReview("request_changes")}>Request changes</Button>
              </>}
            </div>
            {latestBrief.rendered_markdown && <pre className="mb-3 whitespace-pre-wrap rounded border border-line bg-ink p-2 text-2xs text-paper-2">{latestBrief.rendered_markdown}</pre>}

            {approvedBrief && <div className="mb-4 rounded border border-line bg-ink-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-medium text-paper">Creative Matrix ({variants.length} variants)</h4>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleGenerateVariants()}>Generate variants</Button>
              </div>
              {variants.length > 0 && <div className="max-h-40 overflow-y-auto">
                {variants.map((v) => (
                  <label key={v.id} className="flex items-center gap-2 border-b border-line py-1 text-2xs text-paper-2">
                    <input type="checkbox" checked={selectedVariantIds.includes(v.id)} onChange={(e) => setSelectedVariantIds((cur) => e.target.checked ? [...cur, v.id] : cur.filter((id) => id !== v.id))} />
                    {v.hook_text} · {v.copy_text} · {v.cta_text} · {v.format}
                  </label>
                ))}
              </div>}
              {selectedVariantIds.length > 0 && <div className="mt-3 flex flex-wrap items-end gap-2">
                <input className={field} placeholder="Campaign name" value={campaignForm.name} onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })} />
                <input className={field} placeholder="Objective (e.g. OUTCOME_TRAFFIC)" value={campaignForm.objective} onChange={(e) => setCampaignForm({ ...campaignForm, objective: e.target.value })} />
                <input type="number" className={field} placeholder="Daily budget" value={campaignForm.budgetDaily} onChange={(e) => setCampaignForm({ ...campaignForm, budgetDaily: e.target.value })} />
                <Button size="sm" variant="primary" disabled={busy || !campaignForm.name} onClick={() => void handleCreateCampaign()}>Create Campaign ({selectedVariantIds.length} ads)</Button>
              </div>}
            </div>}

            {campaigns.length > 0 && <div>
              <h4 className="mb-2 text-xs font-medium text-paper">Campaigns</h4>
              {campaigns.map((c) => <div key={c.id} className="mb-2 rounded border border-line bg-ink p-2">
                <div className="flex flex-wrap items-center gap-2 text-2xs">
                  <span className="text-paper">{c.name}</span>
                  <span className="rounded border border-line px-1.5 py-0.5 text-paper-3">{AD_CAMPAIGN_STATUS_LABEL[c.status]}</span>
                  {c.budget_daily && <span className="text-paper-3">${c.budget_daily}/day</span>}
                  {c.spend_to_date != null && <span className="text-paper-3">spend: ${c.spend_to_date}</span>}
                  <button className="text-teal hover:underline" onClick={() => setSelectedCampaignId(c.id)}>attempts</button>
                </div>
                {c.last_error && <p className="mt-1 text-2xs text-neg">{c.last_error}</p>}
                <div className="mt-1 flex flex-wrap gap-2">
                  {["draft", "pending_approval", "approved"].includes(c.status) && <Button size="sm" variant="primary" disabled={busy} onClick={() => void handleLaunch(c)}>Launch</Button>}
                  {c.status === "active" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleStatusAction(c, "pause")}>Pause</Button>}
                  {c.status === "paused" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleStatusAction(c, "resume")}>Resume</Button>}
                  {(c.status === "active" || c.status === "paused") && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void handleStatusAction(c, "complete")}>Complete</Button>}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void handleBudgetUpdate(c)}>Update budget</Button>
                  {selectedCampaignId === c.id && attempts.length > 0 && <div className="mt-2 w-full space-y-1">
                    {attempts.map((a) => <div key={a.id} className={`text-2xs ${a.result === "failed" ? "text-neg" : a.result === "blocked" ? "text-warn" : "text-paper-3"}`}>
                      #{a.attempt_number} {a.action} → {a.result}{a.message ? `: ${a.message}` : ""}
                    </div>)}
                  </div>}
                </div>
                {["active", "paused", "completed"].includes(c.status) && <AdCampaignPerformanceSection campaign={c} />}
              </div>)}
            </div>}
          </div>}
        </div>}
      </div>
    </div>
  </div>;
}
