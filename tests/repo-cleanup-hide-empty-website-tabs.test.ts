// Repo cleanup (Track A): the "Website" nav group's two tabs (Lead Magnets,
// Landing Pages) both render an empty placeholder -- no panel has been built
// for either yet. Hidden from the nav pill row so there's no dead-end click
// path in the live product, following the same "hide before delete"
// convention already used elsewhere in ClientDetailPage (proof_upload,
// offer, masters) -- old deep links to either section still resolve.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const pagePath = path.join(process.cwd(), "src/pages/ClientDetailPage.tsx");

test("the Website page entry is hidden from the nav pill row", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /label: "Website",\s*\n\s*defaultSection: "lead_magnets",[\s\S]{0,400}hidden: true,/);
});

test("DELIVERY_PAGES rendering skips hidden pages", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /if \(page\.hidden\) return null;/);
});

test("lead_magnets and landing_pages remain valid, routable sections despite the hidden pill", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /"lead_magnets"/);
  assert.match(page, /"landing_pages"/);
  assert.match(page, /case "lead_magnets":\s*\n\s*case "landing_pages":/);
});
