import { useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon, Kbd } from "@/components/primitives";
import { NAV_ITEMS, ROUTES } from "@/lib/constants";
import { useAuth } from "@/lib/auth";

export function TopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, role } = useAuth();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  const navItem = NAV_ITEMS.find((n) => location.pathname.startsWith(n.path));
  const isSettings = location.pathname.startsWith(ROUTES.settings);
  const crumbLabel = navItem?.label ?? (isSettings ? "Settings" : "");
  const crumbIcon = navItem?.icon ?? "settings";

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setQuery("");
      searchRef.current?.blur();
    }
  }

  function handleGlobalShortcut(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      searchRef.current?.focus();
    }
  }

  // attach shortcut once
  if (typeof window !== "undefined") {
    window.onkeydown = handleGlobalShortcut;
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
      <div className="relative flex-1 max-w-[400px] ml-2">
        <div className="flex items-center gap-2 bg-ink-200 border border-line rounded-lg px-2.5 py-1.5 text-paper-3 text-xs focus-within:border-line-2 transition-colors">
          <Icon name="search" size={13} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search clients…"
            className="min-w-0 flex-1 bg-transparent text-xs text-paper outline-none placeholder:text-paper-3"
          />
          <span className="ml-auto">
            <Kbd>⌘K</Kbd>
          </span>
        </div>
      </div>

      {/* Right side */}
      <div className="flex ml-auto items-center gap-3">
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
