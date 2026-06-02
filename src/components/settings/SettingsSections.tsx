import { Avatar, Button, Icon, Panel, StatusDot, Tag } from "@/components/primitives";
import type { SettingsSection } from "./SettingsNav";

interface IntegrationStatus {
  name: string;
  status: "connected" | "idle" | "disconnected";
  detail: string;
}

const INTEGRATIONS: IntegrationStatus[] = [
  {
    name: "Supabase",
    status: "connected",
    detail: "project ayfidvycgqorxmlczyxl · realtime on",
  },
  { name: "Meta Business", status: "connected", detail: "2 ad accounts linked" },
  { name: "360dialog (WhatsApp)", status: "connected", detail: "BSP webhook configured" },
  { name: "Instagram Graph", status: "connected", detail: "DM read + send enabled" },
  { name: "n8n", status: "idle", detail: "self-hosted, Docker · idle" },
  { name: "Apify", status: "connected", detail: "Google Maps scraper scheduled 03:00" },
  { name: "Anthropic API", status: "connected", detail: "Claude Sonnet 4 default" },
  { name: "OpenClaw", status: "connected", detail: "GPT-4.1 mini on Telegram transport" },
];

const TEAM = [
  { name: "Alex Anderson", role: "admin", email: "alex@attractacquisition.co.za", initials: "AA" },
  {
    name: "VA — Distribution",
    role: "distribution",
    email: "open seat",
    initials: "VA",
  },
];

interface SettingsSectionsProps {
  section: SettingsSection;
}

export function SettingsSections({ section }: SettingsSectionsProps) {
  return (
    <div className="flex-1 overflow-y-auto px-5 py-5 max-w-[820px]">
      {section === "profile" && <ProfileSection />}
      {section === "team" && <TeamSection />}
      {section === "brand" && <BrandSection />}
      {section === "integrations" && <IntegrationsSection />}
      {section === "billing" && <BillingSection />}
      {section === "advanced" && <AdvancedSection />}
    </div>
  );
}

function ProfileSection() {
  return (
    <div className="flex flex-col gap-5">
      <SectionTitle title="Profile" />
      <Panel title="Account">
        <div className="px-4 py-4 flex items-center gap-4">
          <Avatar initials="AA" size="lg" />
          <div className="flex-1 min-w-0">
            <div className="text-lg text-paper font-medium">Alex Anderson</div>
            <div className="text-xs text-paper-3 font-mono mt-1">
              alex@attractacquisition.co.za
            </div>
            <div className="text-xs text-paper-3 mt-0.5">
              Founder & Managing Director
            </div>
          </div>
          <Button variant="secondary" size="sm">Edit</Button>
        </div>
      </Panel>

      <Panel title="Preferences">
        <div className="divide-y divide-line">
          <Row label="Timezone" value="Africa/Johannesburg (SAST · UTC+2)" />
          <Row label="Currency" value="ZAR (R)" />
          <Row label="Notifications" value="Triage items + flagged campaigns" />
          <Row label="Theme" value="Dark (always)" />
        </div>
      </Panel>
    </div>
  );
}

function TeamSection() {
  return (
    <div className="flex flex-col gap-5">
      <SectionTitle title="Team" action={<Button variant="primary" size="sm">Invite member</Button>} />
      <Panel title="Members" meta={`${TEAM.length} total`}>
        {TEAM.map((m, i) => (
          <div
            key={m.email}
            className={`px-4 py-3 flex items-center gap-3 ${
              i < TEAM.length - 1 ? "border-b border-line" : ""
            }`}
          >
            <Avatar initials={m.initials} size="md" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-paper">{m.name}</div>
              <div className="text-xs text-paper-3 font-mono mt-0.5">{m.email}</div>
            </div>
            <Tag kind={m.role === "admin" ? "approve" : "muted"}>{m.role}</Tag>
            <Button variant="subtle" size="sm">
              <Icon name="more" size={13} />
            </Button>
          </div>
        ))}
      </Panel>
    </div>
  );
}

