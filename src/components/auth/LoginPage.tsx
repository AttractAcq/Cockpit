// src/components/auth/LoginPage.tsx
import { useState } from "react";
import { useAuth } from "@/lib/auth";

export function LoginPage() {
  const { signInWithMagicLink } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(null); setBusy(true);
    try { await signInWithMagicLink(email.trim()); setSent(true); }
    catch (e) { setErr(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-ink">
      <div className="w-full max-w-sm rounded-xl bg-ink-200 p-8 shadow-2xl">
        <h1 className="font-serif text-2xl text-paper">Attract Acquisition</h1>
        <p className="mt-1 text-sm text-paper-3">Operator cockpit · sign in</p>
        {sent ? (
          <p className="mt-6 text-sm text-teal">Check your email for a sign-in link.</p>
        ) : (
          <div className="mt-6 space-y-3">
            <input
              type="email" value={email} placeholder="you@attractacq.com"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="w-full rounded-lg bg-ink-100 px-3 py-2 text-paper outline-none ring-1 ring-ink-50 focus:ring-teal"
            />
            <button
              onClick={submit} disabled={busy || !email}
              className="w-full rounded-lg bg-teal py-2 font-medium text-ink disabled:opacity-50"
            >{busy ? "Sending…" : "Send magic link"}</button>
            {err && <p className="text-xs text-neg">{err}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
