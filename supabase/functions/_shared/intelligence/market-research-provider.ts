export const MARKET_RESEARCH_MODULES = [
  {
    key: "market_definition",
    title: "Market definition and boundaries",
    focus: "Define the commercial market unit, category boundaries, geography, adjacent categories, and what is explicitly outside scope.",
  },
  {
    key: "commercial_structure",
    title: "Commercial structure",
    focus: "Map how value and money move through the market, relevant segments, business models, routes to market, and category economics.",
  },
  {
    key: "demand_and_buying",
    title: "Demand and buying dynamics",
    focus: "Research demand drivers, buying mechanisms, timing, constraints, trends, and category-level purchasing dynamics without creating personas.",
  },
  {
    key: "regulation_and_constraints",
    title: "Regulation and structural constraints",
    focus: "Identify material regulations, standards, structural forces, barriers, and commercial risks that shape this market.",
  },
  {
    key: "market_size_and_reach",
    title: "Market size and reach",
    focus: "Find defensible market size, count, value, growth, and reach indicators. Preserve geography, period, units, formula assumptions, sensitivity, and uncertainty. Do not confuse obtainable market with media-reachable audience.",
  },
] as const;

export interface MarketModuleFinding {
  claim: string;
  disposition: "asserted" | "unknown" | "not_relevant";
  confidence: "strongly_inferred" | "weakly_inferred" | "modelled" | null;
  rationale: string;
  source_urls: string[];
  context_file_numbers: number[];
}

export interface MarketModuleRecord {
  record_key: string;
  title: string;
  summary: string;
  details: Array<{ label: string; value: string }>;
  findings: MarketModuleFinding[];
}

export interface MarketModuleOutput {
  module_key: string;
  summary: string;
  records: MarketModuleRecord[];
  unknowns: string[];
  contradictions: string[];
}

export interface RetrievedWebSource {
  url: string;
  title: string;
}

export interface MarketResearchProviderResult {
  provider: "openai";
  model: string;
  providerRequestId: string;
  output: MarketModuleOutput;
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

const MARKET_MODULE_SCHEMA = {
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
              },
              required: ["claim", "disposition", "confidence", "rationale", "source_urls", "context_file_numbers"],
              additionalProperties: false,
            },
          },
        },
        required: ["record_key", "title", "summary", "details", "findings"],
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

export function extractMarketResearchSources(payload: OpenAIResponsePayload): RetrievedWebSource[] {
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

export function parseMarketModuleOutput(payload: OpenAIResponsePayload, expectedModuleKey: string): MarketModuleOutput {
  const message = (payload.output ?? []).find((item) => item.type === "message");
  const outputText = message?.content?.find((content) => content.type === "output_text")?.text;
  if (!outputText) throw new Error("OpenAI returned no structured Market OS output.");
  let parsed: MarketModuleOutput;
  try {
    parsed = JSON.parse(outputText) as MarketModuleOutput;
  } catch {
    throw new Error("OpenAI returned invalid JSON for the Market OS module.");
  }
  if (parsed.module_key !== expectedModuleKey || !Array.isArray(parsed.records)) {
    throw new Error("OpenAI returned a Market OS module with an invalid identity or record collection.");
  }
  return parsed;
}

export async function runOpenAiMarketResearch(input: {
  module: typeof MARKET_RESEARCH_MODULES[number];
  clientName: string;
  approvedContext: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<MarketResearchProviderResult> {
  const apiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured for Market OS research.");
  const model = input.model ?? (Deno.env.get("OPENAI_MARKET_RESEARCH_MODEL") ?? "gpt-5.6-terra").trim();
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
        content: `You are the evidence-controlled Market OS research adapter for Attract Acquisition.
Research objective facts about the client's commercial environment. Use web search whenever external evidence is needed.
Never invent sources, quotations, figures, business facts, demographics, or strategic recommendations.
Return atomic findings. Use asserted only when support exists. Use unknown when support is missing.
Never label a finding verified; verification is a separate database-controlled human workflow.
Source URLs in findings must be exact URLs that you actually consulted during this request.
When a finding relies on approved client context, list the exact context file number(s) in context_file_numbers.
This module describes reality only. Do not recommend positioning, content, offers, campaigns, or channels.`,
      },
      {
        role: "user",
        content: `CLIENT: ${input.clientName}
MODULE KEY: ${input.module.key}
MODULE OBJECTIVE: ${input.module.focus}

APPROVED CLIENT CONTEXT
${input.approvedContext}

Produce a structured ${input.module.title} module. Preserve geography, time period, units, assumptions, uncertainty, contradictions, and explicit unknowns. Keep record keys stable snake_case identifiers.`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "market_os_module",
        description: "Evidence-backed structured output for one Market OS research module.",
        strict: true,
        schema: MARKET_MODULE_SCHEMA,
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
    throw new Error(`OpenAI Market OS research failed (HTTP ${response.status}): ${payload.error?.message ?? "unknown provider error"}`);
  }
  if (payload.status === "incomplete") {
    throw new Error(`OpenAI Market OS research was incomplete: ${payload.incomplete_details?.reason ?? "unknown reason"}`);
  }

  const output = parseMarketModuleOutput(payload, input.module.key);
  const sources = extractMarketResearchSources(payload);
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
