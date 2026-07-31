// Stage A readiness guards.
//
// These protect the conditions the pre-Stage-A remediation established. They
// are deliberately about architecture and readiness, not prose: each one fails
// only if a real regression happens — a retired Edge Function is wired back up,
// a programme document goes missing or loses its stage structure, the lint gate
// stops running, or an archived page is routed again.
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (p: string) => readFile(new URL(p, root), "utf8");
const exists = async (p: string) => {
  try { await access(new URL(p, root)); return true; } catch { return false; }
};

/** Undeployed Edge Functions whose backing tables no longer exist. */
const RETIRED_FUNCTIONS = [
  "apify-scrape",
  "brief-generator",
  "dialog360-send",
  "meta-ad-ops",
  "mjr-generate",
  "mrr-calc",
  "onboarding",
] as const;

/** Archived on 2026-07-31; they had no call sites even before that. */
const ARCHIVED_FUNCTIONS = [
  "aicos-act",
  "audit-log",
  "campaign-flag",
  "client-portal-sync",
  "dialog360-webhook",
  "lead-score",
  "proof-capture",
] as const;

const PROGRAMME_DOCS = [
  "High_level_Cockpit_Audit_30_01_2026.md",
  "Cockpit_Build_Plan.md",
  "Cockpit_Build_Plan_Prompts_Rendered.md",
  "phase_2_ai_build_plan.md",
] as const;

const STAGES = [..."ABCDEFGHIJKLMNOP"] as const;

// ── Retired Edge Functions stay retired ────────────────────────────────────

test("no active source invokes a retired or archived Edge Function", async () => {
  const api = await read("src/lib/api.ts");
  for (const fn of [...RETIRED_FUNCTIONS, ...ARCHIVED_FUNCTIONS]) {
    // `onboarding` is an ordinary English word; only an actual invocation counts.
    assert.doesNotMatch(
      api,
      new RegExp(`invokeFn\\(\\s*["']${fn}["']`),
      `src/lib/api.ts must not invoke the retired function "${fn}"`,
    );
    assert.doesNotMatch(
      api,
      new RegExp(`functions\\.invoke\\(\\s*["']${fn}["']`),
      `src/lib/api.ts must not invoke the retired function "${fn}"`,
    );
  }
});

