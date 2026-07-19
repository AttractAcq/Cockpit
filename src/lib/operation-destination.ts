import { ROUTES } from "@/lib/constants";
import type { ActivityLogEntry } from "@/types/client";

export type OperationDestinationPrecision = "record" | "tab" | "client";

export interface OperationDestination {
  pathname: string;
  search?: string;
  tab?: string;
  label: string;
  precision: OperationDestinationPrecision;
  targetType?: string;
  targetId?: string;
}

export interface ActivityTargetMetadata {
  client_id?: string;
  target_type?: string;
  target_id?: string;
  source_ref?: string;
  asset_group_ref?: string;
  brief_id?: string;
  distribution_record_id?: string;
  analytics_record_id?: string;
  operation_id?: string;
  origin_stage?: string;
  result_stage?: string;
  route_tab?: string;
}

const CLIENT_SECTIONS = new Set([
  "overview", "calendar", "context_inputs", "context_files", "execution_files", "pipeline",
  "masters", "content_creation", "assets", "distribution", "analytics", "archive", "activity",
]);

const DESTRUCTIVE_EVENTS = [
  "destructive_", "delete_", "rollback", "recovery",
];

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadata(event: ActivityLogEntry): Record<string, unknown> {
  return event.metadata && typeof event.metadata === "object" ? event.metadata : {};
}

function metadataClientMismatch(event: ActivityLogEntry, meta: Record<string, unknown>): boolean {
  const metaClientId = stringValue(meta.client_id);
  return !!metaClientId && !!event.client_id && metaClientId !== event.client_id;
}

function tabPath(clientId: string, tab: string, params?: Record<string, string | null | undefined>): OperationDestination {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) search.set(key, value);
  }
  return {
    pathname: ROUTES.clientSection(clientId, tab),
    search: search.toString() ? `?${search.toString()}` : undefined,
    tab,
    label: labelForTab(tab),
    precision: search.toString() ? "record" : "tab",
    targetType: search.keys().next().value ?? undefined,
    targetId: Object.values(params ?? {}).find(Boolean) ?? undefined,
  };
}

function labelForTab(tab: string): string {
  const labels: Record<string, string> = {
    overview: "Open client",
    calendar: "Open Phase 3",
    masters: "Open Content",
    content_creation: "Open Content Briefs",
    assets: "View asset",
    distribution: "Open Distribution",
    analytics: "Open Analytics",
    archive: "Open Archive",
    activity: "Open Activity",
  };
  return labels[tab] ?? "Open client";
}

function safeRouteTab(value: unknown): string | null {
  const tab = stringValue(value);
  return tab && CLIENT_SECTIONS.has(tab) ? tab : null;
}

function explicitRoute(event: ActivityLogEntry, meta: Record<string, unknown>): OperationDestination | null {
  const explicitPath = stringValue(meta.pathname) ?? stringValue(meta.route_pathname) ?? stringValue(meta.route_path);
  if (explicitPath?.startsWith("/clients/")) {
    if (!event.client_id || !explicitPath.startsWith(`/clients/${event.client_id}`)) return null;
    return {
      pathname: explicitPath,
      search: stringValue(meta.search) ?? stringValue(meta.route_search) ?? undefined,
      tab: safeRouteTab(meta.route_tab) ?? undefined,
      label: stringValue(meta.route_label) ?? "Open destination",
      precision: "record",
      targetType: stringValue(meta.target_type) ?? undefined,
      targetId: stringValue(meta.target_id) ?? undefined,
    };
  }
  if (explicitPath === ROUTES.operations) {
    return {
      pathname: ROUTES.operations,
      search: stringValue(meta.search) ?? stringValue(meta.route_search) ?? undefined,
      label: stringValue(meta.route_label) ?? "Open operation",
      precision: "record",
      targetType: "operation",
      targetId: stringValue(meta.operation_id) ?? undefined,
    };
  }
  return null;
}

function stageTab(stage: string | null): string | null {
  if (!stage) return null;
  const normalized = stage.toLowerCase();
  if (["master", "masters", "content"].includes(normalized)) return "masters";
  if (["content_creation", "brief", "briefs", "production_brief"].includes(normalized)) return "content_creation";
  if (["assets", "asset"].includes(normalized)) return "assets";
  if (["distribution", "publish", "publishing"].includes(normalized)) return "distribution";
  if (["analytics", "analysis"].includes(normalized)) return "analytics";
  if (["archive", "archived"].includes(normalized)) return "archive";
  if (["phase3", "phase_3", "calendar"].includes(normalized)) return "calendar";
  return null;
}

