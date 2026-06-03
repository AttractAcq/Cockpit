// src/lib/mock/index.ts
// Shim: re-exports the LIVE api under the mockApi name so every existing
// call site (mockApi.x.y()) goes live with zero changes.
// The old mock fixtures (clients.ts, triage.ts, etc.) are no longer the
// runtime source; they survive only as demo-fallback data in components.
import { api } from "@/lib/api";

export const mockApi = api;
export default mockApi;
