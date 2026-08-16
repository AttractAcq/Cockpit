// Ideation nav consolidation, Phase 2: "select Content Items + a timeframe
// -> distribute them across the Calendar" (per content format and any
// approved Execution "Ideation Schedule Contract").
//
// Date assignment reuses the exact deterministic planner
// (planIdeationProposalSlots/parseScheduleContract) already used by
// create-ideation-calendar-proposal, so a manual distribution and an AI
// ideation proposal land on the same days for the same inputs. The actual
// database writes happen inside the single atomic RPC
// distribute_content_items_to_calendar, which re-validates every item at
// write time (still needs_review, zero downstream production, target date
// not protected) and reallocates a fresh ref per moved item -- refs in this
// system are date-stamped identities, so a ref cannot move to a different
// date in place.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import {
  parseScheduleContract,
  planIdeationProposalSlots,
  type IdeationAssetType,
  type ProposalSlot,
} from "../_shared/ideation/proposal/slot-planner.ts";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface RequestedItem {
  table?: string;
  ref?: string;
}

interface RequestBody {
  client_id?: string;
  items?: RequestedItem[];
  start_date?: string;
  end_date?: string;
}

function assetTypeForOrganic(contentType: string): IdeationAssetType | null {
  if (contentType === "FP") return "static";
  if (contentType === "CR") return "carousel";
  if (contentType === "RL") return "reel";
  return null;
}