test("the retired API wrappers are gone from the active API layer", async () => {
  const api = await read("src/lib/api.ts");
  // Each wrapper was the only reason the corresponding function was reachable.
  assert.doesNotMatch(api, /\bmjr:\s*\{/, "the mjr wrapper should be removed");
  assert.doesNotMatch(api, /async runScrape\s*\(/, "runScrape should be removed");
  assert.doesNotMatch(api, /onboarding:\s*\{[\s\S]{0,120}?async start/, "the onboarding wrapper should be removed");
});

test("archived Edge Functions are out of the deploy path and inside the archive", async () => {
  for (const fn of ARCHIVED_FUNCTIONS) {
    assert.equal(
      await exists(`supabase/functions/${fn}/index.ts`),
      false,
      `${fn} must not be under supabase/functions (it would be deployable)`,
    );
    assert.equal(
      await exists(`archive/edge-functions/${fn}/index.ts`),
      true,
      `${fn} must be preserved under archive/edge-functions`,
    );
  }
});

// ── Archived Money page is not routed ──────────────────────────────────────

test("no live route points at the archived Money page", async () => {
  const app = await read("src/App.tsx");
  assert.doesNotMatch(app, /MoneyPage/, "App.tsx must not reference the archived MoneyPage");
  assert.equal(await exists("src/pages/MoneyPage.tsx"), false, "MoneyPage must not be back under src/pages");
  assert.equal(await exists("archive/application-code/MoneyPage.tsx"), true, "MoneyPage must be preserved in the archive");
});

// ── Programme documents ────────────────────────────────────────────────────

test("all four programme documents plus the index are present and non-trivial", async () => {
  for (const doc of PROGRAMME_DOCS) {
    const body = await read(`docs/programme/${doc}`);
    assert.ok(body.length > 5_000, `${doc} looks truncated (${body.length} bytes)`);
    assert.match(body, /^# /m, `${doc} must start with a heading`);
  }
  const index = await read("docs/programme/README.md");
  assert.match(index, /Programme Stage A/, "the index must name the next programme action");
  // The statement is a wrapped blockquote, so normalise markers and whitespace.
  const flat = index.replace(/^>\s?/gm, "").replace(/\s+/g, " ");
  assert.match(
    flat,
    /Repository code and deployed infrastructure are the authority for the current implementation state\. The programme documents are the authority for the intended future state/,
    "the index must carry the authority statement",
  );
});

test("the build plan defines every stage A-P exactly once", async () => {
  const plan = await read("docs/programme/Cockpit_Build_Plan.md");
  const found = [...plan.matchAll(/^#{1,3} .*?Stage ([A-P])\b/gm)].map((m) => m[1]);
  for (const stage of STAGES) {
    assert.equal(
      found.filter((f) => f === stage).length,
      1,
      `Stage ${stage} must appear exactly once as a heading`,
    );
  }
});

test("Stage A carries an objective, scope, acceptance criteria and an exit gate", async () => {
  const plan = await read("docs/programme/Cockpit_Build_Plan.md");
  const section = /^# .*?Stage A\b[\s\S]*?(?=^# .*?Stage B\b)/m.exec(plan)?.[0] ?? "";
  assert.ok(section.length > 500, "Stage A section not found or too short");
  for (const heading of [/## Objective/, /## Scope/, /## Acceptance criteria/i, /## Exit gate/i]) {
    assert.match(section, heading, `Stage A must define ${heading}`);
  }
});

test("the rendered prompts contain 16 complete, fence-balanced stage prompts", async () => {
  const prompts = await read("docs/programme/Cockpit_Build_Plan_Prompts_Rendered.md");

  // Outer prompts are delimited by four backticks so that three-backtick code
  // samples inside a prompt cannot terminate it early.
  const outer = prompts.split("\n").filter((l) => /^````/.test(l));
  assert.equal(outer.length % 2, 0, "outer four-backtick fences must be balanced");
  assert.equal(outer.length / 2, 16, `expected 16 prompt blocks, found ${outer.length / 2}`);

  const inner = prompts.split("\n").filter((l) => /^```(?!`)/.test(l));
  assert.equal(inner.length % 2, 0, "inner three-backtick fences must be balanced");

  const headings = new Set([...prompts.matchAll(/^#{1,3} .*?Stage ([A-P])\b/gm)].map((m) => m[1]));
  for (const stage of STAGES) {
    assert.ok(headings.has(stage), `Stage ${stage} prompt heading is missing`);
  }
});

test("the Phase 2 AI plan covers both global and client-specific control surfaces", async () => {
  const ai = await read("docs/programme/phase_2_ai_build_plan.md");
  for (const required of [
    /Global Cockpit Admin/i,
    /Automation tab/i,
    /Client AI Chat/i,
    /Knowledge Fabric/i,
    /\bRAG\b/,
    /Client Agent/i,
    /Portfolio/i,
    /autonomy/i,
    /isolation/i,
  ]) {
    assert.match(ai, required, `Phase 2 AI plan must cover ${required}`);
  }
});

// ── The lint gate exists and runs in CI ────────────────────────────────────

test("lint is a real, configured, CI-enforced gate", async () => {
  const pkg = JSON.parse(await read("package.json")) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.match(pkg.scripts.lint, /eslint/, "an eslint lint script must exist");
  for (const dep of ["eslint", "typescript-eslint", "eslint-plugin-react-hooks"]) {
    assert.ok(pkg.devDependencies[dep], `${dep} must be a devDependency so lint can execute`);
  }
  assert.equal(await exists("eslint.config.js"), true, "a flat ESLint config must exist");

  const ci = await read(".github/workflows/ci.yml");
  assert.match(ci, /npm run lint/, "CI must run lint");
  assert.match(ci, /npm run typecheck|tsc --noEmit/, "CI must run typecheck");
  assert.match(ci, /npm run build/, "CI must run build");
  assert.match(ci, /node --test/, "CI must run the deterministic test suite");
});

test("the archive keeps a README and a manifest", async () => {
  assert.match(await read("archive/README.md"), /manifest/i);
  const manifest = await read("archive/manifest.md");
  for (const fn of ARCHIVED_FUNCTIONS) {
    assert.ok(manifest.includes(fn), `manifest must record ${fn}`);
  }
  assert.ok(manifest.includes("MoneyPage"), "manifest must record the archived Money page");
});
