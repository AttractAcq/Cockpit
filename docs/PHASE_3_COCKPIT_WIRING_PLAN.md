# Phase 3 Cockpit Wiring Plan

Date: 2026-06-13  
Supabase project: `iwkhdqqgfjtpdhcbpftu`  
Source checkpoint: `PREFLIGHT_READINESS.md` says Phase 1 is GREEN and overall preflight is GREEN-with-external-blocks.

## Current Cockpit Inventory

| Route / surface | Primary files | Current wiring state |
|---|---|---|
| Dashboard / cockpit | `src/pages/CockpitPage.tsx`, `src/components/cockpit/*` | Live Supabase reads through `src/lib/api.ts`; first slice removes demo fallback for triage, pulse, in-flight, inbox, and agent trail. |
| Prospect pipeline | `src/pages/PipelinePage.tsx`, `src/components/pipeline/*`, `src/components/shell/PipelineStrip.tsx` | Live `entities` reads through `api.entities.byStage()` and `api.clients.stageCounts()`; first slice removes demo fallback and adds loading/error/empty states. |
| Conversations / inbox | `src/pages/ConversationsPage.tsx`, `src/components/conversations/*` | Partially live through `api.conversations.*`; page still has component-level fallback/static behavior to audit next. |
| Campaigns | `src/pages/CampaignsPage.tsx`, `src/components/campaigns/*` | Live list/detail APIs exist; page still has demo fallback constants. |
| Clients / entities | `src/pages/ClientsPage.tsx`, `src/pages/EntityPage.tsx`, `src/components/clients/*` | Live entity APIs exist; detail screens still need loading/error/empty hardening. |
| Studio / proof uploads / assets / briefs | `src/pages/StudioPage.tsx`, `src/components/studio/*` | Live assets and Edge Function actions exist; component still has demo fallback constants. |
| Operations / automations | `src/pages/OperationsPage.tsx`, `src/components/operations/*` | Live automations and agent-events APIs exist; component still has demo/static agent controls. |
| Money | `src/pages/MoneyPage.tsx`, `src/components/money/*` | Live money APIs exist; charts/components still include demo fallback constants. |
| Settings | `src/pages/SettingsPage.tsx`, `src/components/settings/*` | Live — reads `credential_registry` for integration presence and `team_members` for roles; status pills driven by hardcoded external-status map. No secret values rendered. |
| Shell | `src/components/shell/*` | TopBar and PipelineStrip now use live API directly for first slice; CommandBar/SystemStatus remains static. |

## Mock / Static Areas Found

| Area | Static/mock source | Replacement direction |
|---|---|---|
| Legacy fixtures | `src/lib/mock/*.ts` | Runtime `mockApi` already re-exports live `api`; fixtures should remain unused and eventually be deleted or moved to story/demo-only usage. |
| Dashboard fallback cards | `TriageQueue`, `PulsePanel`, `InFlightPanel`, `InboxPanel`, `AgentTrailPanel` | First slice removed demo fallback and now shows live loading/error/empty states. |
| Pipeline fallback cards | `PipelineBoard` | First slice removed demo fallback and now shows live loading/error/empty states. |
| Campaigns page | `CampaignsPage.tsx` `DEMO` constant | Replace with live loading/error/empty states next. |
| Studio assets | `AssetGrid.tsx` `DEMO_ASSETS` | Replace with live loading/error/empty states next. |
| Operations panels | `AgentControlPanel.tsx` static agents and demo events; `AutomationList.tsx` demo rows | Replace with live `automations`, `agent_events`, and explicit external-block states. |
| Money panels | `RevenueChart.tsx`, `KPIGrid.tsx`, `ClientBreakdown.tsx` demo constants | Replace with live `mrr_snapshots`, `contracts`, and derived metrics. |
| Settings | `SettingsSections.tsx` static integrations/team | Wire to safe status surfaces only; never expose secret values. |
| Shell status | `CommandBar.tsx` static `SYSTEMS` | Later map to preflight/status rows or safe health RPCs. |

## Data Mapping

| Surface | Tables / views | Notes |
|---|---|---|
| Dashboard triage | `triage_items` joined to `entities` | Realtime on `triage_items`; status filtered to `open`. |
| Dashboard pulse | `pulse_metrics`; derived fallback from `entities`, `triage_items`, `campaigns` | `pulse_metrics` currently empty, so `api.pulse.metrics()` derives live operational counts rather than using mocks. |
| Dashboard in-flight | `automations` joined to `entities` | Empty is a valid live state; no demo rows. |
| Dashboard inbox | `conversations` joined to `entities`; later `messages` for denorm last-message preview | Realtime on `conversations`; message-level preview enrichment should be next. |
| Dashboard agent trail | `agent_events` joined to `entities` | Realtime on `agent_events`. |
| Pipeline board / strip | `entities` | Stages come from existing pipeline enum: source, cold, contacted, engaged, booked, onboarding, active, delivering. |
| Campaigns | `campaigns`, `ad_metrics`, `entities` | Meta write actions remain external-gated until approval. |
| Proof/assets | `assets`, `briefs`, `entities`, storage paths | Approval/reject uses `assets.status`; generation uses Edge Functions. |
| Briefs/content | `briefs`, `assets`, `agent_events` | `brief-generator` and `mjr-generate` are live Stage-A functions. |
| Automations | `automations`, `agent_events`, `campaigns`, `conversations` | n8n may be external-gated. |
| Settings | `credential_registry`, safe Vault-name presence checks, function env names | Names/status only; never values. |

