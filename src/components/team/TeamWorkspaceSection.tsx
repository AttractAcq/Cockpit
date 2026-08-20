// Cockpit v3 Step 3 — Team workspace. The one genuinely greenfield piece of
// this step: channels and one-level-deep threaded messages, additive
// alongside TeamRolesSection's existing read-only directory (nothing is
// replaced). Business-native: reads selectedBusinessId directly from
// BusinessContext, the same pattern SalesPage already established.
//
// @mention rendering only (src/lib/team-mentions.ts) -- mention *execution*
// is explicitly deferred to Step 5 (Master AI). Agents are mentioned by
// their real registry name (e.g. "@run-market-os"), matching how
// TeamRolesSection already shows agents -- never an invented display name.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/primitives";
import { useBusinessContext } from "@/lib/business-context";
import { fetchTeamChannels, fetchTeamMessages, createTeamChannel, postTeamMessage } from "@/lib/team-workspace";
import { fetchStaffUsers, type StaffUserRow } from "@/lib/operations-admin";
import { fetchWorkflows } from "@/lib/workflows";
import { parseMentions, type MentionCandidate } from "@/lib/team-mentions";
import type { TeamChannelRow, TeamMessageRow } from "@/types/team-workspace";
import { fmtRelative } from "@/lib/format";

const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";
type Notice = { kind: "success" | "error"; text: string } | null;
function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: string }).message);
  return error instanceof Error ? error.message : String(error);
}

function MessageBody({ body, candidates }: { body: string; candidates: MentionCandidate[] }) {
  return (
    <>
      {parseMentions(body, candidates).map((seg, i) => seg.mention ? (
        <span key={i} className={`font-medium ${seg.mention.type === "human" ? "text-teal" : "text-info"}`}>{seg.text}</span>
      ) : (
        <span key={i}>{seg.text}</span>
      ))}
    </>
  );
}

