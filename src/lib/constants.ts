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
} as const;

export interface NavItem {
  label: string;
  path: string;
  shortcut: string;
  icon: "home" | "users" | "ops" | "board" | "trending-up" | "chat" | "alert-circle" | "library" | "money" | "campaign" | "search";
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

export const SUPABASE_PROJECT_REF = "xivewedajschthjlblfb";
