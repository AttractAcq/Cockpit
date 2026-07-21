import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/primitives";
import { fetchClientDistributionAccounts, saveClientDistributionAccount, setClientDistributionAccountActive, setDefaultClientDistributionAccount } from "@/lib/api";
import type { ClientDistributionAccount } from "@/types/phase";

type Draft = { id?: string; label: string; platform: string; handle: string; externalAccountId: string; accountType: string; notes: string; isDefault: boolean; isActive: boolean };
const emptyDraft = (): Draft => ({ label: "", platform: "instagram", handle: "", externalAccountId: "", accountType: "", notes: "", isDefault: false, isActive: true });
const field = "rounded border border-line bg-ink px-2.5 py-2 text-xs text-paper outline-none focus:border-teal/50";
const message = (value: unknown) => value instanceof Error ? value.message : String(value);

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
