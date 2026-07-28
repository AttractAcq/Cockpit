import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  regeneratedPlanningPatch,
  selectUnambiguousLegacyReelBrief,
  validateBoundReelBrief,
  validatePendingReelShot,
  validateReelStoryboardOutput,
  validateRegeneratedReelShotOutput,
} from "../supabase/functions/_shared/reel-studio-contract.ts";

const root = new URL("../", import.meta.url);
const source = {
  clientId: "client-a",
  sourceTable: "organic_master",
  sourceRowId: "organic-a",
};
const approvedBrief = {
  id: "brief-a",
  client_id: "client-a",
  source_table: "organic_master",
  source_row_id: "organic-a",
  asset_format: "reel_video",
  status: "approved",
};

function shot(shotNumber: number) {
  return {
    shot_number: shotNumber,
    beat_description: `Beat ${shotNumber}`,
    compiled_prompt: `Complete visual prompt ${shotNumber}`,
    shot_class: "metaphor",
    human_presence: "none",
    render_tier: "draft",
    motion_type: null,
    motion_strength: null,
  };
}

function storyboard() {
  return { shots: [shot(1), shot(2), shot(3), shot(4)] };
}

async function file(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

test("valid exact production brief binding passes", () => {
  assert.equal(validateBoundReelBrief(source, approvedBrief).ok, true);
});

test("wrong-client production brief is rejected", () => {
  const result = validateBoundReelBrief(source, { ...approvedBrief, client_id: "client-b" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /client_id/);
});

test("wrong source table and row are rejected", () => {
  const tableResult = validateBoundReelBrief(source, { ...approvedBrief, source_table: "ads_master" });
  const rowResult = validateBoundReelBrief(source, { ...approvedBrief, source_row_id: "organic-b" });
  assert.equal(tableResult.ok, false);
  assert.equal(rowResult.ok, false);
});

test("non-approved and non-reel production briefs are rejected", () => {
  assert.equal(validateBoundReelBrief(source, { ...approvedBrief, status: "needs_review" }).ok, false);
  assert.equal(validateBoundReelBrief(source, { ...approvedBrief, asset_format: "feed_post" }).ok, false);
});

test("legacy brief resolution succeeds only for one exact approved match", () => {
  assert.equal(selectUnambiguousLegacyReelBrief(source, []).ok, false);
  assert.equal(selectUnambiguousLegacyReelBrief(source, [approvedBrief]).ok, true);
  assert.equal(selectUnambiguousLegacyReelBrief(source, [
    approvedBrief,
    { ...approvedBrief, id: "brief-b" },
  ]).ok, false);
});

test("valid complete storyboard contract passes and remains pending-input shaped", () => {
  const result = validateReelStoryboardOutput(storyboard());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.length, 4);
    assert.deepEqual(result.value.map((row) => row.shot_number), [1, 2, 3, 4]);
    assert.equal(result.value.every((row) => row.motion_type === null && row.motion_strength === null), true);
  }
});

test("storyboard missing a required field fails", () => {
  const value = storyboard();
  delete (value.shots[1] as Partial<ReturnType<typeof shot>>).compiled_prompt;
  assert.equal(validateReelStoryboardOutput(value).ok, false);
});

test("storyboard invalid enum fails", () => {
  const value = storyboard();
  value.shots[2].shot_class = "portrait";
  assert.equal(validateReelStoryboardOutput(value).ok, false);
});

test("storyboard empty prompt fails", () => {
  const value = storyboard();
  value.shots[0].compiled_prompt = " ";
  assert.equal(validateReelStoryboardOutput(value).ok, false);
});

test("storyboard duplicate or non-contiguous shot numbers fail", () => {
  const duplicate = storyboard();
  duplicate.shots[3].shot_number = 3;
  assert.equal(validateReelStoryboardOutput(duplicate).ok, false);
  const gap = storyboard();
  gap.shots[2].shot_number = 4;
  gap.shots[3].shot_number = 5;
  assert.equal(validateReelStoryboardOutput(gap).ok, false);
});

test("storyboard cannot invent provider motion IDs", () => {
  const value = storyboard();
  value.shots[0].motion_type = "invented-provider-motion";
  value.shots[0].motion_strength = 0.5;
  assert.equal(validateReelStoryboardOutput(value).ok, false);
});

test("manual shot contract accepts a selected motion and validates strength", () => {
  const value = { ...shot(1), motion_type: "real-provider-id", motion_strength: 0.5 };
  assert.equal(validatePendingReelShot(value, { requireExplicitFields: true }).ok, true);
  assert.equal(validatePendingReelShot({ ...value, motion_strength: 2 }, { requireExplicitFields: true }).ok, false);
});

