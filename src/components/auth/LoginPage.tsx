// src/components/auth/LoginPage.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";

export function LoginPage() {
  const { signIn, signUp, session } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Redirect away if already authenticated.
  useEffect(() => {
    if (session) navigate(ROUTES.cockpit, { replace: true });
  }, [session, navigate]);

  const MIN_PW = 8;
  const pwTooShort = password.length > 0 && password.length < MIN_PW;
  const canSubmit = !busy && email.trim().length > 0 && password.length >= MIN_PW;

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password);
      }
      // On success the useEffect above fires when session is set and navigates.
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      console.error("[LoginPage] auth error:", msg);
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  function toggleMode() {
    setMode((m) => (m === "signin" ? "signup" : "signin"));
    setErr(null);
  }

  return (
    <div className="flex h-screen items-center justify-center bg-ink">
      <div className="w-full max-w-sm rounded-xl bg-ink-200 p-8 shadow-2xl">
        <h1 className="font-serif text-2xl text-paper">Attract Acquisition</h1>
        <p className="mt-1 text-sm text-paper-3">
          Operator cockpit · {mode === "signin" ? "sign in" : "create account"}
        </p>

        <div className="mt-6 space-y-3">
          <input
            type="email"
            value={email}
            placeholder="you@attractacq.com"
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
            className="w-full rounded-lg bg-ink-100 px-3 py-2 text-paper outline-none ring-1 ring-ink-50 focus:ring-teal"
          />

          <div>
            <input
              type="password"
              value={password}
              placeholder="Password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
              className={`w-full rounded-lg bg-ink-100 px-3 py-2 text-paper outline-none ring-1 transition-colors ${
                pwTooShort ? "ring-warn" : "ring-ink-50 focus:ring-teal"
              }`}
            />
            {pwTooShort && (
              <p className="mt-1 text-xs text-warn">
                Password must be at least {MIN_PW} characters
              </p>
            )}
          </div>

          <button
            onClick={submit}
            disabled={!canSubmit}
            className="w-full rounded-lg bg-teal py-2 font-medium text-ink disabled:opacity-50 transition-opacity"
          >
            {busy
              ? mode === "signin" ? "Signing in…" : "Creating account…"
              : mode === "signin" ? "Sign in" : "Create account"}
          </button>

          {err && <p className="text-xs text-neg leading-snug">{err}</p>}
        </div>

        <div className="mt-5 border-t border-line pt-4 text-center">
          <button
            onClick={toggleMode}
            className="text-xs text-paper-3 hover:text-paper transition-colors"
          >
            {mode === "signin"
              ? "No account yet? Create one"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
