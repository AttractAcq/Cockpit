// src/lib/supabase.ts
// The single Supabase client for the cockpit. Uses the publishable/anon key
// (safe to ship — RLS enforces who-sees-what). NEVER put the service_role key
// in a frontend env.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// Invoke an edge function with the current user's JWT automatically attached.
export async function invokeFn<T = unknown>(
  name: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  return data as T;
}
