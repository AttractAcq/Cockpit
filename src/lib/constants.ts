export const ROUTES = {
  cockpit: "/cockpit",
  clients: "/clients",
  client: (id: string) => `/clients/${id}`,
  clientSection: (id: string, section: string) => `/clients/${id}/${section}`,
  businesses: "/businesses",
  business: (id: string) => `/businesses/${id}`,
  sales: "/sales",
  salesLead: (id: string) => `/sales/${id}`,
  comms: "/comms",
  commsIdentity: (id: string) => `/comms/${id}`,
  opportunities: "/opportunities",
  automations: "/automations",
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
  icon: "home" | "users" | "ops" | "external" | "board" | "trending-up" | "chat" | "alert-circle" | "library";
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Cockpit",       path: ROUTES.cockpit,       shortcut: "⌘1", icon: "home" },
  { label: "Delivery",      path: ROUTES.clients,       shortcut: "⌘2", icon: "users" },
  { label: "Businesses",    path: ROUTES.businesses,    shortcut: "⌘3", icon: "board" },
  { label: "Sales",         path: ROUTES.sales,         shortcut: "⌘4", icon: "trending-up" },
  { label: "Comms",         path: ROUTES.comms,         shortcut: "⌘5", icon: "chat" },
  { label: "Opportunities", path: ROUTES.opportunities, shortcut: "⌘6", icon: "alert-circle" },
  { label: "Automations",   path: ROUTES.automations,   shortcut: "⌘8", icon: "library" },
  { label: "Operations",    path: ROUTES.operations,    shortcut: "⌘7", icon: "ops" },
];

export const KEYBOARD_SHORTCUTS = [
  { keys: ["⌘", "K"], label: "Command palette" },
  { keys: ["⌘", "1"], label: "Cockpit" },
  { keys: ["⌘", "2"], label: "Delivery" },
  { keys: ["⌘", "3"], label: "Businesses" },
  { keys: ["⌘", "4"], label: "Sales" },
  { keys: ["⌘", "5"], label: "Comms" },
  { keys: ["⌘", "6"], label: "Opportunities" },
  { keys: ["⌘", "7"], label: "Operations" },
  { keys: ["⌘", "8"], label: "Automations" },
  { keys: ["?"],       label: "Show all shortcuts" },
];

export const SUPABASE_PROJECT_REF = "xivewedajschthjlblfb";