function BrandSection() {
  return (
    <div className="flex flex-col gap-5">
      <SectionTitle title="Brand" />
      <Panel title="Colors">
        <div className="px-4 py-4 grid grid-cols-4 gap-3">
          <Swatch label="Ink" hex="#07100E" />
          <Swatch label="Teal" hex="#00E5C3" />
          <Swatch label="Paper" hex="#F2EFE6" />
          <Swatch label="Warn" hex="#F2C14E" />
        </div>
      </Panel>
      <Panel title="Typography">
        <div className="px-4 py-4 flex flex-col gap-3">
          <TypeRow family="DM Serif Display" sample="Aa — Numbers + display" />
          <TypeRow family="DM Sans" sample="The quick brown fox jumps over" />
          <TypeRow family="DM Mono" sample="ID · timestamp · code" />
        </div>
      </Panel>
      <Panel title="Voice">
        <div className="px-4 py-4 text-sm text-paper-2 leading-relaxed">
          Lead with outcomes. Avoid jargon. Use proof rather than claims. Keep tone
          direct, opinionated, mobile-friendly. Always close with the next concrete
          action.
        </div>
      </Panel>
    </div>
  );
}

function IntegrationsSection() {
  return (
    <div className="flex flex-col gap-5">
      <SectionTitle title="Integrations" />
      <Panel title="Connected services" meta="8 total · Supabase Vault for credentials">
        {INTEGRATIONS.map((i, idx) => (
          <div
            key={i.name}
            className={`px-4 py-3 flex items-center gap-3 ${
              idx < INTEGRATIONS.length - 1 ? "border-b border-line" : ""
            }`}
          >
            <StatusDot
              status={
                i.status === "connected" ? "live" : i.status === "idle" ? "idle" : "error"
              }
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-paper">{i.name}</div>
              <div className="text-2xs text-paper-3 font-mono mt-0.5">{i.detail}</div>
            </div>
            <Button variant="subtle" size="sm">Configure</Button>
          </div>
        ))}
      </Panel>
    </div>
  );
}

function BillingSection() {
  return (
    <div className="flex flex-col gap-5">
      <SectionTitle title="Billing" />
      <Panel title="Subscription">
        <div className="px-4 py-4 flex items-center gap-4">
          <div className="flex-1">
            <div className="text-sm text-paper">AA Internal · Self-hosted</div>
            <div className="text-xs text-paper-3 mt-1">
              Production date · 01 October 2026
            </div>
          </div>
          <Tag kind="approve">Active</Tag>
        </div>
      </Panel>
    </div>
  );
}

function AdvancedSection() {
  return (
    <div className="flex flex-col gap-5">
      <SectionTitle title="Advanced" />
      <Panel title="API access">
        <div className="px-4 py-3 divide-y divide-line">
          <Row label="API key" value="sk_aa_•••••••••••••••" />
          <Row label="Webhook URL" value="https://aa-cockpit.app/v1/webhooks" />
        </div>
      </Panel>
      <Panel title="Danger zone">
        <div className="px-4 py-4 text-xs text-paper-3">
          Destructive actions live here. Available after backend wiring (Phase 2).
        </div>
      </Panel>
    </div>
  );
}

/* ─────────────────────── helpers ─────────────────────── */

function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="font-serif text-2xl text-paper">{title}</h1>
      {action}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-xs text-paper-3 uppercase tracking-cap">{label}</span>
      <span className="text-sm text-paper font-mono">{value}</span>
    </div>
  );
}

function Swatch({ label, hex }: { label: string; hex: string }) {
  return (
    <div className="border border-line rounded-md overflow-hidden">
      <div className="h-12" style={{ background: hex }} />
      <div className="px-2 py-1.5 bg-ink-100 text-xs">
        <div className="text-paper">{label}</div>
        <div className="text-paper-3 font-mono text-2xs">{hex}</div>
      </div>
    </div>
  );
}

function TypeRow({ family, sample }: { family: string; sample: string }) {
  const className =
    family === "DM Serif Display"
      ? "font-serif text-3xl"
      : family === "DM Mono"
        ? "font-mono text-base"
        : "font-sans text-base";
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3 last:border-0 last:pb-0">
      <div className="text-xs text-paper-3 font-mono w-32 flex-shrink-0">{family}</div>
      <div className={`text-paper flex-1 ${className}`}>{sample}</div>
    </div>
  );
}
