export interface IdeationRequestBody {
  client_id?: string;
  period_type?: string;
  start_date?: string;
  end_date?: string;
  month?: string;
  idempotency_key?: string;
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
    if (row[field] !== undefined && typeof row[field] !== "string") {
      return {
        ok: false,
        code: "MALFORMED_REQUEST",
        message: `${field} must be a string when supplied.`,
      };
    }
  }
  return { ok: true, body: row as IdeationRequestBody };
}
