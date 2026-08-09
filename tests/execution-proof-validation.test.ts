import assert from "node:assert/strict";
import { test } from "node:test";
import { executionHonestyErrors } from "../supabase/functions/_shared/execution-proof-validation.ts";

test("execution proof validation rejects outcome guarantees", () => {
  assert.deepEqual(
    executionHonestyErrors("This campaign provides guaranteed results for every buyer."),
    ["guaranteed outcome"],
  );
  assert.deepEqual(
    executionHonestyErrors("Our clients generated more revenue through this system."),
    ["invented client outcome"],
  );
});

test("execution proof validation permits explicit policy constraints", () => {
  const constraints = [
    "Guaranteed results are prohibited.",
    "Guaranteed leads remain unsupported and must not be claimed.",
    "Do not use guaranteed revenue language.",
    "Any unverified ROI of 5x is forbidden.",
  ];
  for (const constraint of constraints) assert.deepEqual(executionHonestyErrors(constraint), []);
});

test("execution proof validation still catches a claim beside a safe constraint", () => {
  const markdown = `Guaranteed results are prohibited.\nThis campaign nevertheless offers guaranteed leads.`;
  assert.deepEqual(executionHonestyErrors(markdown), ["guaranteed outcome"]);
});
