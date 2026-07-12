import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type IntegrationPill = "connected" | "registered" | "blocked";

export interface IntegrationStatus {
  service: string;
  label: string;
  pill: IntegrationPill;
  detail: string;
}

export interface TeamMember {
  full_name: string;
  email: string;
  role: string;
  initials: string;
}

export interface SettingsData {
  integrations: IntegrationStatus[];
  team: TeamMember[];
  loading: boolean;
  error: string | null;
}

// External provisioning status — set by hand, never from DB (no secrets involved).
// Meta "approved" = account approved → treated as connected.
const EXTERNAL_STATUS: Record<string, "connected" | "pending" | "not-started"> = {
  meta: "connected",
  "360dialog": "not-started",
  payfast: "pending",
  n8n: "connected",
  apify: "connected",
  anthropic: "connected",
  openai: "connected",
  telegram: "connected",
};

const DISPLAY_INTEGRATIONS: { service: string; label: string }[] = [
  { service: "meta", label: "Meta Ads" },
  { service: "360dialog", label: "360dialog (WhatsApp)" },
  { service: "payfast", label: "PayFast" },
  { service: "n8n", label: "n8n" },
  { service: "apify", label: "Apify" },
  { service: "anthropic", label: "Anthropic API" },
  { service: "openai", label: "OpenAI" },
  { service: "telegram", label: "Telegram Bot" },
];

function resolvePill(
  inRegistry: boolean,
  externalStatus: "connected" | "pending" | "not-started",
): IntegrationPill {
  if (externalStatus === "not-started" || !inRegistry) return "blocked";
  if (externalStatus === "pending") return "registered";
  return "connected";
}

function formatDetail(
  row: { credential_type: string; vault_name: string } | undefined,
): string {
  if (!row) return "not registered";
  const { credential_type, vault_name } = row;
  if (vault_name.startsWith("edge_fn_secret:")) {
    const varName = vault_name.slice("edge_fn_secret:".length);
    return `${credential_type} · env var ${varName}`;
  }
  return `${credential_type} · vault ${vault_name}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function useSettingsData(): SettingsData {
  const [state, setState] = useState<SettingsData>({
    integrations: [],
    team: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [registryRes, teamRes] = await Promise.all([
          supabase
            .from("credential_registry")
            .select("service, credential_type, vault_name"),
          supabase
            .from("team_members")
            .select("role, users!user_id(full_name, email)")
            .is("client_entity_id", null),
        ]);

        if (registryRes.error) throw registryRes.error;
        if (teamRes.error) throw teamRes.error;
        if (cancelled) return;

        const registryMap = new Map(
          (registryRes.data ?? []).map((r) => [r.service, r]),
        );

        const integrations: IntegrationStatus[] = DISPLAY_INTEGRATIONS.map(
          ({ service, label }) => {
            const reg = registryMap.get(service);
            const ext = EXTERNAL_STATUS[service] ?? "connected";
            return {
              service,
              label,
              pill: resolvePill(!!reg, ext),
              detail: formatDetail(reg),
            };
          },
        );

        const team: TeamMember[] = (teamRes.data ?? []).map((row) => {
          const raw = row.users as unknown;
          const user = (Array.isArray(raw) ? raw[0] : raw) as
            | { full_name: string | null; email: string | null }
            | null;
          const name = user?.full_name ?? "Unknown";
          return {
            full_name: name,
            email: user?.email ?? "—",
            role: row.role,
            initials: initials(name),
          };
        });

        setState({ integrations, team, loading: false, error: null });
      } catch (err) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : "Failed to load settings",
          }));
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return state;
}
