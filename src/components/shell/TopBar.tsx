import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon, Kbd, type IconName } from "@/components/primitives";
import { api } from "@/lib/api";
import { fmtDateLong } from "@/lib/format";
import { NAV_ITEMS, ROUTES } from "@/lib/constants";
import type { Asset, Campaign, Conversation, Entity, PulseMetric } from "@/types";

type SearchResult = {
  id: string;
  kind: "Entity" | "Conversation" | "Campaign" | "Asset";
  title: string;
  subtitle: string;
  path: string;
  icon: IconName;
  haystack: string;
};

function normalize(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function buildSearchResults(args: {
  entities: Entity[];
  conversations: Conversation[];
  campaigns: Campaign[];
  assets: Asset[];
}): SearchResult[] {
  const entityResults = args.entities.map((entity) => ({
    id: `entity-${entity.id}`,
    kind: "Entity" as const,
    title: entity.business_name,
    subtitle: [entity.kind, entity.stage, entity.niche, entity.city].filter(Boolean).join(" · "),
    path: ROUTES.entity(entity.id),
    icon: "users" as const,
    haystack: [
      entity.business_name,
      entity.kind,
      entity.stage,
      entity.niche,
      entity.city,
      entity.contact_name,
      entity.email,
      entity.whatsapp_number,
    ].map(normalize).join(" "),
  }));

  const conversationResults = args.conversations.map((conversation) => ({
    id: `conversation-${conversation.id}`,
    kind: "Conversation" as const,
    title: conversation.entity_name || conversation.subject || "Conversation",
    subtitle: [conversation.channel, conversation.last_message_preview].filter(Boolean).join(" · "),
    path: ROUTES.conversation(conversation.id),
    icon: "chat" as const,
    haystack: [
      conversation.entity_name,
      conversation.subject,
      conversation.channel,
      conversation.last_message_preview,
    ].map(normalize).join(" "),
  }));

  const campaignResults = args.campaigns.map((campaign) => ({
    id: `campaign-${campaign.id}`,
    kind: "Campaign" as const,
    title: campaign.name,
    subtitle: [campaign.status, campaign.entity_name, campaign.objective].filter(Boolean).join(" · "),
    path: ROUTES.campaign(campaign.id),
    icon: "campaign" as const,
    haystack: [
      campaign.name,
      campaign.status,
      campaign.entity_name,
      campaign.objective,
      campaign.meta_campaign_id,
    ].map(normalize).join(" "),
  }));

  const assetResults = args.assets.map((asset) => ({
    id: `asset-${asset.id}`,
    kind: "Asset" as const,
    title: asset.title,
    subtitle: [asset.kind, asset.entity_name, asset.file_name].filter(Boolean).join(" · "),
    path: ROUTES.studio,
    icon: "library" as const,
    haystack: [
      asset.title,
      asset.kind,
      asset.entity_name,
      asset.file_name,
      asset.description,
      ...(asset.tags ?? []),
    ].map(normalize).join(" "),
  }));

  return [...entityResults, ...conversationResults, ...campaignResults, ...assetResults];
}

export function TopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const [vitals, setVitals] = useState<PulseMetric[]>([]);
  const [vitalsError, setVitalsError] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const [searchIndex, setSearchIndex] = useState<SearchResult[]>([]);

  useEffect(() => {
    api.pulse.metrics()
      .then((m) => {
        setVitals(m.slice(0, 4));
        setVitalsError(false);
      })
      .catch(() => {
        setVitals([]);
        setVitalsError(true);
      });
  }, []);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        setSearchOpen(true);
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    let cancelled = false;

    setSearchLoading(true);
    setSearchError(false);

    Promise.all([
      api.entities.list(),
      api.conversations.list(),
      api.campaigns.list(),
      api.assets.list(),
    ])
      .then(([entities, conversations, campaigns, assets]) => {
        if (cancelled) return;
        setSearchIndex(buildSearchResults({
          entities: entities as Entity[],
          conversations: conversations as Conversation[],
          campaigns: campaigns as Campaign[],
          assets: assets as Asset[],
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setSearchIndex([]);
        setSearchError(true);
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // derive crumb from current path
  const navItem = NAV_ITEMS.find((n) => location.pathname.startsWith(n.path));
  const crumbLabel =
    navItem?.label ?? (location.pathname.startsWith(ROUTES.settings) ? "Settings" : "");
  const crumbIcon = navItem?.icon ?? "settings";

  const today = fmtDateLong(new Date().toISOString());
  const trimmedQuery = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!trimmedQuery) return [];
    return searchIndex
      .filter((result) => result.haystack.includes(trimmedQuery))
      .slice(0, 8);
  }, [searchIndex, trimmedQuery]);

  useEffect(() => {
    setActiveResult(0);
  }, [trimmedQuery]);

  function chooseResult(result: SearchResult) {
    setQuery("");
    setSearchOpen(false);
    navigate(result.path);
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setSearchOpen(false);
      searchRef.current?.blur();
      return;
    }

    if (!searchOpen) setSearchOpen(true);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveResult((current) => Math.min(current + 1, Math.max(results.length - 1, 0)));
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveResult((current) => Math.max(current - 1, 0));
    }

    if (event.key === "Enter" && results[activeResult]) {
      event.preventDefault();
      chooseResult(results[activeResult]);
    }
  }

  return (
    <header className="h-12 border-b border-line flex items-center px-4 gap-4 flex-shrink-0">
      {/* Crumb */}
      <div className="flex items-center gap-2 text-xs text-paper-2">
        <span className="text-paper-3">
          <Icon name={crumbIcon} size={13} />
        </span>
        <b className="text-paper font-medium">{crumbLabel}</b>
        <span className="text-paper-3">/</span>
        <span>{today}</span>
      </div>

      {/* Search */}
      <div className="relative flex-1 max-w-[460px] ml-2">
        <div className="flex items-center gap-2 bg-ink-200 border border-line rounded-lg px-2.5 py-1.5 text-paper-3 text-xs focus-within:border-line-2 focus-within:bg-ink-100 transition-colors">
          <Icon name="search" size={13} />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search prospects, clients, ads, files..."
            className="min-w-0 flex-1 bg-transparent text-xs text-paper outline-none placeholder:text-paper-3"
          />
          <span className="ml-auto">
            <Kbd>⌘K</Kbd>
          </span>
        </div>

        {searchOpen && (query || searchLoading || searchError) && (
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[360px] overflow-y-auto rounded-lg border border-line bg-ink-200 shadow-2xl">
            {searchLoading && (
              <div className="px-3 py-2.5 text-xs text-paper-3">Loading search...</div>
            )}

            {!searchLoading && searchError && (
              <div className="px-3 py-2.5 text-xs text-neg">Search unavailable</div>
            )}

            {!searchLoading && !searchError && trimmedQuery && results.length === 0 && (
              <div className="px-3 py-2.5 text-xs text-paper-3">No results for “{query}”</div>
            )}

            {!searchLoading && !searchError && results.map((result, index) => (
              <button
                key={result.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseResult(result)}
                onMouseEnter={() => setActiveResult(index)}
                className={`w-full px-3 py-2.5 flex items-center gap-2.5 text-left border-b border-line last:border-b-0 ${
                  index === activeResult ? "bg-ink-100" : "hover:bg-ink-100"
                }`}
              >
                <span className="h-7 w-7 flex-shrink-0 grid place-items-center rounded-md bg-ink border border-line text-paper-2">
                  <Icon name={result.icon} size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-paper">{result.title}</span>
                  <span className="block truncate text-2xs text-paper-3">{result.kind} · {result.subtitle}</span>
                </span>
                <Icon name="arrow-right" size={12} className="text-paper-3" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Vitals */}
      <div className="flex ml-auto items-center">
        {vitalsError && (
          <div className="px-3.5 border-l border-line text-2xs text-neg font-mono">
            vitals unavailable
          </div>
        )}
        {vitals.map((v, i) => {
          const isLast = i === vitals.length - 1;
          const deltaColor =
            v.trend === "flat"
              ? "text-paper-3"
              : v.trend_is_good
                ? "text-teal"
                : "text-warn";
          return (
            <div
              key={`${v.key}-${i}`}
              className={`px-3.5 border-l border-line flex flex-col leading-tight ${isLast ? "border-r" : ""}`}
            >
              <span className="text-[9.5px] uppercase tracking-cap text-paper-3">
                {v.label}
              </span>
              <span className="font-serif text-[15px] text-paper mt-0.5">
                {v.display_value}
              </span>
              <span className={`text-2xs mt-px ${deltaColor}`}>
                {v.delta_display} {v.delta_label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Icon buttons */}
      <div className="flex gap-1 ml-2">
        <button className="w-[30px] h-[30px] grid place-items-center text-paper-2 rounded-md hover:bg-ink-200 hover:text-paper transition-colors relative">
          <Icon name="bell" size={13} />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-teal rounded-full border-2 border-ink" />
        </button>
        <button className="w-[30px] h-[30px] grid place-items-center text-paper-2 rounded-md hover:bg-ink-200 hover:text-paper transition-colors">
          <Icon name="plus" size={13} />
        </button>
      </div>
    </header>
  );
}
