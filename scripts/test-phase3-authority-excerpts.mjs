import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const helperSource = fs.readFileSync(new URL("../supabase/functions/_shared/phase3-authority.ts", import.meta.url), "utf8");
const monthly = fs.readFileSync(new URL("../supabase/functions/generate-phase-3/index.ts", import.meta.url), "utf8");
const scoped = fs.readFileSync(new URL("../supabase/functions/_shared/phase3-scope.ts", import.meta.url), "utf8");
const preview = fs.readFileSync(new URL("../supabase/functions/preview-phase-3-scope/index.ts", import.meta.url), "utf8");
const combined = helperSource + monthly + scoped;
const js = ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const helper = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const content = `# Content System

## General
${"general ".repeat(120)}

### Low-Confidence CTA Test Guidance

- Future proof-led feed and carousel posts should usually include one low-friction CTA where appropriate.
- Treat this as a low-confidence test input until stronger performance data exists.

## Unrelated Later Section

This must not be included.`;
const file = { file_number: 9, file_name: "09_Content_System.md", content_md: content };

const extracted = helper.extractMarkdownSection(content, helper.CTA_GUIDANCE_HEADING);
assert.match(extracted, /^### Low-Confidence CTA Test Guidance/);
assert.match(extracted, /low-confidence test input/);
assert.doesNotMatch(extracted, /Unrelated Later Section/);
assert.equal(helper.extractMarkdownSection(content, "Missing Heading"), "");
assert.equal(helper.extractMarkdownSection("not markdown", helper.CTA_GUIDANCE_HEADING), "");
assert.ok(extracted.length <= 1_200);

for (const format of ["feed_post", "carousel"]) {
  const authority = helper.buildPhase3ContextFileExcerpt(file, format, 500);
  assert.match(authority, /TARGETED CONTEXT SECTION FROM 09_Content_System\.md/);
  assert.match(authority, /Low-Confidence CTA Test Guidance/);
  assert.equal((authority.match(/Low-Confidence CTA Test Guidance/g) ?? []).length, 1);
  assert.doesNotMatch(authority, /Unrelated Later Section/);
}
for (const format of ["reel_video", "story_sequence", "ad_static"]) {
  assert.doesNotMatch(helper.buildPhase3ContextFileExcerpt(file, format, 500), /Low-Confidence CTA Test Guidance/);
}
assert.ok(helper.buildPhase3ContextFileExcerpt(file, "feed_post", 500).length <= 500 + 2 + 80 + 1_200);
const alreadyVisible = { ...file, content_md: `### Low-Confidence CTA Test Guidance\nVisible in base.` };
assert.equal((helper.buildPhase3ContextFileExcerpt(alreadyVisible, "feed_post", 500).match(/Low-Confidence CTA Test Guidance/g) ?? []).length, 1);
assert.equal(helper.buildPhase3ContextFileExcerpt({ ...file, file_number: 8 }, "feed_post", 500).length, 500);

assert.match(monthly, /organic_feed_posts[\s\S]*\? "feed_post"/);
assert.match(monthly, /organic_carousels[\s\S]*\? "carousel"/);
assert.match(monthly, /organic_reels[\s\S]*\? "reel_video"/);
assert.match(monthly, /buildPhase3ContextFileExcerpt/);
assert.match(scoped, /authorityText\(context: AuthorityFile\[\], execution: AuthorityFile\[\], format: ScopedFormat\)/);
assert.match(scoped, /buildPhase3ContextFileExcerpt\(f, format, 500\)/);
assert.match(scoped, /authorityText\(context, execution, slot\.asset_format\)/);
assert.match(preview, /read-only preview[\s\S]*NO AI, NO writes/i);
assert.doesNotMatch(preview, /callAnthropic|callOpenAI|\.insert\(|\.update\(|\.delete\(/);
assert.doesNotMatch(helperSource, /callAnthropic|callOpenAI|supabase|\.from\(|\.rpc\(/i);
assert.doesNotMatch(combined, /client_context_update_proposals|client_context_patch_drafts|client_iteration_candidates|client_performance_scores|client_metric_snapshots/);
assert.doesNotMatch(helperSource, /generation_jobs|media_publish|schedule|reconcile|client_assets/);

console.log("phase3-authority-excerpts tests passed");