function eventTab(eventType: string, meta: Record<string, unknown>): string | null {
  const explicit = safeRouteTab(meta.route_tab);
  if (explicit) return explicit;
  const resultStage = stageTab(stringValue(meta.result_stage));
  if (resultStage) return resultStage;
  const originStage = stageTab(stringValue(meta.origin_stage));
  if (originStage) return originStage;
  const type = eventType.toLowerCase();
  if (type.includes("phase3") || type.includes("phase_3")) return "calendar";
  if (type.includes("phase1") || type.includes("phase_1")) return "overview";
  if (type.includes("phase2") || type.includes("phase_2")) return "overview";
  if (type.includes("production_brief") || type.includes("brief")) return "content_creation";
  if (type.includes("asset_generation") || type.includes("asset_frame") || type.includes("asset_") || type.includes("production_assets") || type.includes("export")) return "assets";
  if (type.includes("distribution") || type.includes("publish") || type.includes("scheduled")) return "distribution";
  if (type.includes("analytics") || type.includes("metric")) return "analytics";
  if (type.includes("archive") || type.includes("lifecycle_completed")) return "archive";
  if (type.includes("master") || type.includes("content")) return "masters";
  return null;
}

function destructiveOperationDestination(event: ActivityLogEntry, meta: Record<string, unknown>): OperationDestination | null {
  const type = event.event_type.toLowerCase();
  const looksDestructive = DESTRUCTIVE_EVENTS.some((prefix) => type.startsWith(prefix) || type.includes(prefix));
  const operationId = stringValue(meta.operation_id) ?? (event.object_type === "client_destructive_operation" ? event.object_id : null);
  if (!looksDestructive && !operationId) return null;
  if (!operationId) return event.client_id ? {
    pathname: ROUTES.client(event.client_id),
    label: "Open client",
    precision: "client",
  } : null;
  return {
    pathname: ROUTES.operations,
    search: `?operation_id=${encodeURIComponent(operationId)}`,
    label: "Open operation",
    precision: "record",
    targetType: "operation",
    targetId: operationId,
  };
}

export function buildActivityTargetMetadata(input: ActivityTargetMetadata): ActivityTargetMetadata {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== "")) as ActivityTargetMetadata;
}

export function resolveOperationDestination(event: ActivityLogEntry): OperationDestination | null {
  const clientId = event.client_id;
  const meta = metadata(event);
  if (metadataClientMismatch(event, meta)) {
    return clientId ? { pathname: ROUTES.client(clientId), label: "Open client", precision: "client" } : null;
  }

  const explicit = explicitRoute(event, meta);
  if (explicit) return explicit;

  const destructive = destructiveOperationDestination(event, meta);
  if (destructive) return destructive;

  if (!clientId) return null;

  const targetType = stringValue(meta.target_type) ?? event.object_type ?? null;
  const targetId = stringValue(meta.target_id) ?? event.object_id ?? null;
  const briefId = stringValue(meta.brief_id) ?? (targetType === "client_production_brief" ? targetId : null);
  const distributionId = stringValue(meta.distribution_record_id)
    ?? ((event.event_type.includes("distribution") || event.event_type.includes("publish")) ? stringValue(meta.record_id) : null)
    ?? (targetType === "client_distribution_record" ? targetId : null);
  const analyticsId = stringValue(meta.analytics_record_id) ?? (targetType === "client_analytics_record" ? targetId : null);
  const operationId = stringValue(meta.operation_id) ?? (targetType === "client_destructive_operation" ? targetId : null);
  const assetGroupRef = stringValue(meta.asset_group_ref) ?? (targetType === "asset_group" ? targetId : null);
  const sourceRef = stringValue(meta.source_ref) ?? stringValue(meta.ref) ?? stringValue(meta.target_ref);

  if (briefId) return tabPath(clientId, "content_creation", { brief_id: briefId });
  if (distributionId) return tabPath(clientId, "distribution", { distribution_id: distributionId });
  if (analyticsId) return tabPath(clientId, "analytics", { analytics_id: analyticsId });
  if (operationId) return { pathname: ROUTES.operations, search: `?operation_id=${encodeURIComponent(operationId)}`, label: "Open operation", precision: "record", targetType: "operation", targetId: operationId };
  if (assetGroupRef) return tabPath(clientId, "assets", { asset_group_ref: assetGroupRef });

  const tab = eventTab(event.event_type, meta);
  if (sourceRef && tab) {
    if (tab === "assets") return tabPath(clientId, "assets", { source_ref: sourceRef });
    if (tab === "distribution") return tabPath(clientId, "distribution", { source_ref: sourceRef });
    if (tab === "analytics") return tabPath(clientId, "analytics", { source_ref: sourceRef });
    if (tab === "archive") return tabPath(clientId, "archive", { source_ref: sourceRef });
    if (tab === "content_creation") return tabPath(clientId, "content_creation", { source_ref: sourceRef });
    if (tab === "masters") return tabPath(clientId, "masters", { source_ref: sourceRef });
  }
  if (tab) return tabPath(clientId, tab);
  if (sourceRef) return tabPath(clientId, "archive", { source_ref: sourceRef });
  return { pathname: ROUTES.client(clientId), label: "Open client", precision: "client" };
}
