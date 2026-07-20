import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20260720000027_ai_background_image_generation.sql", "utf8");
const edge = readFileSync("supabase/functions/generate-ai-background-image/index.ts", "utf8");
const api = readFileSync("src/lib/api.ts", "utf8");
const ui = readFileSync("src/components/client/ContentCreationPanel.tsx", "utf8");
const all = `${migration}\n${edge}\n${api}\n${ui}`;

for (const name of ["client_ai_background_image_generations", "client_ai_background_image_reviews", "create_ai_background_prompt", "update_ai_background_prompt", "generate_ai_background_image"]) assert.ok(migration.includes(name), `missing ${name}`);
assert.match(migration, /enable row level security/i);
assert.match(migration, /revoke all[\s\S]*from public,anon,authenticated/i);
assert.match(migration, /grant select[\s\S]*to authenticated/i);
assert.doesNotMatch(migration, /grant (insert|update|delete)[^;]*to authenticated/i);
assert.equal((migration.match(/security definer set search_path = ''/gi) ?? []).length, 3);
assert.match(migration, /admin','account_manager','editor/);
assert.match(migration, /prompt_status='approved'/);
assert.match(migration, /length\(trim\(v_prompt\)\)=0/);
assert.match(migration, /prompt_status in \('generating'\)/);
assert.match(migration, /production brief does not belong to client/);
assert.match(migration, /source ref/);
assert.match(migration, /AI background prompt draft created/);

assert.match(edge, /Deno\.env\.get\("OPENAI_API_KEY"\)/);
assert.match(edge, /Deno\.env\.get\("OPENAI_IMAGE_MODEL"\) \?\? "gpt-image-1"/);
assert.match(edge, /\/v1\/images\/generations/);
assert.match(edge, /client-assets/);
assert.match(edge, /ai-backgrounds/);
assert.match(edge, /upsert: false/);
assert.match(edge, /prompt_status: "generated"/);
assert.doesNotMatch(edge, /generate-phase-3|publish|client_distribution_records|client_metric_snapshots|client_business_signal_snapshots|client_performance_scores/);

assert.match(api, /generate-ai-background-image/);
assert.match(ui, /Prompt must be human-approved before image generation/);
assert.match(ui, /Final assets still require the normal Produce Asset flow/);
assert.match(ui, /Publishing is not triggered/);
assert.match(ui, /Use as background for this asset/);
assert.match(ui, /setVisualMode\("uploaded_background"\)/);
assert.doesNotMatch(all, /VITE_OPENAI|GPT 2\.0/i);
console.log("AI background image generation foundation checks passed.");
