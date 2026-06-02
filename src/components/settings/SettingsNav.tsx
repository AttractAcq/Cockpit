import type { Dispatch, SetStateAction } from "react";
import { Icon, type IconName } from "@/components/primitives";

export type SettingsSection =
  | "profile"
  | "team"
  | "brand"
  | "integrations"
  | "billing"
  | "advanced";

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: IconName;
  description: string;
}

const ITEMS: NavItem[] = [
  { id: "profile", label: "Profile", icon: "users", description: "Your account" },
  { id: "team", label: "Team", icon: "users", description: "Members + roles" },
  { id: "brand", label: "Brand", icon: "tag", description: "Tokens, fonts, voice" },
  {
    id: "integrations",
    label: "Integrations",
    icon: "ops",
    description: "Meta, 360dialog, Supabase, n8n",
  },
  { id: "billing", label: "Billing", icon: "money", description: "Subscription + invoices" },
  {
    id: "advanced",
    label: "Advanced",
    icon: "settings",
    description: "API, webhooks, danger zone",
  },
];

interface SettingsNavProps {
  active: SettingsSection;
  setActive: Dispatch<SetStateAction<SettingsSection>>;
}

export function SettingsNav({ active, setActive }: SettingsNavProps) {
  return (
    <aside className="w-[260px] border-r border-line bg-ink flex flex-col flex-shrink-0">
      <div className="px-3.5 py-3 border-b border-line">
        <div className="text-[9.5px] uppercase tracking-cap text-paper-3 font-medium">
          Settings
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {ITEMS.map((item) => {
          const isOn = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActive(item.id)}
              className={`w-full px-3.5 py-2.5 flex items-center gap-3 text-left transition-colors ${
                isOn ? "bg-ink-100 border-l-2 border-teal -ml-px" : "hover:bg-ink-50 border-l-2 border-transparent -ml-px"
              }`}
            >
              <Icon
                name={item.icon}
                size={14}
                className={isOn ? "text-teal" : "text-paper-3"}
              />
              <div className="flex-1 min-w-0">
                <div className={`text-sm ${isOn ? "text-paper font-medium" : "text-paper-2"}`}>
                  {item.label}
                </div>
                <div className="text-2xs text-paper-3 mt-0.5">{item.description}</div>
              </div>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