test("single-shot regeneration preserves number/tier contract and returns planning-only patch", () => {
  const replacement = { shot: shot(7) };
  const result = validateRegeneratedReelShotOutput(replacement, 7, "draft");
  assert.equal(result.ok, true);
  if (result.ok) {
    const patch = regeneratedPlanningPatch(result.value);
    assert.deepEqual(Object.keys(patch).sort(), [
      "beat_description",
      "compiled_prompt",
      "human_presence",
      "render_tier",
      "shot_class",
    ]);
    assert.equal("shot_number" in patch, false);
    assert.equal("motion_type" in patch, false);
  }
  assert.equal(validateRegeneratedReelShotOutput(replacement, 8, "draft").ok, false);
});

test("brief-origin UI locks source and removes split pipeline pass-through", async () => {
  const panel = await file("src/components/client/ReelStudioPanel.tsx");
  // Phase 2 routes the bound brief through `resolvedBriefId`, which is SEEDED
  // from the brief-origin prefill (and otherwise resolved from the source row's
  // one approved reel_video brief). The Phase 1 guarantee is unchanged: a
  // brief-origin project is still durably bound to that exact brief.
  assert.ok(panel.includes("useState<string | null>(prefill?.productionBriefId ?? null)"));
  assert.ok(panel.includes("clientProductionBriefId: resolvedBriefId ?? undefined"));
  assert.ok(panel.includes("disabled={isBriefOrigin}"));
  assert.doesNotMatch(panel, /transitionContentCreationToAssets|passBriefThrough/);
});

test("project API and backend carry and validate the exact production brief ID", async () => {
  const api = await file("src/lib/api.ts");
  const handler = await file("supabase/functions/create-video-project/index.ts");
  assert.ok(api.includes("client_production_brief_id: input.clientProductionBriefId"));
  assert.match(handler, /validateBoundReelBrief/);
  assert.match(handler, /create_bound_reel_video_project/);
});

test("storyboard validates before one atomic insert and returns inserted rows", async () => {
  const handler = await file("supabase/functions/generate-video-storyboard/index.ts");
  assert.ok(handler.indexOf("validateReelStoryboardOutput") < handler.indexOf('sb.rpc("insert_reel_storyboard_if_empty"'));
  assert.ok(handler.includes("return json({ ok: true, shots: inserted.data });"));
  assert.doesNotMatch(handler, /submit-shot-still-image|submitShotStill/);
});

test("database RPC serializes storyboard creation and inserts only pending rows", async () => {
  const migration = await file("supabase/migrations/20260727000033_reel_studio_phase1_integrity.sql");
  assert.match(migration, /insert_reel_storyboard_if_empty/);
  assert.match(migration, /for update/);
  assert.match(migration, /REEL_STORYBOARD_NOT_EMPTY/);
  assert.match(migration, /'pending'/);
  assert.match(migration, /reel_studio_storyboard_generated/);
  assert.doesNotMatch(migration, /update public\.client_production_briefs|client_pipeline_state/);
});

test("regeneration uses optimistic concurrency and preserves the existing row", async () => {
  const handler = await file("supabase/functions/regenerate-video-shot/index.ts");
  const migration = await file("supabase/migrations/20260727000033_reel_studio_phase1_integrity.sql");
  assert.match(handler, /expected_updated_at/);
  assert.match(handler, /regeneratedPlanningPatch/);
  assert.ok(migration.includes("v_shot.updated_at is distinct from p_expected_updated_at"));
  assert.match(migration, /update public\.video_shots/);
  assert.doesNotMatch(migration.match(/create or replace function public\.regenerate_pending_reel_shot[\s\S]*?end;\n\$\$;/)?.[0] ?? "", /insert into public\.video_shots/);
});

test("delete is one pending-shot server mutation with activity logging", async () => {
  const handler = await file("supabase/functions/delete-video-shot/index.ts");
  const migration = await file("supabase/migrations/20260727000033_reel_studio_phase1_integrity.sql");
  assert.match(handler, /delete_pending_reel_shot/);
  assert.match(migration, /REEL_SHOT_NOT_PENDING/);
  assert.match(migration, /reel_studio_shot_deleted/);
});

test("still submission validates and conditionally claims the latest persisted prompt", async () => {
  const handler = await file("supabase/functions/submit-shot-still-image/index.ts");
  assert.match(handler, /validatePendingReelShot/);
  assert.ok(handler.includes('.eq("updated_at", current.data.updated_at)'));
  assert.ok(handler.includes("claimed.data as { id: string; compiled_prompt: string }"));
});
