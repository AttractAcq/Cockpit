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
  team: "/team",
  knowledge: "/knowledge",
  finance: "/finance",
  marketing: "/marketing",
  masterAi: "/master-ai",
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
  icon: "home" | "users" | "ops" | "external" | "board" | "trending-up" | "chat" | "alert-circle" | "library" | "money" | "campaign" | "search";
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Cockpit",       path: ROUTES.cockpit,       shortcut: "⌘1", icon: "home" },
  { label: "Delivery",      path: ROUTES.clients,       shortcut: "⌘2", icon: "users" },
  { label: "Businesses",    path: ROUTES.businesses,    shortcut: "⌘3", icon: "board" },
  { label: "Sales",         path: ROUTES.sales,         shortcut: "⌘4", icon: "trending-up" },
  { label: "Conversations", path: ROUTES.comms,         shortcut: "⌘5", icon: "chat" },
  { label: "Opportunities", path: ROUTES.opportunities, shortcut: "⌘6", icon: "alert-circle" },
  { label: "Automations",   path: ROUTES.automations,   shortcut: "⌘8", icon: "library" },
  { label: "Team",          path: ROUTES.team,          shortcut: "⌘9", icon: "users" },
  { label: "Knowledge",     path: ROUTES.knowledge,     shortcut: "⌘0", icon: "library" },
  { label: "Finance",       path: ROUTES.finance,       shortcut: "⌘F", icon: "money" },
  { label: "Marketing",     path: ROUTES.marketing,     shortcut: "⌘M", icon: "campaign" },
  { label: "Master AI",     path: ROUTES.masterAi,      shortcut: "⌘A", icon: "search" },
  { label: "Operations",    path: ROUTES.operations,    shortcut: "⌘7", icon: "ops" },
];

export const KEYBOARD_SHORTCUTS = [
  { keys: ["⌘", "K"], label: "Command palette" },
  { keys: ["⌘", "1"], label: "Cockpit" },
  { keys: ["⌘", "2"], label: "Delivery" },
  { keys: ["⌘", "3"], label: "Businesses" },
  { keys: ["⌘", "4"], label: "Sales" },
  { keys: ["⌘", "5"], label: "Conversations" },
  { keys: ["⌘", "6"], label: "Opportunities" },
  { keys: ["⌘", "7"], label: "Operations" },
  { keys: ["⌘", "8"], label: "Automations" },
  { keys: ["⌘", "9"], label: "Team" },
  { keys: ["⌘", "0"], label: "Knowledge" },
  { keys: ["⌘", "F"], label: "Finance" },
  { keys: ["⌘", "M"], label: "Marketing" },
  { keys: ["⌘", "A"], label: "Master AI" },
  { keys: ["?"],       label: "Show all shortcuts" },
];

export const SUPABASE_PROJECT_REF = "xivewedajschthjlblfb";
