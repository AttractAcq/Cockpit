// src/hooks/useRealtime.ts
// Subscribe a list-state to Supabase realtime. Used by the triage queue, inbox,
// and in-flight/agent-trail panels so the cockpit updates live.
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

type Loader<T> = () => Promise<T[]>;

export function useRealtimeList<T>(
  table: "triage_items" | "conversations" | "messages" | "agent_events" | "automations" | "campaigns",
  loader: Loader<T>,
) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setRows(await loaderRef.current());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel(`rt:${table}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, () => {
        refresh();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [table, refresh]);

  return { rows, loading, error, refresh };
}
