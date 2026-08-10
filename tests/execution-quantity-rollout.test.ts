import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const phase2 = readFileSync(new URL("../supabase/functions/generate-phase-2/index.ts", import.meta.url), "utf8");
const executionConfig = readFileSync(new URL("../supabase/functions/generate-execution-config/index.ts", import.meta.url), "utf8");

test("new E05 files receive a server-derived quantity contract", () => {
  assert.match(phase2, /sectionName === "E05"/);
  assert.match(phase2, /quantityAuthorityFromCalendar\(content\)/);
  assert.match(phase2, /content = `\$\{content\}\\n\\n\$\{quantityAuthority\.markdown\}`/);
  assert.match(phase2, /missing the server-derived ## Ideation Quantity Contract section/);
});

test("legacy compatibility remains explicit in config evidence", () => {
  assert.match(executionConfig, /authority_mode === "legacy_rule_2"/);
  assert.match(executionConfig, /Legacy compatibility:/);
  assert.match(executionConfig, /Human review remains required/);
});
