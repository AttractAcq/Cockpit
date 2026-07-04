export const ROUTES = {
  cockpit: "/cockpit",
  clients: "/clients",
  client: (id: string) => `/clients/${id}`,
  clientSection: (id: string, section: string) => `/clients/${id}/${section}`,
  operations: "/operations",
  settings: "/settings",
  // Legacy stubs — referenced by old components; preserved for typecheck compatibility
  pipeline: "/pipeline",
  money: "/money",
  entity: (id: string) => `/entities/${id}`,
  campaign: (id: string) => `/campaigns/${id}`,
  conversation: (id: string) => `/conversations/${id}`,
} as const;

export interface NavItem {
  label: string;
  path: string;
  shortcut: string;
  icon: "home" | "users" | "ops";
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Cockpit",    path: ROUTES.cockpit,    shortcut: "⌘1", icon: "home" },
  { label: "Clients",    path: ROUTES.clients,    shortcut: "⌘2", icon: "users" },
  { label: "Operations", path: ROUTES.operations, shortcut: "⌘3", icon: "ops" },
];

export const KEYBOARD_SHORTCUTS = [
  { keys: ["⌘", "K"], label: "Command palette" },
  { keys: ["⌘", "1"], label: "Cockpit" },
  { keys: ["⌘", "2"], label: "Clients" },
  { keys: ["⌘", "3"], label: "Operations" },
  { keys: ["?"],       label: "Show all shortcuts" },
];

export const SUPABASE_PROJECT_REF = "xivewedajschthjlblfb";
