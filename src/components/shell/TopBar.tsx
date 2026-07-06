import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon, Kbd } from "@/components/primitives";
import { NAV_ITEMS, ROUTES } from "@/lib/constants";
import { useAuth } from "@/lib/auth";
import { fetchClients } from "@/lib/api";
import { getActiveEdgeOperations, supabase } from "@/lib/supabase";
import type { Client } from "@/types/client";
import { TIER_LABELS } from "@/types/client";

export function TopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, role } = useAuth();
  const searchRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [searchLoading, setSearchLoading] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reloadState, setReloadState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [edgeState, setEdgeState] = useState<{ active: number; message: string | null; failed: boolean }>({ active: getActiveEdgeOperations().length, message: null, failed: false });

  const navItem = NAV_ITEMS.find((n) => location.pathname.startsWith(n.path));
  const isSettings = location.pathname.startsWith(ROUTES.settings);
  const crumbLabel = navItem?.label ?? (isSettings ? "Settings" : "");
  const crumbIcon = navItem?.icon ?? "settings";

  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    return clients.filter((client) => [
      client.name, client.slug, client.status, TIER_LABELS[client.package_tier],
      client.geography, client.primary_platform, client.secondary_platform,
    ].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle)).slice(0, 8);
  }, [clients, query]);

  async function loadClients(): Promise<boolean> {
    setSearchLoading(true);
    setSearchError(null);
    try {
      setClients(await fetchClients());
      return true;
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : String(error));
      return false;
    } finally { setSearchLoading(false); }
  }

  useEffect(() => { void loadClients(); }, []);

  function selectClient(client: Client) {
    setQuery("");
    setSearchOpen(false);
    setActiveIndex(0);
    navigate(ROUTES.client(client.id));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setQuery("");
      setSearchOpen(false);
      searchRef.current?.blur();
    } else if (e.key === "ArrowDown" && matches.length) {
      e.preventDefault();
      setActiveIndex((index) => (index + 1) % matches.length);
    } else if (e.key === "ArrowUp" && matches.length) {
      e.preventDefault();
      setActiveIndex((index) => (index - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" && matches[activeIndex]) {
      e.preventDefault();
      selectClient(matches[activeIndex]);
    }
  }

  function handleGlobalShortcut(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      searchRef.current?.focus();
    }
  }

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalShortcut);
    return () => window.removeEventListener("keydown", handleGlobalShortcut);
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    function update(event: Event) {
      const detail = (event as CustomEvent<{ active?: unknown[]; event?: string; operation?: { functionName?: string }; message?: string }>).detail;
      const active = detail?.active?.length ?? getActiveEdgeOperations().length;
      if (timer) window.clearTimeout(timer);
      if (active > 0) {
        setEdgeState({ active, message: detail?.operation?.functionName ?? null, failed: false });
      } else {
        const failed = detail?.event === "failed";
        setEdgeState({ active: 0, message: failed ? detail?.message ?? "Operation failed" : "Operation complete · Reload to refresh", failed });
        timer = window.setTimeout(() => setEdgeState({ active: 0, message: null, failed: false }), failed ? 6000 : 3500);
      }
    }
    window.addEventListener("aa:edge-operations", update);
    return () => { window.removeEventListener("aa:edge-operations", update); if (timer) window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    function closeSearch(event: MouseEvent) {
      if (!searchBoxRef.current?.contains(event.target as Node)) setSearchOpen(false);
    }
    window.addEventListener("mousedown", closeSearch);
    return () => window.removeEventListener("mousedown", closeSearch);
  }, []);

  async function reloadApp() {
    if (reloadState === "loading") return;
    setReloadState("loading");
    try {
      const { error } = await supabase.auth.refreshSession();
      if (error) throw error;
      if (!await loadClients()) throw new Error("Could not refresh the client index.");
      window.dispatchEvent(new CustomEvent("aa:reload"));
      setReloadState("success");
      window.setTimeout(() => setReloadState("idle"), 1600);
    } catch (error) {
      console.error("[reload]", error);
      setReloadState("error");
      window.setTimeout(() => setReloadState("idle"), 3000);
    }
  }

  const roleLabel =
    role === "account_manager" ? "AM"
    : role ? role.charAt(0).toUpperCase() + role.slice(1)
    : "—";

  return (
    <header className="h-12 border-b border-line flex items-center px-4 gap-4 flex-shrink-0">
      {/* Crumb */}
      <div className="flex items-center gap-2 text-xs text-paper-2">
        <span className="text-paper-3">
          <Icon name={crumbIcon} size={13} />
        </span>
        <b className="text-paper font-medium">{crumbLabel}</b>
      </div>

      {/* Search */}
      <div ref={searchBoxRef} className="relative flex-1 max-w-[400px] ml-2">
        <div className="flex items-center gap-2 bg-ink-200 border border-line rounded-lg px-2.5 py-1.5 text-paper-3 text-xs focus-within:border-line-2 transition-colors">
          <Icon name="search" size={13} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search clients…"
            className="min-w-0 flex-1 bg-transparent text-xs text-paper outline-none placeholder:text-paper-3"
          />
          <span className="ml-auto">
            <Kbd>⌘K</Kbd>
          </span>
        </div>
        {searchOpen && query.trim() && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-line bg-ink-200 shadow-2xl">
            {searchLoading ? <div className="px-3 py-3 text-xs text-paper-3">Searching clients…</div>
            : searchError ? <div role="alert" className="px-3 py-3 text-xs text-neg">Client search failed: {searchError}</div>
            : matches.length === 0 ? <div className="px-3 py-3 text-xs text-paper-3">No clients found.</div>
            : matches.map((client, index) => (
              <button
                key={client.id}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectClient(client)}
                className={`flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left last:border-b-0 ${index === activeIndex ? "bg-ink-100" : "hover:bg-ink-100"}`}
              >
                <span className="min-w-0 flex-1"><span className="block truncate text-xs text-paper">{client.name}</span><span className="block text-2xs text-paper-3">{TIER_LABELS[client.package_tier]}{client.geography ? ` · ${client.geography}` : ""}</span></span>
                <span className="text-2xs capitalize text-paper-3">{client.status}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex ml-auto items-center gap-3">
        {(edgeState.active > 0 || edgeState.message) && <span className={`max-w-52 truncate font-mono text-2xs ${edgeState.failed ? "text-neg" : edgeState.active > 0 ? "text-warn" : "text-teal"}`} title={edgeState.message ?? undefined}>{edgeState.active > 0 ? `${edgeState.active} server operation${edgeState.active === 1 ? "" : "s"} running${edgeState.message ? ` · ${edgeState.message}` : ""}` : edgeState.message}</span>}
        <button
          onClick={() => void reloadApp()}
          disabled={reloadState === "loading"}
          className={`rounded-md border border-line px-2.5 py-1 text-2xs font-mono transition-colors disabled:cursor-wait ${reloadState === "error" ? "text-neg" : reloadState === "success" ? "text-teal" : "text-paper-2 hover:bg-ink-200 hover:text-paper"}`}
        >
          {reloadState === "loading" ? "Reloading…" : reloadState === "success" ? "Reloaded" : reloadState === "error" ? "Reload failed" : "Reload"}
        </button>
        <span className="text-2xs text-paper-3 font-mono uppercase tracking-cap">{roleLabel}</span>

        <button
          onClick={() => navigate(ROUTES.settings)}
          className="w-[30px] h-[30px] grid place-items-center text-paper-2 rounded-md hover:bg-ink-200 hover:text-paper transition-colors"
        >
          <Icon name="settings" size={13} />
        </button>

        <button
          onClick={signOut}
          className="text-2xs text-paper-3 hover:text-paper transition-colors font-mono"
        >
          sign out
        </button>
      </div>
    </header>
  );
}
