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

export class EdgeFunctionInvocationError extends Error {
  functionName: string;
  status: number | null;
  responseBody: unknown;

  constructor(functionName: string, message: string, status: number | null, responseBody: unknown) {
    super(message);
    this.name = "EdgeFunctionInvocationError";
    this.functionName = functionName;
    this.status = status;
    this.responseBody = responseBody;
  }
}

function responseMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return typeof body === "string" && body.trim() ? body.trim() : null;
  const value = body as { message?: unknown; error?: unknown; details?: unknown; stage?: unknown };
  const primary = typeof value.message === "string"
    ? value.message
    : typeof value.error === "string"
      ? value.error
      : null;
  const details = typeof value.details === "string" ? value.details : null;
  const stage = typeof value.stage === "string" ? `stage: ${value.stage}` : null;
  return [primary, details, stage].filter(Boolean).join(" · ") || null;
}

// Invoke an edge function with the current user's JWT automatically attached.
export async function invokeFn<T = unknown>(
  name: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const context = (error as { context?: unknown }).context;
    let status: number | null = null;
    let responseBody: unknown = null;
    if (context instanceof Response) {
      status = context.status;
      const response = context.clone();
      const text = await response.text().catch(() => "");
      if (text) {
        try { responseBody = JSON.parse(text); }
        catch { responseBody = text.slice(0, 2000); }
      }
    }
    const detail = responseMessage(responseBody) ?? error.message;
    const statusText = status ? `HTTP ${status}` : "non-2xx response";
    throw new EdgeFunctionInvocationError(
      name,
      `${name} failed (${statusText}): ${detail}`,
      status,
      responseBody,
    );
  }
  return data as T;
}
