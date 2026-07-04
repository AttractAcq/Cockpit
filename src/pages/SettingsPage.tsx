import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { EmptyState } from "@/components/primitives";
import type { Integration, User } from "@/types/client";

type Tab = "workspace" | "users" | "integrations" | "secrets";

const TABS: { id: Tab; label: string }[] = [
  { id: "workspace",    label: "Workspace" },
  { id: "users",        label: "Users" },
  { id: "integrations", label: "Integrations" },
  { id: "secrets",      label: "Secret References" },
];

const STATUS_BADGE: Record<string, string> = {
  not_configured: "text-paper-3 bg-ink-100",
  configured:     "text-teal bg-teal/10",
  error:          "text-neg bg-neg/10",
};

function IntegrationsTab() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { data } = await supabase.from("integrations").select("*").order("name");
        setIntegrations(data ?? []);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="text-paper-3 text-xs p-4">Loading…</div>;

  return (
    <div className="flex flex-col gap-0">
      {integrations.map((int) => (
        <div key={int.id} className="px-4 py-3 border-b border-line last:border-b-0 flex items-center gap-3">
          <span className="text-xs text-paper font-medium capitalize w-24">{int.name}</span>
          <span className={`text-2xs font-mono px-1.5 py-0.5 rounded ${STATUS_BADGE[int.status] ?? "text-paper-3"}`}>
            {int.status.replace("_", " ")}
          </span>
          {int.notes && <span className="text-2xs text-paper-3 ml-2">{int.notes}</span>}
          <span className="ml-auto text-2xs text-paper-3">
            {int.status !== "configured"
              ? "Configure in Supabase Vault (service role only)"
              : "Secret provisioned in Vault"}
          </span>
        </div>
      ))}
      <p className="px-4 py-3 text-2xs text-paper-3">
        Raw secret values are stored in Supabase Vault (service role only). This page records
        that a named secret has been provisioned — it never shows the value.
      </p>
    </div>
  );
}

function UsersTab() {
  const [users, setUsers]   = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { data } = await supabase.from("users").select("*").order("email");
        setUsers((data as User[]) ?? []);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="text-paper-3 text-xs p-4">Loading…</div>;
  if (users.length === 0) return <EmptyState icon="users" title="No users yet" />;

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-line">
          {["Email", "Name", "Role"].map((h) => (
            <th key={h} className="px-4 py-2.5 text-left text-2xs uppercase tracking-cap text-paper-3 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {users.map((u) => (
          <tr key={u.id} className="border-b border-line last:border-b-0">
            <td className="px-4 py-2.5 text-paper">{u.email}</td>
            <td className="px-4 py-2.5 text-paper-2">{u.full_name ?? "—"}</td>
            <td className="px-4 py-2.5">
              <span className="text-2xs font-mono text-paper-2 capitalize">
                {u.role.replace("_", " ")}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WorkspaceTab() {
  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-2xs uppercase tracking-cap text-paper-3">Workspace</span>
        <span className="text-xs text-paper">Attract Acquisition</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-2xs uppercase tracking-cap text-paper-3">Supabase Project</span>
        <span className="text-xs text-paper font-mono">xivewedajschthjlblfb</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-2xs uppercase tracking-cap text-paper-3">Region</span>
        <span className="text-xs text-paper">eu-west-3 (Paris)</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-2xs uppercase tracking-cap text-paper-3">Design Tokens</span>
        <div className="flex items-center gap-2 mt-1">
          {[
            { label: "ink",   colour: "#0A0E0D" },
            { label: "teal",  colour: "#00E5C3" },
            { label: "warn",  colour: "#FFB454" },
            { label: "neg",   colour: "#E26D6D" },
            { label: "paper", colour: "#F2EFE6" },
          ].map((t) => (
            <div key={t.label} className="flex items-center gap-1.5">
              <span
                className="w-3.5 h-3.5 rounded-sm border border-line"
                style={{ backgroundColor: t.colour }}
              />
              <span className="text-2xs text-paper-3 font-mono">{t.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SecretsTab() {
  return (
    <div className="p-4">
      <p className="text-xs text-paper-3 mb-3">
        This page shows <strong className="text-paper">reference names only</strong> — never values.
        Raw secrets live in Supabase Vault (service-role only). Provision secrets in the Supabase
        dashboard under Project Settings → Vault.
      </p>
      <EmptyState
        icon="settings"
        title="No secret references registered"
        body="Secret references are added here after provisioning the actual value in Supabase Vault."
      />
    </div>
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("workspace");

  return (
    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
      <h1 className="text-sm font-medium text-paper">Settings</h1>

      {/* Tab nav */}
      <div className="flex items-center gap-1 border-b border-line pb-0 -mb-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-xs transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? "text-paper border-teal"
                : "text-paper-3 border-transparent hover:text-paper"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-ink-200 border border-line rounded-[10px] overflow-hidden">
        {tab === "workspace"    && <WorkspaceTab />}
        {tab === "users"        && <UsersTab />}
        {tab === "integrations" && <IntegrationsTab />}
        {tab === "secrets"      && <SecretsTab />}
      </div>
    </div>
  );
}
