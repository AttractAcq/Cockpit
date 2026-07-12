import { NavLink } from "react-router-dom";
import { Icon } from "@/components/primitives";
import { Avatar } from "@/components/primitives";
import { NAV_ITEMS, ROUTES } from "@/lib/constants";
import { useAuth } from "@/lib/auth";

export function LeftRail() {
  const { session } = useAuth();
  const initials = session?.user?.email?.slice(0, 2).toUpperCase() ?? "AA";

  return (
    <aside className="w-14 bg-ink border-r border-line flex flex-col items-center py-3.5 gap-1 flex-shrink-0">
      {/* Brand */}
      <div className="w-8 h-8 border border-line-2 rounded-lg grid place-items-center font-mono text-sm font-bold text-teal mb-4 select-none">
        A
      </div>

      {/* Primary Nav */}
      <nav className="flex flex-col gap-0.5 w-full items-center">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `relative w-10 h-9 grid place-items-center rounded-lg transition-colors group ${
                isActive
                  ? "text-teal bg-ink-100"
                  : "text-paper-3 hover:text-paper hover:bg-ink-200"
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute -left-px top-2 bottom-2 w-0.5 bg-teal rounded-r" />
                )}
                <Icon name={item.icon} size={16} />
                <span className="absolute left-12 bg-ink-100 border border-line-2 px-2 py-1 rounded-md text-xs text-paper whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10 flex items-center gap-2">
                  {item.label}
                  <span className="font-mono text-2xs text-paper-3">{item.shortcut}</span>
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer: settings + avatar */}
      <div className="mt-auto flex flex-col items-center gap-2">
        <NavLink
          to={ROUTES.settings}
          className={({ isActive }) =>
            `w-10 h-9 grid place-items-center rounded-lg transition-colors ${
              isActive ? "text-teal bg-ink-100" : "text-paper-3 hover:text-paper"
            }`
          }
        >
          <Icon name="settings" size={16} />
        </NavLink>
        <Avatar initials={initials} size="md" />
      </div>
    </aside>
  );
}
