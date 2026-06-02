# AA Cockpit

> Operator cockpit for Attract Acquisition. Production date: **01 October 2026**.

Single command surface for running the full distribution loop — outreach → conversion → onboarding → delivery — across Meta Ads, WhatsApp (360dialog), Instagram DMs, and email. Built on the **Attraction Engine™** (Proof × Volume × Consistency = Brand) operating model.

---

## Stack

- **Vite** + **React 18** + **TypeScript**
- **Tailwind CSS** with custom AA design tokens (ink + teal + DM type stack)
- **React Router v6** with URL-routed pages
- **Recharts** for charts (Pulse, Money)
- **Mock API layer** (`src/lib/mock/`) — every function maps 1:1 to a future Supabase query, so the swap is a one-line change per call site

---

## Status

Phase 1 — **Frontend scaffold complete**. All 10 routes render with placeholder data via the mock layer. No auth, no live data, no edge functions.

Phase 2 — **Backend wiring** (next, via Claude Code in terminal):
- Connect to Supabase project `ayfidvycgqorxmlczyxl`
- Wire `mockApi` → real Supabase queries
- Auth shell (login, protected routes, role-based routing)
- Edge functions for OpenClaw/AICOS, Apify scrape, MJR generation, Meta ad ops
- Realtime subscriptions for Inbox + Agent Trail + In-Flight panels

---

## Getting started

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

```bash
npm run typecheck   # validates types
npm run build       # production build → dist/
npm run preview     # preview production build
```

---

## Architecture

### Routes

| Path | Page | Purpose |
|------|------|---------|
| `/` | redirect → `/cockpit` | |
| `/cockpit` | `CockpitPage` | Triage queue + Pulse + In-Flight + Inbox + Agent Trail |
| `/pipeline` | `PipelinePage` | Kanban board across 7 stages |
| `/conversations` | `ConversationsPage` | Unified inbox (IG / WA / email) + thread detail |
| `/conversations/:id` | `ConversationsPage` | Same, with thread selected |
| `/campaigns` | `CampaignsPage` | Meta ad campaigns list + drilldown |
| `/campaigns/:id` | `CampaignsPage` | Same, with campaign selected |
| `/clients` | `ClientsPage` | Clients + prospects table (lens on same entity table) |
| `/entity/:id` | `EntityPage` | Drill-down: identity + timeline + actions |
| `/studio` | `StudioPage` | Asset library (briefs, reels, MJRs, decks) |
| `/operations` | `OperationsPage` | Automations, AICOS controls, integrations |
| `/money` | `MoneyPage` | MRR, P&L, runway, client revenue breakdown |
| `/settings` | `SettingsPage` | Profile, team, brand, integrations config |

### File layout

```
src/
├── main.tsx               // ReactDOM mount
├── App.tsx                // Router root
├── index.css              // Tailwind layers + base resets
│
├── components/
│   ├── shell/             // AppShell, LeftRail, TopBar, PipelineStrip, CommandBar
│   ├── primitives/        // Card, Panel, Tag, Tabs, Icon, Sparkline, EmptyState
│   ├── cockpit/           // TriageCard, InFlightPanel, InboxPanel, PulsePanel, AgentTrailPanel
│   ├── pipeline/          // PipelineBoard, StageColumn, EntityCard
│   ├── conversations/     // ConversationList, ConversationThread, MessageBubble, Composer
│   ├── campaigns/         // CampaignList, CampaignDetail, MetricGrid
│   ├── clients/           // EntityList, EntityHeader, EntityTimeline, EntityActions
│   ├── studio/            // AssetGrid, AssetCard
│   ├── operations/        // AutomationList, AgentControlPanel
│   ├── money/             // RevenueChart, KPIGrid, ClientBreakdown
│   └── settings/          // SettingsNav, sections
│
├── pages/                 // One file per route, thin — composes components
│
├── lib/
│   ├── mock/              // Typed fixtures — swap to Supabase per file
│   │   ├── index.ts       // mockApi facade — single import for all data calls
│   │   ├── clients.ts
│   │   ├── prospects.ts
│   │   ├── conversations.ts
│   │   ├── campaigns.ts
│   │   ├── triage.ts
│   │   ├── operations.ts
│   │   ├── agentEvents.ts
│   │   ├── pulse.ts
│   │   └── assets.ts
│   ├── format.ts          // Currency (ZAR), date, percent, duration helpers
│   └── constants.ts       // Stages, channels, tag types, route paths
│
├── types/                 // Domain types — mirror Supabase schema
│   ├── index.ts           // re-exports
│   ├── client.ts
│   ├── prospect.ts
│   ├── conversation.ts
│   ├── campaign.ts
│   ├── triage.ts
│   ├── agentEvent.ts
│   └── pulse.ts
│
└── hooks/                 // useHotkeys, useDocumentTitle, etc.
```

### Design tokens

All colors and fonts live in `tailwind.config.ts`. Reference via Tailwind utilities:

| Token | Class | Use |
|-------|-------|-----|
| `#07100E` | `bg-ink` | Main background |
| `#0B1715` | `bg-ink-200` | Card / panel base |
| `#0F201C` | `bg-ink-100` | Panel header / nested surface |
| `#142824` | `bg-ink-50` | Hover surface |
| `#F2EFE6` | `text-paper` | Primary text |
| `#9AA6A2` | `text-paper-2` | Muted text |
| `#5E6B68` | `text-paper-3` | Subtle text |
| `#00E5C3` | `text-teal` / `bg-teal` | Accent / active / positive |
| `#F2C14E` | `text-warn` | Warning |
| `#E26D6D` | `text-neg` | Negative |

Typography: `font-sans` (DM Sans), `font-serif` (DM Serif Display, for numbers/headings), `font-mono` (DM Mono, for IDs/timestamps).

---

## Mock API contract (for Phase 2)

Every data read in the app goes through `mockApi` in `src/lib/mock/index.ts`:

```ts
import { mockApi } from "@/lib/mock";

const triage = await mockApi.triage.list();
const client = await mockApi.clients.byId(id);
```

When wiring Supabase, replace each method body with the equivalent query — call sites stay identical. Functions are async-shaped already (return `Promise<T>`).

---

## Phase 2 — Backend wiring checklist

- [ ] Supabase client init (`src/lib/supabase.ts`)
- [ ] Replace each `mockApi.*` function body with Supabase queries
- [ ] Auth shell: login page, `ProtectedRoute` wrapper, role-based redirect (admin / delivery / distribution / client)
- [ ] Realtime subscriptions on `conversations`, `agent_events`, `triage_items`
- [ ] Edge functions:
  - `apify-scrape` (Google Maps lead source)
  - `aicos-act` (OpenClaw agent transport)
  - `mjr-generate` (Missed Jobs Report builder)
  - `meta-ad-ops` (campaign read/write via Meta system user token)
  - `360dialog-send` (WhatsApp BSP outbound)
- [ ] RLS policies — reuse the 3-helper-function pattern from AA-OS
- [ ] Wire ⌘K command palette to real actions
- [ ] Hook up keyboard shortcuts (R, E, S, ?) from `CommandBar`

---

## Conventions

- **Components**: function components, named exports.
- **Files**: one component per file, PascalCase.
- **State**: local `useState` for now; Phase 2 introduces TanStack Query for server state.
- **Styling**: Tailwind utility classes only — no inline styles, no CSS modules. If a pattern repeats 3+ times, extract a primitive in `components/primitives/`.
- **Types**: never `any`. Prefer `unknown` + narrow if forced.
- **Imports**: absolute via `@/` alias, never deep relative (`../../`).