## Action / Function Mapping

| UI action | Edge Function / operation | Current backend state |
|---|---|---|
| Score lead | `lead-score` | Live, routing to Anthropic via model `claude-haiku-4-5-20251001`; fails loudly on upstream non-2xx. |
| Scrape leads | `apify-scrape` | Credential verified; UI must warn this launches actor work. |
| Draft reply / score reply | `aicos-act` | Live on `gpt-5.4-mini`. |
| Generate brief | `brief-generator` | Live, returns `stub:false`. |
| Generate MJR | `mjr-generate` | Shares Anthropic path with brief generation. |
| Flag campaigns | `campaign-flag` | Cron/service-role invocation verified. |
| Capture proof | `proof-capture` | Function exists; UI wiring still pending. |
| Start onboarding | `onboarding` | Function exists; n8n handoff remains external/deployment gated if not registered. |
| Recalculate MRR | `mrr-calc` | Function exists; money page wiring pending. |
| Campaign Meta operations | `meta-ad-ops` | BLOCKED-external until Meta BM/ad account approval. |
| WhatsApp send | `dialog360-send` | BLOCKED-external until 360dialog approval and per-client keys. |

## Realtime Plan

| Table | Surface | Status |
|---|---|---|
| `triage_items` | Dashboard triage | Active via `useRealtimeList`. |
| `conversations` | Dashboard inbox and conversations list | Active for conversation rows; message preview enrichment pending. |
| `messages` | Conversation thread | Hook available; targeted thread subscription should be added. |
| `agent_events` | Dashboard agent trail / operations | Active via `useRealtimeList`. |
| `campaigns` | Campaigns / in-flight | Hook type should be extended and wired next. |
| `automations` | In-flight / operations | Hook supports it; dashboard currently uses one-time read and should move to realtime next. |

## Wiring Order

1. Dashboard + Prospect Pipeline live reads. **Implemented in this slice.**
2. Conversations live thread detail, message realtime, and reply-send states.
3. Campaigns read states and safe blocked-external action states.
4. Studio assets and briefs live reads/actions.
5. Operations automations and agent control actions.
6. Money page live MRR/contracts with `mrr-calc` action.
7. Settings status projection for integrations, credentials, team, and role visibility.
8. CommandBar actions and global keyboard shortcuts mapped to live functions.

## Risks

| Risk | Mitigation |
|---|---|
| RLS hides data for non-admin users | Preserve RLS; show permission/empty states rather than service-role frontend shortcuts. |
| Empty live tables are mistaken for broken wiring | Use explicit empty states with live wording; avoid demo fallback. |
| Edge functions can spend money | Keep action buttons explicit, show running state, and avoid automatic scrape/generation on render. |
| External blockers look like app failures | Surface Meta, PayFast, 360dialog, and n8n as BLOCKED-external. |
| ~~Existing README references old project ref `ayfidvycgqorxmlczyxl`~~ | **Resolved** — README updated to canonical ref `iwkhdqqgfjtpdhcbpftu`. |
| Some pages still import `mockApi` | `mockApi` currently aliases live `api`; migrate operator-critical components to `api` directly over time for clarity. |

## First Slice Implemented

Files changed:

```text
src/hooks/useRealtime.ts
src/lib/api.ts
src/components/cockpit/TriageQueue.tsx
src/components/cockpit/PulsePanel.tsx
src/components/cockpit/InFlightPanel.tsx
src/components/cockpit/InboxPanel.tsx
src/components/cockpit/AgentTrailPanel.tsx
src/components/pipeline/PipelineBoard.tsx
src/components/shell/TopBar.tsx
src/components/shell/PipelineStrip.tsx
```

Behavior now:

- Dashboard and pipeline no longer show demo fallback data.
- Live loading, error, and empty states are present for the first slice.
- Pulse derives live counts from operational tables if `pulse_metrics` has no rows.
- Realtime hook exposes load errors for dashboard panels.
- Pipeline stage updates still use `entities.update`.
- Onboarding gate still calls the existing `onboarding` Edge Function.

Validation:

- Inserted temporary `TEST_GATE_Phase3_*` rows into `entities`, `triage_items`, `conversations`, and `agent_events`.
- Confirmed one visible row in each relevant table.
- Cleaned up all `TEST_GATE_Phase3_*` rows.
- Cleanup verification returned zero rows in `entities`, `triage_items`, `conversations`, and `agent_events`.
- `npm run build` completed successfully.

## Exact Next Implementation Steps

1. Remove demo fallbacks from `CampaignsPage`, `CampaignList`, and `CampaignDetail`; add blocked-external action states for Meta.
2. Wire `campaigns` realtime into campaign list/detail and in-flight panels.
3. Replace `ConversationList` and `ConversationThread` fallback behavior with live loading/error/empty states and message realtime.
4. Replace `AssetGrid` fallback with live assets/briefs tabs and explicit `brief-generator` / `mjr-generate` action states.
5. Wire `OperationsPage` to live `automations` and `agent_events`; add safe `apify-scrape` run confirmation.
6. Wire `MoneyPage` to `mrr_snapshots`, `contracts`, and `mrr-calc`.
7. ~~Update README project ref/status so docs match the canonical production project.~~ **Done** — README updated with live project ref, auth method (email + password), hosting (GitHub Pages), model strings, and full 16-function table.
