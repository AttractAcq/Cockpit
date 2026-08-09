# Operator Manual

Day-to-day staff workflow through Cockpit, organized by surface. Assumes an `admin` or `team_members`-scoped staff role.

## Client management

- Every client is a row in `clients`, visible to you only if you're `admin` or have a `team_members` row for that client (assigned via Operations Control → Team & Roles, or automatically for the `account_manager` at onboarding).
- New clients: `OperationsControlPanel.tsx` → Onboarding tab → pick a template (or none) → `onboard_client` RPC creates the client, assigns the account manager, and applies the template's automation/capacity policies in one step.

## Content supply (Manual Idea + Proof)

- `ContentSupplyPanel.tsx` — enter a Manual Idea or a Proof claim. Both go through `ingest-content-source`, landing in `content_sources`/`manual_ideas`/`proof_items`.
- Note: Proof upload today is text/claim-only — there is no file-upload UI for proof media yet (see architecture guide, Proof path).
- `OpportunityPoolPanel.tsx` — turn an ingested source into a real `content_opportunities` row via `create-content-opportunity`.

## Ideation / Research

- Run the seven-technique research pass on a client from the Ideation panel — this produces scored candidates independently of the Manual Idea/Proof flow (see architecture guide, Research path — it converges on the legacy master tables, not the canonical spine, at the Commitment step).
- Reviewing/approving a proposed calendar and committing it writes real `organic_master`/`story_master`/`calendar_cells` rows.

## Calendar planning (Manual Idea / canonical spine)

- `CalendarPlanningPanel.tsx` — build a proposal from open `calendar_slots` and shortlisted/selected opportunities, then approve it. Approval calls `commit_calendar_proposal`, which atomically creates `content_items` and advances the source opportunity's status.

## Production

- `ContentItemsPanel.tsx` / `ProductionStudioPanel.tsx` for the canonical spine (Content Item → Brief → Production Job).
- The legacy master pipeline's own production surfaces (organic/ads master rows → `client_production_briefs` → `client_assets`) remain the primary real production path today — see migration guide for why.
- Reel Studio (`ReelStudioPanel.tsx`) for AI-generated video: create a project (standalone or tied to a source row), add shots manually or use "Generate full storyboard," run still-image then video generation per shot, then "Hand off to production" once every shot is a rendered clip and a matching approved `reel_video` brief exists.

## Approval

- Client-facing content approval happens through whichever surface the client's package tier uses; internally, approval status lives on `client_production_briefs.status` (legacy) — the canonical `content_items.status` approval step is not yet wired to any real action (see architecture guide §3). Don't rely on `content_items.status` to reflect real approval state today.

## Publication

- Both pipelines converge on `client_distribution_records` for anything that actually gets published — `process-scheduled-publishing` handles the real Instagram publish, gated by the client's automation policy (see automation policy guide).

## Ads

- `AdStudioPanel.tsx` — create an Ad Opportunity, write an Ad Brief, generate creative variants, set a budget policy, create and launch a campaign. Launch will fail closed with no live Meta credentials configured (deliberate — see provider runbook). Enter Spend/Lead/Cash-collected figures manually via the campaign's performance section; nothing populates these automatically.

## Performance and iteration

- `PerformanceIterationPanel.tsx` — run deterministic performance analysis (organic or paid) on a client, review generated insight candidates, and "Promote to Opportunity" for a genuine winner. This is the one real closed loop in the system: a promoted candidate creates a fresh `content_opportunities` or `ad_opportunities` row, feeding back into the top of the funnel.

## Automations

- `AutomationPanel.tsx` — set automation levels per named area, per client. Default is `automatic`; tighten to `assisted`/`manual` for a client generating repeated exceptions rather than raising their retry cap (see automation policy guide).

## Operations

- `OperationsPage.tsx` has two tabs: **Activity Log** (the real, live plain-English event feed — filterable by type/client) and **Operational Control** (`OperationsControlPanel.tsx`: Metrics, Team & Roles, Work Items, Cost & Margin, Onboarding).
