/**
 * Single source of truth for route paths.
 * Use these constants — never hard-code path strings in components.
 */
export const ROUTES = {
  cockpit: "/cockpit",
  pipeline: "/pipeline",
  conversations: "/conversations",
  conversation: (id: string) => `/conversations/${id}`,
  campaigns: "/campaigns",
  campaign: (id: string) => `/campaigns/${id}`,
  clients: "/clients",
  entity: (id: string) => `/entity/${id}`,
  studio: "/studio",
  operations: "/operations",
  money: "/money",
  settings: "/settings",
} as const;

export interface NavItem {
  label: string;
  path: string;
  shortcut: string;
  icon: "home" | "board" | "chat" | "campaign" | "users" | "library" | "ops" | "money";
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Cockpit", path: ROUTES.cockpit, shortcut: "⌘1", icon: "home" },
  { label: "Pipeline", path: ROUTES.pipeline, shortcut: "⌘2", icon: "board" },
  { label: "Conversations", path: ROUTES.conversations, shortcut: "⌘3", icon: "chat" },
  { label: "Campaigns", path: ROUTES.campaigns, shortcut: "⌘4", icon: "campaign" },
  { label: "Clients", path: ROUTES.clients, shortcut: "⌘5", icon: "users" },
  { label: "Studio", path: ROUTES.studio, shortcut: "⌘6", icon: "library" },
  { label: "Operations", path: ROUTES.operations, shortcut: "⌘7", icon: "ops" },
  { label: "Money", path: ROUTES.money, shortcut: "⌘8", icon: "money" },
];

export const KEYBOARD_SHORTCUTS = [
  { keys: ["⌘", "K"], label: "Command palette" },
  { keys: ["R"], label: "Reply / primary action" },
  { keys: ["E"], label: "Approve / execute" },
  { keys: ["S"], label: "Snooze" },
  { keys: ["?"], label: "Show all shortcuts" },
];
