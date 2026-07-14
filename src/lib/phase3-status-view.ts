export function isMissingPhase3StatusViewError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
  if (candidate.code === "42P01") return true;
  if (candidate.code !== "PGRST205") return false;
  const text = `${String(candidate.message ?? "")} ${String(candidate.details ?? "")}`.toLowerCase();
  return text.includes("client_phase3_status_v") && (text.includes("schema cache") || text.includes("could not find"));
}
