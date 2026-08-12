export interface IdeationRequestBody {
  client_id?: string;
  period_type?: string;
  start_date?: string;
  end_date?: string;
  month?: string;
  idempotency_key?: string;
  strategic_input_sources?: Array<"campaign_intelligence" | "main_offer" | "seasonal_offer">;
}

export function parseIdeationRequestBody(value: unknown):
  | { ok: true; body: IdeationRequestBody }
  | { ok: false; code: "MALFORMED_REQUEST"; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      code: "MALFORMED_REQUEST",
      message: "The request body must be a JSON object.",
    };
  }
  const row = value as Record<string, unknown>;
  const allowedFields = new Set([
    "client_id",
    "period_type",
    "start_date",
    "end_date",
    "month",
    "idempotency_key",
    "strategic_input_sources",
  ]);
  const unsupportedFields = Object.keys(row).filter((field) => !allowedFields.has(field));
  if (unsupportedFields.length > 0) {
    return {
      ok: false,
      code: "MALFORMED_REQUEST",
      message: `Unsupported request field: ${unsupportedFields.sort()[0]}.`,
    };
  }
  for (const field of allowedFields) {
    if (field === "strategic_input_sources") continue;
    if (row[field] !== undefined && typeof row[field] !== "string") {
      return {
        ok: false,
        code: "MALFORMED_REQUEST",
        message: `${field} must be a string when supplied.`,
      };
    }
  }
  if (row.strategic_input_sources !== undefined) {
    if (!Array.isArray(row.strategic_input_sources)) {
      return {
        ok: false,
        code: "MALFORMED_REQUEST",
        message: "strategic_input_sources must be an array when supplied.",
      };
    }
    const allowedSources = new Set(["campaign_intelligence", "main_offer", "seasonal_offer"]);
    const seen = new Set<string>();
    for (const entry of row.strategic_input_sources) {
      if (typeof entry !== "string" || !allowedSources.has(entry)) {
        return {
          ok: false,
          code: "MALFORMED_REQUEST",
          message: "strategic_input_sources may only contain campaign_intelligence, main_offer, or seasonal_offer.",
        };
      }
      if (seen.has(entry)) {
        return {
          ok: false,
          code: "MALFORMED_REQUEST",
          message: "strategic_input_sources cannot contain duplicates.",
        };
      }
      seen.add(entry);
    }
  }
  return { ok: true, body: row as IdeationRequestBody };
}
