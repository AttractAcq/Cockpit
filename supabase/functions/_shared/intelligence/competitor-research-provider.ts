export const COMPETITOR_CORE_MODULES = [
  {
    key: "alternative_registry",
    title: "Alternative registry",
    focus: "Discover and classify the choices buyers can actually make: direct and indirect competitors, substitutes, internal or in-house approaches, delay, do-nothing, and clearly distinguished reference brands.",
  },
  {
    key: "positioning_category_map",
    title: "Positioning and category map",
    focus: "Map observable category language, buyer-facing positioning, declared audience, problem framing, differentiators, and the client's supported current place in the landscape.",
  },
  {
    key: "offer_commercial_observations",
    title: "Offer and commercial observations",
    focus: "Capture publicly observable offer structures, service models, packaging, pricing signals, guarantees, entry points, and commercial mechanisms without guessing unavailable terms.",
  },
  {
    key: "messaging_claims",
    title: "Messaging and claims",
    focus: "Capture paraphrased themes, claims, problem language, promised outcomes, calls to action, and repeated message patterns with exact public-source provenance.",
  },
  {
    key: "proof_trust",
    title: "Proof and trust observations",
    focus: "Observe public proof forms, credibility markers, certifications, case-study patterns, risk reducers, and trust mechanisms without validating claims beyond the evidence.",
  },
  {
    key: "distribution_attention",
    title: "Distribution and attention observations",
    focus: "Observe discoverability, public channels, publishing patterns, partnerships, events, communities, and attention references while distinguishing distribution presence from effectiveness.",
  },
  {
    key: "landscape_patterns",
    title: "Competitive landscape patterns",
    focus: "Synthesize evidence-backed market-wide similarities, differences, clusters, gaps, contradictions, and changes. Describe the system without ranking winners or prescribing a response.",
  },
] as const;

export const COMPETITOR_RESEARCH_MODULES = COMPETITOR_CORE_MODULES;

export type CompetitorAlternativeType =
  | "direct"
  | "indirect"
  | "substitute"
  | "internal"
  | "do_nothing"
  | "reference_brand"
  | "client"
  | "market_pattern";

export interface CompetitorModuleFinding {
  claim: string;
  disposition: "asserted" | "unknown" | "not_relevant";
  confidence: "strongly_inferred" | "weakly_inferred" | "modelled" | null;
  rationale: string;
  source_urls: string[];
  context_file_numbers: number[];
  market_record_keys: string[];
  avatar_record_keys: string[];
}

export interface CompetitorModuleRecord {
  record_key: string;
  subject_key: string;
  alternative_type: CompetitorAlternativeType;
  observation_kind: string;
  observed_at: string;
  title: string;
  summary: string;
  details: Array<{ label: string; value: string }>;
  findings: CompetitorModuleFinding[];
}

export interface CompetitorModuleOutput {
  module_key: string;
  summary: string;
  records: CompetitorModuleRecord[];
  unknowns: string[];
  contradictions: string[];
}

export interface RetrievedWebSource {
  url: string;
  title: string;
}

export interface CompetitorResearchProviderResult {
  provider: "openai";
  model: string;
  providerRequestId: string;
  output: CompetitorModuleOutput;
  sources: RetrievedWebSource[];
  usage: { input_tokens: number; output_tokens: number; total_tokens: number; web_search_calls: number };
  rawPayloadHash: string;
  retrievedAt: string;
}

interface OpenAIResponsePayload {
  id?: string;
  status?: string;
  error?: { message?: string };
  incomplete_details?: { reason?: string };
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  output?: Array<{
    type?: string;
    action?: {
      sources?: Array<{ url?: string; title?: string }>;
    };
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: Array<{ type?: string; url?: string; title?: string; url_citation?: { url?: string; title?: string } }>;
    }>;
  }>;
}

