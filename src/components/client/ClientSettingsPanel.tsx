import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/primitives";
import { fetchClientDistributionAccounts, saveClientDistributionAccount, setClientDistributionAccountActive, setDefaultClientDistributionAccount } from "@/lib/api";
import { fetchClientDistributionPolicy, setClientDistributionPolicy } from "@/lib/distribution-policy";
import type { ClientDistributionAccount } from "@/types/phase";
import { WEEKDAY_LABEL, type ApprovalMode, type BlackoutPeriod, type ClientDistributionPolicyRow } from "@/types/distribution-policy";

type Draft = { id?: string; label: string; platform: string; handle: string; externalAccountId: string; accountType: string; notes: string; isDefault: boolean; isActive: boolean };
const emptyDraft = (): Draft => ({ label: "", platform: "instagram", handle: "", externalAccountId: "", accountType: "", notes: "", isDefault: false, isActive: true });
const field = "rounded border border-line bg-ink px-2.5 py-2 text-xs text-paper outline-none focus:border-teal/50";
const message = (value: unknown) => value instanceof Error ? value.message : String(value);

type PolicyDraft = {
  approvalMode: ApprovalMode;
  autoScheduleAfterApproval: boolean;
  manualPublishOnly: boolean;
  blackoutPeriods: BlackoutPeriod[];
  restrictedWeekdays: number[];
};
const defaultPolicyDraft = (): PolicyDraft => ({ approvalMode: "internal_only", autoScheduleAfterApproval: false, manualPublishOnly: false, blackoutPeriods: [], restrictedWeekdays: [] });
const fromPolicyRow = (row: ClientDistributionPolicyRow): PolicyDraft => ({
  approvalMode: row.approval_mode, autoScheduleAfterApproval: row.auto_schedule_after_approval,
  manualPublishOnly: row.manual_publish_only, blackoutPeriods: row.blackout_periods, restrictedWeekdays: row.restricted_weekdays,
});

