import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "supabase/functions/meta-webhook/index.ts"), "utf8");

const leadgenMatch = source.match(/async function handleLeadgen[\s\S]*?\n}/);
assert.ok(leadgenMatch, "handleLeadgen exists");
const leadgen = leadgenMatch[0];

assert.ok(source.includes("async function handleIgMessage"), "Instagram DM handler remains present");
assert.ok(!leadgen.includes(".rpc(\"increment_ad_lead\""), "leadgen no longer calls increment_ad_lead");
assert.ok(
  leadgen.includes("lead_counter_status: leadCounterStatus") &&
    leadgen.includes("\"disabled_no_supported_rpc\""),
  "leadgen event metadata records disabled lead counter status",
);
assert.ok(leadgen.includes("campaignErr"), "campaign lookup errors are checked");
assert.ok(leadgen.includes("eventErr"), "leadgen event insert errors are checked");
assert.ok(leadgen.includes("triageErr"), "leadgen triage insert errors are checked");
assert.ok(!source.includes("CREATE FUNCTION public.increment_ad_lead"), "no replacement increment function was introduced");

console.log("meta-webhook deprecation tests passed");