export function TeamWorkspaceSection() {
  const { selectedBusinessId, selectedBusiness } = useBusinessContext();
  const [channels, setChannels] = useState<TeamChannelRow[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TeamMessageRow[]>([]);
  const [staff, setStaff] = useState<StaffUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [newChannelName, setNewChannelName] = useState("");
  const [composerBody, setComposerBody] = useState("");
  const [replyTo, setReplyTo] = useState<TeamMessageRow | null>(null);

  const agentRoles = useMemo(() => fetchWorkflows().filter((w) => w.profile !== "retired"), []);
  const candidates = useMemo<MentionCandidate[]>(() => [
    ...staff.map((s) => ({ type: "human" as const, id: s.id, label: s.full_name ?? s.email ?? s.id })),
    ...agentRoles.map((w) => ({ type: "agent" as const, id: w.name, label: w.name })),
  ], [staff, agentRoles]);

  const loadChannels = useCallback(async () => {
    if (!selectedBusinessId) { setChannels([]); setLoading(false); return; }
    setLoading(true);
    try {
      const [c, s] = await Promise.all([fetchTeamChannels(selectedBusinessId), fetchStaffUsers()]);
      setChannels(c); setStaff(s);
      setSelectedChannelId((current) => current && c.some((ch) => ch.id === current) ? current : c[0]?.id ?? null);
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setLoading(false); }
  }, [selectedBusinessId]);
  useEffect(() => { void loadChannels(); }, [loadChannels]);

  const loadMessages = useCallback(async () => {
    if (!selectedChannelId) { setMessages([]); return; }
    try { setMessages(await fetchTeamMessages(selectedChannelId)); }
    catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
  }, [selectedChannelId]);
  useEffect(() => { void loadMessages(); }, [loadMessages]);

  async function addChannel() {
    if (!selectedBusinessId || !newChannelName.trim()) return;
    setBusy(true); setNotice(null);
    try { await createTeamChannel(selectedBusinessId, newChannelName); setNewChannelName(""); await loadChannels(); }
    catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  async function send() {
    if (!selectedChannelId || !composerBody.trim()) return;
    setBusy(true); setNotice(null);
    try {
      await postTeamMessage(selectedChannelId, composerBody, replyTo?.id ?? null);
      setComposerBody(""); setReplyTo(null);
      await loadMessages();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  const authorLabel = (id: string) => staff.find((s) => s.id === id)?.full_name ?? staff.find((s) => s.id === id)?.email ?? id;
  const topLevel = messages.filter((m) => !m.parent_message_id);
  const repliesTo = (id: string) => messages.filter((m) => m.parent_message_id === id);

  if (!selectedBusinessId) return <p className="text-2xs text-paper-3">Select a business to see its Team workspace.</p>;
  if (loading) return <p className="text-2xs text-paper-3">Loading…</p>;

  return (
    <div className="space-y-3">
      <p className="text-2xs text-paper-3">Channels and threaded messages for {selectedBusiness?.name ?? "this business"} — humans and agents mentioned with @, execution deferred to Master AI (Cockpit v3 Step 5). No per-channel membership yet: every staff role can read and post in every channel.</p>
      {notice && <p className={`text-2xs ${notice.kind === "error" ? "text-neg" : "text-teal"}`}>{notice.text}</p>}

      <div className="flex flex-wrap items-end gap-2 rounded border border-line bg-ink-200 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-2xs text-paper-3">New channel</span>
          <input className={field} placeholder="e.g. general" value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} />
        </label>
        <Button size="sm" variant="primary" disabled={busy || !newChannelName.trim()} onClick={() => void addChannel()}>Create</Button>
      </div>

      <div className="flex min-h-0 gap-3">
        <div className="w-40 shrink-0 space-y-1">
          {channels.length === 0 && <p className="text-2xs text-paper-3">No channels yet.</p>}
          {channels.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedChannelId(c.id)}
              className={`block w-full truncate rounded px-2 py-1 text-left text-2xs ${selectedChannelId === c.id ? "bg-teal/10 text-teal" : "text-paper-2 hover:bg-ink-100"}`}
            >
              # {c.slug}
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          {!selectedChannelId ? <p className="text-2xs text-paper-3">Create a channel to get started.</p> : (
            <>
              <div className="space-y-2 rounded border border-line bg-ink p-2">
                {topLevel.length === 0 && <p className="p-2 text-2xs text-paper-3">No messages yet.</p>}
                {topLevel.map((m) => (
                  <div key={m.id} className="space-y-1">
                    <div className="rounded border border-line bg-ink-200 p-2 text-2xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-paper font-medium">{authorLabel(m.author_id)}</span>
                        <span className="ml-auto font-mono text-paper-3">{fmtRelative(m.created_at)}</span>
                      </div>
                      <p className="mt-1 text-paper-2"><MessageBody body={m.body} candidates={candidates} /></p>
                      <button className="mt-1 text-2xs text-paper-3 hover:text-teal" onClick={() => setReplyTo(m)}>Reply</button>
                    </div>
                    {repliesTo(m.id).map((r) => (
                      <div key={r.id} className="ml-6 rounded border border-line bg-ink-200 p-2 text-2xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-paper font-medium">{authorLabel(r.author_id)}</span>
                          <span className="ml-auto font-mono text-paper-3">{fmtRelative(r.created_at)}</span>
                        </div>
                        <p className="mt-1 text-paper-2"><MessageBody body={r.body} candidates={candidates} /></p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {replyTo && (
                <div className="flex items-center gap-2 text-2xs text-paper-3">
                  Replying to {authorLabel(replyTo.author_id)}
                  <button className="text-neg hover:underline" onClick={() => setReplyTo(null)}>Cancel</button>
                </div>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <input
                  className={`${field} flex-1 min-w-[220px]`}
                  placeholder="Message… use @ to mention a person or agent"
                  value={composerBody}
                  onChange={(e) => setComposerBody(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                />
                <Button size="sm" variant="primary" disabled={busy || !composerBody.trim()} onClick={() => void send()}>Send</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
