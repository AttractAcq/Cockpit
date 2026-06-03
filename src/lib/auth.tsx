// src/lib/auth.tsx
// Auth shell: session, current role (via team_members), email+password sign-in.
// Roles: admin | distribution | delivery | client. The cockpit is staff-only;
// the client role is bounced to the portal.
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "./supabase";
import type { Session } from "@supabase/supabase-js";

type Role = "admin" | "distribution" | "delivery" | "client" | null;

interface AuthState {
  session: Session | null;
  role: Role;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [loading, setLoading] = useState(true);

  async function loadRole(uid: string) {
    const { data } = await supabase
      .from("team_members").select("role").eq("user_id", uid)
      .order("role").limit(1).maybeSingle();
    setRole((data?.role as Role) ?? null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) loadRole(data.session.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) loadRole(s.user.id); else setRole(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthState = {
    session, role, loading,

    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },

    signUp: async (email, password) => {
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) throw signUpError;
      // Email confirmation is disabled in the Supabase dashboard, so sign in immediately.
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
    },

    signOut: async () => { await supabase.auth.signOut(); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
