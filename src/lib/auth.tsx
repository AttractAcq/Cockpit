// src/lib/auth.tsx
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "./supabase";
import type { Session } from "@supabase/supabase-js";

type Role = "admin" | "distribution" | "delivery" | "client" | null;

interface AuthState {
  session: Session | null;
  role: Role;
  loading: boolean;      // initial session hydration in progress
  roleLoading: boolean;  // session present but role query still in-flight
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(false);

  async function loadRole(uid: string) {
    setRoleLoading(true);
    try {
      const { data, error } = await supabase
        .from("team_members")
        .select("role")
        .eq("user_id", uid)
        .order("role")
        .limit(1)
        .maybeSingle();
      if (error) console.error("[auth] loadRole error:", error.message);
      setRole((data?.role as Role) ?? null);
    } finally {
      setRoleLoading(false);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        loadRole(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) {
        loadRole(s.user.id);
      } else {
        setRole(null);
        setRoleLoading(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthState = {
    session, role, loading, roleLoading,

    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        console.error("[auth] signIn error:", error.message);
        throw error;
      }
    },

    signUp: async (email, password) => {
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        console.error("[auth] signUp error:", signUpError.message);
        throw signUpError;
      }
      // Email confirmation disabled in Supabase dashboard — sign in immediately.
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        console.error("[auth] post-signUp signIn error:", signInError.message);
        throw signInError;
      }
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