function DistributionPolicySection({ clientId }: { clientId: string }) {
  const [policy, setPolicy] = useState<PolicyDraft>(defaultPolicyDraft());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const row = await fetchClientDistributionPolicy(clientId); setPolicy(row ? fromPolicyRow(row) : defaultPolicyDraft()); }
    catch (e) { setError(message(e)); } finally { setLoading(false); }
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  function toggleWeekday(day: number) {
    setSaved(false);
    setPolicy((current) => ({
      ...current,
      restrictedWeekdays: current.restrictedWeekdays.includes(day)
        ? current.restrictedWeekdays.filter((d) => d !== day)
        : [...current.restrictedWeekdays, day].sort((a, b) => a - b),
    }));
  }
  function addBlackoutPeriod() {
    setSaved(false);
    setPolicy((current) => ({ ...current, blackoutPeriods: [...current.blackoutPeriods, { start_date: "", end_date: "", reason: "" }] }));
  }
  function updateBlackoutPeriod(index: number, patch: Partial<BlackoutPeriod>) {
    setSaved(false);
    setPolicy((current) => ({ ...current, blackoutPeriods: current.blackoutPeriods.map((p, i) => i === index ? { ...p, ...patch } : p) }));
  }
  function removeBlackoutPeriod(index: number) {
    setSaved(false);
    setPolicy((current) => ({ ...current, blackoutPeriods: current.blackoutPeriods.filter((_, i) => i !== index) }));
  }

  async function save() {
    const invalidPeriod = policy.blackoutPeriods.find((p) => !p.start_date || !p.end_date || !p.reason.trim() || p.start_date > p.end_date);
    if (invalidPeriod) { setError("Every blackout period needs a start date, end date (on or after the start), and reason."); return; }
    setBusy(true); setError(null); setSaved(false);
    try {
      await setClientDistributionPolicy({ clientId, ...policy });
      setSaved(true);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }

  return <section className="rounded-[10px] border border-line bg-ink-200 p-4">
    <h2 className="text-sm font-medium text-paper">Distribution Approval Policy</h2>
    <p className="mt-1 text-xs leading-5 text-paper-3">Controls whether organic posts require explicit client approval, whether approved work can auto-schedule, and any dates publishing must avoid.</p>
    {error && <div role="alert" className="mt-3 rounded border border-neg/20 bg-neg/5 p-2 text-xs text-neg">{error}</div>}
    {loading ? <div className="py-8 text-center text-xs text-paper-3">Loading policy…</div> : <div className="mt-4 space-y-4">
      <label className="flex flex-col gap-1 sm:max-w-xs"><span className="text-2xs uppercase text-paper-3">Approval mode</span>
        <select className={field} value={policy.approvalMode} onChange={(e) => { setSaved(false); setPolicy({ ...policy, approvalMode: e.target.value as ApprovalMode }); }}>
          <option value="internal_only">Internal approval only</option>
          <option value="client_approval_required">Client approval required</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-4 text-xs text-paper-2">
        <label className="flex items-center gap-2"><input type="checkbox" className="accent-teal" checked={policy.autoScheduleAfterApproval} onChange={(e) => { setSaved(false); setPolicy({ ...policy, autoScheduleAfterApproval: e.target.checked }); }} />Auto-schedule after approval</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="accent-teal" checked={policy.manualPublishOnly} onChange={(e) => { setSaved(false); setPolicy({ ...policy, manualPublishOnly: e.target.checked }); }} />Manual publish only (no pre-scheduling)</label>
      </div>
      <div>
        <span className="text-2xs uppercase text-paper-3">Restricted weekdays</span>
        <div className="mt-1.5 flex flex-wrap gap-2">{Object.entries(WEEKDAY_LABEL).map(([day, label]) => {
          const d = Number(day);
          const active = policy.restrictedWeekdays.includes(d);
          return <button key={d} type="button" onClick={() => toggleWeekday(d)} className={`rounded border px-2 py-1 text-2xs ${active ? "border-neg/40 bg-neg/10 text-neg" : "border-line text-paper-3 hover:text-paper"}`}>{label}</button>;
        })}</div>
      </div>
      <div>
        <div className="flex items-center gap-2"><span className="text-2xs uppercase text-paper-3">Blackout periods</span><Button size="sm" variant="ghost" onClick={addBlackoutPeriod}>Add period</Button></div>
        {policy.blackoutPeriods.length === 0 && <p className="mt-1 text-2xs text-paper-3">No blackout periods.</p>}
        {policy.blackoutPeriods.map((period, index) => <div key={index} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
          <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Start</span><input type="date" className={field} value={period.start_date} onChange={(e) => updateBlackoutPeriod(index, { start_date: e.target.value })} /></label>
          <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">End</span><input type="date" className={field} value={period.end_date} onChange={(e) => updateBlackoutPeriod(index, { end_date: e.target.value })} /></label>
          <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Reason</span><input className={field} value={period.reason} onChange={(e) => updateBlackoutPeriod(index, { reason: e.target.value })} /></label>
          <Button size="sm" variant="ghost" onClick={() => removeBlackoutPeriod(index)}>Remove</Button>
        </div>)}
      </div>
      <div className="flex items-center gap-3"><Button size="sm" variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save policy"}</Button>{saved && <span className="text-2xs text-teal">Saved.</span>}</div>
    </div>}
  </section>;
}