const COMPETITOR_MODULE_SCHEMA = {
  type: "object",
  properties: {
    module_key: { type: "string" },
    summary: { type: "string" },
    records: {
      type: "array",
      items: {
        type: "object",
        properties: {
          record_key: { type: "string" },
          subject_key: { type: "string" },
          alternative_type: {
            type: "string",
            enum: ["direct", "indirect", "substitute", "internal", "do_nothing", "reference_brand", "client", "market_pattern"],
          },
          observation_kind: { type: "string" },
          observed_at: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          details: {
            type: "array",
            items: {
              type: "object",
              properties: { label: { type: "string" }, value: { type: "string" } },
              required: ["label", "value"],
              additionalProperties: false,
            },
          },
          findings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                claim: { type: "string" },
                disposition: { type: "string", enum: ["asserted", "unknown", "not_relevant"] },
                confidence: {
                  anyOf: [
                    { type: "string", enum: ["strongly_inferred", "weakly_inferred", "modelled"] },
                    { type: "null" },
                  ],
                },
                rationale: { type: "string" },
                source_urls: { type: "array", items: { type: "string" } },
                context_file_numbers: { type: "array", items: { type: "integer" } },
                market_record_keys: { type: "array", items: { type: "string" } },
                avatar_record_keys: { type: "array", items: { type: "string" } },
              },
              required: ["claim", "disposition", "confidence", "rationale", "source_urls", "context_file_numbers", "market_record_keys", "avatar_record_keys"],
              additionalProperties: false,
            },
          },
        },
        required: ["record_key", "subject_key", "alternative_type", "observation_kind", "observed_at", "title", "summary", "details", "findings"],
        additionalProperties: false,
      },
    },
    unknowns: { type: "array", items: { type: "string" } },
    contradictions: { type: "array", items: { type: "string" } },
  },
  required: ["module_key", "summary", "records", "unknowns", "contradictions"],
  additionalProperties: false,
} as const;

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normaliseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    const normalised = url.toString();
    return normalised.length <= 2000 ? normalised : null;
  } catch {
    return null;
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function extractCompetitorResearchSources(payload: OpenAIResponsePayload): RetrievedWebSource[] {
  const byUrl = new Map<string, RetrievedWebSource>();
  for (const item of payload.output ?? []) {
    for (const source of item.action?.sources ?? []) {
      const url = normaliseUrl(source.url ?? "");
      if (!url) continue;
      byUrl.set(url, { url, title: compactWhitespace(source.title ?? new URL(url).hostname) });
    }
    for (const content of item.content ?? []) {
      for (const annotation of content.annotations ?? []) {
        const rawUrl = annotation.url ?? annotation.url_citation?.url ?? "";
        const url = normaliseUrl(rawUrl);
        if (!url) continue;
        const title = annotation.title ?? annotation.url_citation?.title ?? new URL(url).hostname;
        byUrl.set(url, { url, title: compactWhitespace(title) });
      }
    }
  }
  return [...byUrl.values()];
}

export function parseCompetitorModuleOutput(payload: OpenAIResponsePayload, expectedModuleKey: string): CompetitorModuleOutput {
  const message = (payload.output ?? []).find((item) => item.type === "message");
  const outputText = message?.content?.find((content) => content.type === "output_text")?.text;
  if (!outputText) throw new Error("OpenAI returned no structured Competitor OS output.");
  let parsed: CompetitorModuleOutput;
  try {
    parsed = JSON.parse(outputText) as CompetitorModuleOutput;
  } catch {
    throw new Error("OpenAI returned invalid JSON for the Competitor OS module.");
  }
  if (parsed.module_key !== expectedModuleKey || !Array.isArray(parsed.records)) {
    throw new Error("OpenAI returned a Competitor OS module with an invalid identity or record collection.");
  }
  return parsed;
}

export async function runOpenAiCompetitorResearch(input: {
  module: typeof COMPETITOR_RESEARCH_MODULES[number];
  clientName: string;
  approvedContext: string;
  approvedMarketOS: string;
  approvedAvatarOS: string;
  existingCompetitorModel: string;
  previousActiveCompetitorOS: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<CompetitorResearchProviderResult> {
  const apiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured for Competitor OS research.");
  const model = input.model ?? (Deno.env.get("OPENAI_COMPETITOR_RESEARCH_MODEL") ?? "gpt-5.6-terra").trim();
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = {
    model,
    reasoning: { effort: "low" },
    tools: [{ type: "web_search" }],
    tool_choice: "auto",
    include: ["web_search_call.action.sources"],
    store: false,
    max_output_tokens: 12000,
    input: [
      {
        role: "system",
        content: `You are the evidence-controlled Competitor OS research adapter for Attract Acquisition.
Research the buyer-visible competitive system inside the approved market. Use web search for current external observations.
Use only public, lawfully accessible material. Do not log in, bypass access controls, evade platform restrictions, impersonate anyone, or collect private/personal data.
Paraphrase observable facts. Do not reproduce protected creative work or substantial competitor copy. Never invent sources, quotes, prices, performance, customers, results, or strategic recommendations.
Treat direct, indirect, substitute, internal, do-nothing, client, and reference-brand records as distinct alternative types. A reference brand is not a competitor unless evidence establishes commercial substitutability.
Keep subject_key and record_key stable snake_case identifiers so the same observation can be matched on refresh. observed_at must be the current observation date in ISO-8601 format, not a guessed publication date.
Return atomic findings. Use asserted only when support exists. Use unknown when support is missing.
Never label a finding verified; verification is a separate database-controlled human workflow.
Source URLs in findings must be exact URLs that you actually consulted during this request.
When a finding relies on approved client context, list the exact context file number(s) in context_file_numbers.
When a finding relies on the active approved Market OS, list the exact Market OS record key(s) in market_record_keys.
When a finding relies on the active approved Avatar OS, list the exact Avatar OS record key(s) in avatar_record_keys.
The alternative_registry module establishes canonical subject keys. Later modules must reuse those keys and must not silently create duplicate identities.
Describe observations and system patterns only. Do not score winners, recommend a response, prescribe positioning, copy competitors, or turn evidence into strategy.`,
      },
      {
        role: "user",
        content: `CLIENT: ${input.clientName}
MODULE KEY: ${input.module.key}
MODULE OBJECTIVE: ${input.module.focus}

APPROVED CLIENT CONTEXT
${input.approvedContext}

ACTIVE APPROVED MARKET OS
${input.approvedMarketOS}

ACTIVE APPROVED AVATAR OS
${input.approvedAvatarOS}

PREVIOUS ACTIVE COMPETITOR OS (REFRESH COMPARISON ONLY)
${input.previousActiveCompetitorOS || "No previous approved Competitor OS exists."}

COMPETITOR MODEL BUILT SO FAR
${input.existingCompetitorModel || "No prior Competitor OS module has completed."}

Produce a structured ${input.module.title} module. Preserve alternative type distinctions, reuse canonical subject identities, and record explicit unknowns instead of inventing detail. Every asserted external observation must cite at least one exact public URL.`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "competitor_os_module",
        description: "Evidence-backed structured output for one Competitor OS research module.",
        strict: true,
        schema: COMPETITOR_MODULE_SCHEMA,
      },
    },
  };

  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(140_000),
  });
  const rawPayload = await response.text();
  const rawPayloadHash = await sha256(rawPayload);
  let payload: OpenAIResponsePayload;
  try {
    payload = JSON.parse(rawPayload) as OpenAIResponsePayload;
  } catch {
    throw new Error(`OpenAI returned a non-JSON response (HTTP ${response.status}).`);
  }
  if (!response.ok || payload.error) {
    throw new Error(`OpenAI Competitor OS research failed (HTTP ${response.status}): ${payload.error?.message ?? "unknown provider error"}`);
  }
  if (payload.status === "incomplete") {
    throw new Error(`OpenAI Competitor OS research was incomplete: ${payload.incomplete_details?.reason ?? "unknown reason"}`);
  }

  const output = parseCompetitorModuleOutput(payload, input.module.key);
  const sources = extractCompetitorResearchSources(payload);
  if (output.records.some((record) => record.findings.some((finding) =>
    finding.disposition === "asserted" && finding.source_urls.length > 0
  )) && sources.length === 0) {
    throw new Error("OpenAI returned sourced findings without inspectable web sources.");
  }
  const webSearchCalls = (payload.output ?? []).filter((item) => item.type === "web_search_call").length;
  return {
    provider: "openai",
    model,
    providerRequestId: payload.id ?? crypto.randomUUID(),
    output,
    sources,
    usage: {
      input_tokens: payload.usage?.input_tokens ?? 0,
      output_tokens: payload.usage?.output_tokens ?? 0,
      total_tokens: payload.usage?.total_tokens ?? 0,
      web_search_calls: webSearchCalls,
    },
    rawPayloadHash,
    retrievedAt: new Date().toISOString(),
  };
}
