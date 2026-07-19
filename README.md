# AA Cockpit

> Operator cockpit for Attract Acquisition. Production date: **01 October 2026**.

Single command surface for running the full distribution loop — outreach → conversion → onboarding → delivery — across Meta Ads, WhatsApp (360dialog), Instagram DMs, and email. Built on the **Attraction Engine™** (Proof × Volume × Consistency = Brand) operating model.

---

## Stack

- **Vite** + **React 18** + **TypeScript**
- **Tailwind CSS** with custom AA design tokens (ink + teal + DM type stack)
- **React Router v6** with URL-routed pages
- **Recharts** for charts (Pulse, Money)
- **Live API layer** (`src/lib/api.ts`) — all reads go to Supabase project `xivewedajschthjlblfb`; `src/lib/mock/` is kept as a re-export alias and for test/story use only

---

## Status

**Live — production wiring complete.** All routes read from Supabase project `xivewedajschthjlblfb`. 16 edge functions deployed and active.

- **Auth**: email + password (`@supabase/supabase-js` email/password flow)
- **Hosting**: GitHub Pages — `aa-cockpit`, `aa-site`, `aa-portal`, and `aa-upload` all deploy via the `deploy.yml` workflow; the public site uses a custom domain on GitHub Pages
- **AI models**: ICP/triage `claude-haiku-4-5-20251001` · content `claude-sonnet-4-6` · OpenClaw/AICOS `gpt-5.4-mini`
- **External blocks**: Meta BM verification, 360dialog BSP approval, and PayFast merchant approval remain pending; those paths degrade gracefully

See `docs/PREFLIGHT_READINESS.md` for the full production gate result.

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
│   ├── api.ts             // Live Supabase data layer — all production reads/writes
│   ├── supabase.ts        // Supabase client (anon key, realtime, invokeFn)
│   ├── mock/              // Re-exports live api; kept for test/story use only
│   │   └── index.ts       // mockApi alias → api
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

## Data layer

All reads go through `api` in `src/lib/api.ts`, backed by Supabase project `xivewedajschthjlblfb`. The `mockApi` alias in `src/lib/mock/index.ts` re-exports the live `api` and is kept for test/story use only.

```ts
import { api } from "@/lib/api";

const triage = await api.triage.list();
const client = await api.clients.byId(id);
```

---

## Deployed edge functions (16)

| Function | Purpose | Model / service |
|---|---|---|
| `lead-score` | ICP scoring on entity insert | `claude-haiku-4-5-20251001` (Anthropic) |
| `brief-generator` | Copy brief generation | `claude-sonnet-4-6` (Anthropic) |
| `mjr-generate` | Missed Jobs Report builder | `claude-sonnet-4-6` (Anthropic) |
| `aicos-act` | OpenClaw reply scoring + auto-send | `gpt-5.4-mini` (OpenAI) |
| `apify-scrape` | Google Maps lead source | Apify actor |
| `meta-ad-ops` | Campaign read/write | Meta system user token |
| `meta-webhook` | Meta inbound webhook (`verify_jwt=false`) | — |
| `dialog360-send` | WhatsApp BSP outbound | 360dialog |
| `dialog360-webhook` | 360dialog inbound webhook | — |
| `campaign-flag` | Hourly campaign performance flagging | Meta |
| `audit-log` | Audit trail helper | — |
| `proof-capture` | Client proof upload handler | — |
| `client-portal-sync` | Portal state sync | — |
| `onboarding` | Client onboarding entry point + n8n handoff | — |
| `mrr-calc` | Monthly MRR snapshot calculation | — |
| `public-lead-capture` | Public-facing lead intake form | — |

Auth: email + password. RLS: 3-helper-function pattern (`auth_role`, `auth_entity_ids`, `auth_admin`). Realtime active on `triage_items`, `conversations`, `agent_events`.

---

## Conventions

- **Components**: function components, named exports.
- **Files**: one component per file, PascalCase.
- **State**: local `useState` for now; Phase 2 introduces TanStack Query for server state.
- **Styling**: Tailwind utility classes only — no inline styles, no CSS modules. If a pattern repeats 3+ times, extract a primitive in `components/primitives/`.
- **Types**: never `any`. Prefer `unknown` + narrow if forced.
- **Imports**: absolute via `@/` alias, never deep relative (`../../`).