export function ClientSettingsPanel({ clientId }: { clientId: string }) {
  const [accounts, setAccounts] = useState<ClientDistributionAccount[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setLoading(true); setError(null); try { setAccounts(await fetchClientDistributionAccounts(clientId)); } catch (e) { setError(message(e)); } finally { setLoading(false); } }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  function edit(account: ClientDistributionAccount) {
    setDraft({ id: account.id, label: account.label, platform: account.platform, handle: account.handle, externalAccountId: account.external_account_id, accountType: account.account_type ?? "", notes: account.notes ?? "", isDefault: account.is_default, isActive: account.is_active });
  }
  async function save() {
    if (!draft) return;
    if (![draft.label, draft.platform, draft.handle.replace(/^@+/, ""), draft.externalAccountId].every((value) => value.trim())) { setError("Label, platform, handle, and Meta IG business account ID are required."); return; }
    setBusy(true); setError(null);
    try { await saveClientDistributionAccount({ ...draft, clientId }); setDraft(null); await load(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function setDefault(account: ClientDistributionAccount) { setBusy(true); setError(null); try { await setDefaultClientDistributionAccount(account); await load(); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  async function toggle(account: ClientDistributionAccount) { setBusy(true); setError(null); try { await setClientDistributionAccountActive(account.id, !account.is_active); await load(); } catch (e) { setError(message(e)); } finally { setBusy(false); } }

  return <div className="min-h-0 flex-1 overflow-y-auto p-4">
    <div className="mx-auto max-w-5xl space-y-4">
      <header><h1 className="text-lg font-medium text-paper">Client Settings</h1><p className="mt-1 text-xs text-paper-3">Client-level configuration for this workspace.</p></header>
      <section className="rounded-[10px] border border-line bg-ink-200 p-4">
        <div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><h2 className="text-sm font-medium text-paper">Distribution Accounts</h2><p className="mt-1 text-xs leading-5 text-paper-3">Save client-level publishing destinations used by Distribution publish and schedule records. Credentials and API tokens are not stored here yet.</p></div><Button size="sm" variant="primary" onClick={() => { setError(null); setDraft(emptyDraft()); }}>Add account</Button></div>
        {error && <div role="alert" className="mt-3 rounded border border-neg/20 bg-neg/5 p-2 text-xs text-neg">{error}</div>}
        {loading ? <div className="py-8 text-center text-xs text-paper-3">Loading distribution accounts…</div> : !accounts.length ? <div className="mt-4 rounded border border-dashed border-line p-8 text-center text-xs text-paper-3">No distribution accounts saved yet. Add an Instagram account to enable account selection in Distribution.</div> : <div className="mt-4 space-y-2">{accounts.map((account) => <article key={account.id} className="rounded-lg border border-line bg-ink p-3">
          <div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm text-paper">{account.label}</span>{account.is_default && <span className="rounded border border-teal/30 bg-teal/5 px-1.5 py-0.5 text-2xs text-teal">default</span>}<span className={`rounded border px-1.5 py-0.5 text-2xs ${account.is_active ? "border-teal/30 text-teal" : "border-line text-paper-3"}`}>{account.is_active ? "active" : "inactive"}</span></div><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-paper-3"><span>{account.platform}</span><span>@{account.handle}</span><span className="font-mono">{account.external_account_id}</span>{account.account_type && <span>{account.account_type}</span>}</div>{account.notes && <p className="mt-2 text-xs text-paper-2">{account.notes}</p>}</div><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => edit(account)}>Edit</Button>{account.is_active && !account.is_default && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void setDefault(account)}>Set default</Button>}<Button size="sm" variant="ghost" disabled={busy} onClick={() => void toggle(account)}>{account.is_active ? "Deactivate" : "Reactivate"}</Button></div></div>
        </article>)}</div>}
      </section>
      <DistributionPolicySection clientId={clientId} />
    </div>
    {draft && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4" onClick={() => !busy && setDraft(null)}><div role="dialog" aria-modal="true" className="w-full max-w-xl rounded-xl border border-line bg-ink-200 p-5" onClick={(event) => event.stopPropagation()}><h2 className="text-base font-medium text-paper">{draft.id ? "Edit distribution account" : "Add distribution account"}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 sm:col-span-2"><span className="text-2xs uppercase text-paper-3">Label</span><input className={field} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Platform</span><select className={field} value={draft.platform} onChange={(e) => setDraft({ ...draft, platform: e.target.value })}><option value="instagram">instagram</option></select></label>
      <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Handle</span><input className={field} placeholder="attractacq" value={draft.handle} onChange={(e) => setDraft({ ...draft, handle: e.target.value.replace(/^@+/, "").replace(/\s+/g, "").toLowerCase() })} /></label>
      <label className="flex flex-col gap-1 sm:col-span-2"><span className="text-2xs uppercase text-paper-3">Meta IG business account ID</span><input className={field} value={draft.externalAccountId} onChange={(e) => setDraft({ ...draft, externalAccountId: e.target.value })} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Account type (optional)</span><input className={field} value={draft.accountType} onChange={(e) => setDraft({ ...draft, accountType: e.target.value })} /></label>
      <label className="flex items-center gap-2 self-end pb-2 text-xs text-paper-2"><input type="checkbox" className="accent-teal" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />Default account</label>
      <label className="flex flex-col gap-1 sm:col-span-2"><span className="text-2xs uppercase text-paper-3">Notes (optional)</span><textarea className={`${field} min-h-20`} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
    </div><div className="mt-5 flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button><Button size="sm" variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save account"}</Button></div></div></div>}
  </div>;
}
