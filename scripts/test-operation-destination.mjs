import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL("../src/lib/operation-destination.ts", import.meta.url), "utf8")
  .replace('import { ROUTES } from "@/lib/constants";', 'const { ROUTES } = require("@/lib/constants");')
  .replace('import type { ActivityLogEntry } from "@/types/client";', "");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = {
  exports: {},
  require: (id) => {
    if (id === "@/lib/constants") return { ROUTES: { client: (clientId) => `/clients/${clientId}`, clientSection: (clientId, section) => `/clients/${clientId}/${section}`, operations: "/operations" } };
    return require(id);
  },
  URLSearchParams,
};
vm.runInNewContext(output, context);
const { resolveOperationDestination } = context.exports;

const base = {
  id: "evt1",
  client_id: "client1",
  actor_id: null,
  event_type: "event",
  plain_english_message: "message",
  object_type: null,
  object_id: null,
  metadata: {},
  created_at: "2026-07-16T00:00:00Z",
};
const event = (patch) => ({ ...base, ...patch, metadata: patch.metadata ?? {} });

assert.equal(JSON.stringify(resolveOperationDestination(event({
  metadata: { route_pathname: "/clients/client1/assets", route_search: "?asset_group_ref=grp1", route_tab: "assets", target_type: "asset_group", target_id: "grp1" },
}))), JSON.stringify({ pathname: "/clients/client1/assets", search: "?asset_group_ref=grp1", tab: "assets", label: "Open destination", precision: "record", targetType: "asset_group", targetId: "grp1" }));

assert.equal(resolveOperationDestination(event({ metadata: { asset_group_ref: "grp1" } }))?.pathname, "/clients/client1/assets");
assert.equal(resolveOperationDestination(event({ metadata: { asset_group_ref: "grp1" } }))?.search, "?asset_group_ref=grp1");
assert.equal(resolveOperationDestination(event({ metadata: { target_type: "asset_group", target_id: "grp2" } }))?.search, "?asset_group_ref=grp2");
assert.equal(resolveOperationDestination(event({ metadata: { brief_id: "brief1" } }))?.search, "?brief_id=brief1");
assert.equal(resolveOperationDestination(event({ event_type: "asset_publish_failed", metadata: { distribution_record_id: "dist1" } }))?.pathname, "/clients/client1/distribution");
assert.equal(resolveOperationDestination(event({ event_type: "distribution_schedule", metadata: { record_id: "dist2" } }))?.search, "?distribution_id=dist2");
assert.equal(resolveOperationDestination(event({ event_type: "lifecycle_completed", metadata: { source_ref: "Jul16-FP-001" } }))?.pathname, "/clients/client1/archive");
assert.equal(resolveOperationDestination(event({ event_type: "analytics_collection_completed", metadata: { analytics_record_id: "ana1" } }))?.search, "?analytics_id=ana1");
assert.equal(resolveOperationDestination(event({ event_type: "destructive_delete_asset", metadata: { operation_id: "op1", asset_group_ref: "deleted" } }))?.pathname, "/operations");
assert.equal(resolveOperationDestination(event({ event_type: "phase3_scoped_run_completed", metadata: { route_tab: "calendar" } }))?.pathname, "/clients/client1/calendar");
assert.equal(resolveOperationDestination(event({ event_type: "legacy_event" }))?.precision, "client");
assert.equal(resolveOperationDestination(event({ client_id: null, metadata: {} })), null);
assert.equal(resolveOperationDestination(event({ metadata: { client_id: "other", asset_group_ref: "grp1" } }))?.precision, "client");
assert.equal(resolveOperationDestination(event({ event_type: "master_row_approved", metadata: { source_ref: "Jul16-FP-001" } }))?.search, "?source_ref=Jul16-FP-001");
assert.equal(resolveOperationDestination(event({ event_type: "asset_generation_completed", plain_english_message: "generated group grp-from-prose" }))?.precision, "tab");

console.log("operation-destination tests passed");