function statusForRpcError(message: string): number {
  if (message.includes("FORBIDDEN")) return 403;
  if (message.includes("NOT_FOUND")) return 404;
  if (
    message.includes("NOT_REVIEWABLE") ||
    message.includes("HAS_DOWNSTREAM") ||
    message.includes("CALENDAR_CONFLICT")
  ) {
    return 409;
  }
  if (
    message.includes("EMPTY") ||
    message.includes("INVALID_ASSIGNMENT") ||
    message.includes("DUPLICATE_REF") ||
    message.includes("UNSUPPORTED_TABLE") ||
    message.includes("UNSUPPORTED_ASSET_TYPE")
  ) {
    return 400;
  }
  return 500;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ code: "INVALID_JSON", message: "Request body must be JSON." }, 400);
  }

  const clientId = (body.client_id ?? "").trim();
  const startDate = (body.start_date ?? "").trim();
  const endDate = (body.end_date ?? "").trim();
  const requested = (body.items ?? [])
    .map((item) => ({ table: (item.table ?? "").trim(), ref: (item.ref ?? "").trim() }))
    .filter((item) => item.table && item.ref);

  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate)) {
    return json({ code: "INVALID_PERIOD", message: "start_date and end_date must be YYYY-MM-DD." }, 400);
  }
  if (startDate > endDate) {
    return json({ code: "INVALID_PERIOD", message: "start_date must not be after end_date." }, 400);
  }
  if (requested.length === 0) {
    return json({ code: "ITEMS_REQUIRED", message: "At least one Content Item must be selected." }, 400);
  }
  const unsupportedTable = requested.find((item) => item.table !== "organic_master" && item.table !== "story_master");
  if (unsupportedTable) {
    return json({
      code: "UNSUPPORTED_TABLE",
      message: `${unsupportedTable.ref} is not eligible — only organic_master/story_master Content Items can be distributed to the Calendar.`,
    }, 400);
  }

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) {
    return json({ code: access.code, message: access.message }, access.status);
  }

  const sb = svc();
  const organicRefs = requested.filter((item) => item.table === "organic_master").map((item) => item.ref);
  const storyRefs = requested.filter((item) => item.table === "story_master").map((item) => item.ref);

  const [organicResult, storyResult, executionResult] = await Promise.all([
    organicRefs.length
      ? sb.from("organic_master").select("ref, content_type, review_state").eq("client_id", clientId).in("ref", organicRefs)
      : Promise.resolve({ data: [], error: null }),
    storyRefs.length
      ? sb.from("story_master").select("ref, review_state").eq("client_id", clientId).in("ref", storyRefs)
      : Promise.resolve({ data: [], error: null }),
    sb.from("client_execution_files").select("file_name, content_md").eq("client_id", clientId).eq("review_state", "approved"),
  ]);
  if (organicResult.error) return json({ code: "LOOKUP_FAILED", message: organicResult.error.message }, 500);
  if (storyResult.error) return json({ code: "LOOKUP_FAILED", message: storyResult.error.message }, 500);
  if (executionResult.error) return json({ code: "LOOKUP_FAILED", message: executionResult.error.message }, 500);

  const organicByRef = new Map((organicResult.data ?? []).map((row) => [row.ref as string, row]));
  const storyByRef = new Map((storyResult.data ?? []).map((row) => [row.ref as string, row]));

  const missing = requested.filter((item) =>
    item.table === "organic_master" ? !organicByRef.has(item.ref) : !storyByRef.has(item.ref));
  if (missing.length > 0) {
    return json({
      code: "ITEMS_NOT_FOUND",
      message: "Some selected Content Items could not be found for this client.",
      refs: missing.map((item) => item.ref),
    }, 404);
  }

  type Resolved = { table: "organic_master" | "story_master"; ref: string; assetType: IdeationAssetType };
  const resolved: Resolved[] = [];
  for (const item of requested) {
    if (item.table === "organic_master") {
      const row = organicByRef.get(item.ref)!;
      const assetType = assetTypeForOrganic(row.content_type as string);
      if (!assetType) {
        return json({ code: "UNSUPPORTED_ASSET_TYPE", message: `${item.ref} has an unsupported content_type.` }, 400);
      }
      resolved.push({ table: "organic_master", ref: item.ref, assetType });
    } else {
      resolved.push({ table: "story_master", ref: item.ref, assetType: "story" });
    }
  }

  const requiredByAssetType: Record<IdeationAssetType, number> = { reel: 0, carousel: 0, static: 0, story: 0 };
  for (const item of resolved) requiredByAssetType[item.assetType] += 1;

  let slots: ProposalSlot[];
  try {
    const scheduleContract = parseScheduleContract(
      (executionResult.data ?? []).map((row) => ({ file_name: row.file_name as string, content_md: row.content_md as string })),
    );
    slots = planIdeationProposalSlots({
      periodStart: startDate,
      periodEnd: endDate,
      requiredByAssetType,
      weekdays: scheduleContract.weekdays,
    });
  } catch (error) {
    return json({
      code: "SLOT_MANIFEST_INVALID",
      message: error instanceof Error ? error.message : String(error),
    }, 409);
  }
  if (slots.length !== resolved.length) {
    return json({ code: "SLOT_MANIFEST_MISMATCH", message: "The slot manifest does not reconcile with the selected items." }, 409);
  }

  const slotsByType = new Map<IdeationAssetType, ProposalSlot[]>();
  for (const slot of slots) {
    const list = slotsByType.get(slot.required_asset_type) ?? [];
    list.push(slot);
    slotsByType.set(slot.required_asset_type, list);
  }
  const itemsByType = new Map<IdeationAssetType, Resolved[]>();
  for (const item of [...resolved].sort((a, b) => a.ref.localeCompare(b.ref))) {
    const list = itemsByType.get(item.assetType) ?? [];
    list.push(item);
    itemsByType.set(item.assetType, list);
  }

  const assignments: Array<{ table: string; ref: string; date: string }> = [];
  for (const [assetType, typeItems] of itemsByType) {
    const typeSlots = slotsByType.get(assetType) ?? [];
    typeItems.forEach((item, index) => {
      assignments.push({ table: item.table, ref: item.ref, date: typeSlots[index].proposed_date });
    });
  }

  const { data, error } = await sb.rpc("distribute_content_items_to_calendar", {
    p_client_id: clientId,
    p_actor_id: access.userId,
    p_assignments: assignments,
  });
  if (error) {
    return json({ code: "DISTRIBUTE_FAILED", message: error.message }, statusForRpcError(error.message));
  }

  await audit(sb, "content_items.distributed_to_calendar", "calendar_cells", null, {
    client_id: clientId,
    count: data.count,
    period_start: startDate,
    period_end: endDate,
  });

  return json(data, 200);
});
