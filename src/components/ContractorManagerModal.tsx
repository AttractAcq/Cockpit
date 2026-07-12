import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/primitives";
import { createContractor, deactivateContractor, fetchContractors, updateContractor } from "@/lib/api";
import type { ContractorRow } from "@/types/phase";

interface ContractorDraft {
  name: string;
  email: string;
  role: string;
  specialties: string;
  active: boolean;
  notes: string;
}

const EMPTY: ContractorDraft = { name: "", email: "", role: "", specialties: "", active: true, notes: "" };

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { message?: string; code?: string; details?: string; hint?: string };
    return [value.message, value.code && `Code: ${value.code}`, value.details, value.hint].filter(Boolean).join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

function draftFor(contractor: ContractorRow): ContractorDraft {
  return { name: contractor.name, email: contractor.email, role: contractor.role ?? "", specialties: contractor.specialties.join(", "), active: contractor.active, notes: contractor.notes ?? "" };
}

export function ContractorManagerModal({ onClose }: { onClose: () => void }) {
  const [contractors, setContractors] = useState<ContractorRow[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ContractorRow | null>(null);
  const [draft, setDraft] = useState<ContractorDraft>(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setContractors(await fetchContractors(false)); }
    catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose, saving]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return contractors;
    return contractors.filter((contractor) => `${contractor.name} ${contractor.email} ${contractor.role ?? ""} ${contractor.specialties.join(" ")}`.toLowerCase().includes(needle));
  }, [contractors, query]);

  function beginAdd() { setEditing(null); setDraft(EMPTY); setShowForm(true); setError(null); }
  function beginEdit(contractor: ContractorRow) { setEditing(contractor); setDraft(draftFor(contractor)); setShowForm(true); setError(null); }
  async function save() {
    if (!draft.name.trim() || !draft.email.trim()) return;
    setSaving(true); setError(null);
    try {
      const input = { name: draft.name, email: draft.email, role: draft.role, specialties: draft.specialties.split(","), active: draft.active, notes: draft.notes };
      const saved = editing ? await updateContractor(editing.id, input) : await createContractor(input);
      setContractors((current) => [...current.filter((item) => item.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setShowForm(false); setEditing(null); setDraft(EMPTY);
    } catch (value) { setError(errorText(value)); }
    finally { setSaving(false); }
  }
  async function deactivate(contractor: ContractorRow) {
    if (!window.confirm(`Deactivate ${contractor.name}? They will no longer appear in new human-production assignments.`)) return;
    setSaving(true); setError(null);
    try {
      const saved = await deactivateContractor(contractor.id);
      setContractors((current) => current.map((item) => item.id === saved.id ? saved : item));
      if (editing?.id === saved.id) { setEditing(saved); setDraft(draftFor(saved)); }
    } catch (value) { setError(errorText(value)); }
    finally { setSaving(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 sm:items-center" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-labelledby="contractor-manager-title" className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-[16px] border border-line bg-ink-200 sm:h-[84vh] sm:rounded-[16px]">
      <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4"><div className="min-w-0 flex-1"><h2 id="contractor-manager-title" className="text-sm font-medium text-paper">Manage Contractors</h2><p className="mt-1 text-xs text-paper-3">Editors and production specialists available to the Human production workflow.</p></div><button aria-label="Close contractor manager" disabled={saving} onClick={onClose} className="text-paper-3 hover:text-paper disabled:opacity-40">✕</button></header>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-5 py-3"><input aria-label="Search contractors" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, role, specialty…" className="min-w-60 flex-1 rounded border border-line bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-teal"/><span className="font-mono text-2xs text-paper-3">{visible.length} of {contractors.length}</span><Button size="sm" variant="primary" onClick={beginAdd}>Add Contractor</Button></div>
      {error && <div role="alert" className="shrink-0 border-b border-neg/20 bg-neg/5 px-5 py-2 text-xs text-neg">{error}</div>}
      <main className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[1fr_380px]">
        <div className="min-h-0 overflow-y-auto p-4">{loading ? <div className="p-6 text-xs text-paper-3">Loading contractors…</div> : !visible.length ? <div className="rounded-lg border border-dashed border-line p-8 text-center text-xs text-paper-3">No contractors match this search.</div> : <div className="overflow-hidden rounded-lg border border-line">{visible.map((contractor) => <article key={contractor.id} className="flex flex-wrap items-start gap-3 border-b border-line bg-ink px-4 py-3 last:border-b-0"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-paper">{contractor.name}</span><span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${contractor.active ? "border-teal/20 bg-teal/10 text-teal" : "border-line text-paper-3"}`}>{contractor.active ? "active" : "inactive"}</span></div><div className="mt-1 break-all text-xs text-paper-2">{contractor.email}{contractor.role ? ` · ${contractor.role}` : ""}</div>{contractor.specialties.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{contractor.specialties.map((specialty) => <span key={specialty} className="rounded bg-ink-200 px-1.5 py-0.5 text-2xs text-paper-3">{specialty}</span>)}</div>}{contractor.notes && <p className="mt-2 whitespace-pre-wrap text-2xs leading-5 text-paper-3">{contractor.notes}</p>}<div className="mt-2 font-mono text-2xs text-paper-3">Updated {new Date(contractor.updated_at).toLocaleString()}</div></div><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => beginEdit(contractor)}>Edit</Button>{contractor.active && <Button size="sm" variant="danger" disabled={saving} onClick={() => void deactivate(contractor)}>Deactivate</Button>}</div></article>)}</div>}</div>
        <aside className={`min-h-0 overflow-y-auto border-t border-line bg-ink p-4 lg:border-l lg:border-t-0 ${showForm ? "block" : "hidden lg:block"}`}>{showForm ? <div><div className="flex items-center gap-2"><h3 className="text-xs font-medium text-paper">{editing ? "Edit contractor" : "Add contractor"}</h3><button className="ml-auto text-2xs text-paper-3 hover:text-paper" onClick={() => setShowForm(false)}>Close form</button></div><div className="mt-4 space-y-3"><label className="block text-2xs text-paper-3">Name *<input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className="mt-1 w-full rounded border border-line bg-ink-200 px-2.5 py-2 text-xs text-paper"/></label><label className="block text-2xs text-paper-3">Email *<input type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} className="mt-1 w-full rounded border border-line bg-ink-200 px-2.5 py-2 text-xs text-paper"/></label><label className="block text-2xs text-paper-3">Role<input value={draft.role} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))} className="mt-1 w-full rounded border border-line bg-ink-200 px-2.5 py-2 text-xs text-paper"/></label><label className="block text-2xs text-paper-3">Specialties, comma separated<input value={draft.specialties} onChange={(event) => setDraft((current) => ({ ...current, specialties: event.target.value }))} className="mt-1 w-full rounded border border-line bg-ink-200 px-2.5 py-2 text-xs text-paper"/></label><label className="block text-2xs text-paper-3">Notes<textarea value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} className="mt-1 min-h-28 w-full resize-y rounded border border-line bg-ink-200 px-2.5 py-2 text-xs text-paper"/></label><label className="flex items-center gap-2 text-xs text-paper-2"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))} className="accent-teal"/>Active for new assignments</label><div className="flex justify-end gap-2 pt-2"><Button size="sm" variant="ghost" disabled={saving} onClick={() => setShowForm(false)}>Cancel</Button><Button size="sm" variant="primary" disabled={saving || !draft.name.trim() || !draft.email.trim()} onClick={() => void save()}>{saving ? "Saving…" : editing ? "Save Changes" : "Add Contractor"}</Button></div></div></div> : <div className="flex h-full items-center justify-center text-center text-xs leading-5 text-paper-3">Select Edit or add a contractor.<br/>No emails are sent from this manager.</div>}</aside>
      </main>
    </div>
  </div>;
}
