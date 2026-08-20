export const ROUTES = {
  cockpit: "/cockpit",
  clients: "/clients",
  client: (id: string) => `/clients/${id}`,
  clientSection: (id: string, section: string) => `/clients/${id}/${section}`,
  businesses: "/businesses",
  business: (id: string) => `/businesses/${id}`,
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
  icon: "home" | "users" | "ops" | "external" | "board";
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Cockpit",    path: ROUTES.cockpit,    shortcut: "⌘1", icon: "home" },
  { label: "Delivery",   path: ROUTES.clients,    shortcut: "⌘2", icon: "users" },
  { label: "Businesses", path: ROUTES.businesses, shortcut: "⌘3", icon: "board" },
  { label: "Operations", path: ROUTES.operations, shortcut: "⌘4", icon: "ops" },
];

export const KEYBOARD_SHORTCUTS = [
  { keys: ["⌘", "K"], label: "Command palette" },
  { keys: ["⌘", "1"], label: "Cockpit" },
  { keys: ["⌘", "2"], label: "Delivery" },
  { keys: ["⌘", "3"], label: "Businesses" },
  { keys: ["⌘", "4"], label: "Operations" },
  { keys: ["?"],       label: "Show all shortcuts" },
];

export const SUPABASE_PROJECT_REF = "xivewedajschthjlblfb";
