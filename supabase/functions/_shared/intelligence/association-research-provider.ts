export const ASSOCIATION_CORE_MODULES = [
  {
    key: "association_map",
    title: "Positive and negative association map",
    focus: "Discover the supported positive, negative, ambivalent, and context-dependent meanings that shape buyer trust, value, doubt, avoidance, or rejection. Establish canonical association identities.",
  },
  {
    key: "trust_credibility_signals",
    title: "Trust and credibility signals",
    focus: "Map observable trust signals, credibility markers, reassurance cues, quality indicators, risk reducers, and signals that weaken confidence.",
  },
  {
    key: "proof_authority_ecosystem",
    title: "Proof and authority ecosystem",
    focus: "Map proof forms and authority signals, including relevant standards, certifications, bodies, publications, events, advisers, gatekeepers, and peer validation where they shape credibility.",
  },
  {
    key: "emotional_symbolic_language_cues",
    title: "Emotional, symbolic, and language cues",
    focus: "Identify supported emotional meanings, symbols, language cues, category conventions, and rejection cues without converting weak cultural hypotheses into buyer facts.",
  },
  {
    key: "role_segment_variation",
    title: "Buyer-role and segment variation",
    focus: "Map where supported associations strengthen, weaken, reverse, or vary across approved buyer roles and commercially relevant market segments.",
  },
  {
    key: "tensions_cautions_unknowns",
    title: "Tensions, cautions, and unknowns",
    focus: "Synthesize conflicting signals, association tensions, evidence limitations, unsafe inference risks, contradictions, and material unknowns without recommending brand action.",
  },
] as const;

export const ASSOCIATION_RESEARCH_MODULES = ASSOCIATION_CORE_MODULES;

export type AssociationPolarity = "positive" | "negative" | "ambivalent" | "context_dependent";
export type AssociationKind =
  | "trust_signal"
  | "credibility_marker"
  | "proof_form"
  | "authority_signal"
  | "emotional_cue"
  | "symbolic_cue"
  | "language_cue"
  | "category_norm"
  | "avoidance_signal"
  | "tension";

export interface AssociationModuleFinding {
  claim: string;
  disposition: "asserted" | "unknown" | "not_relevant";
  confidence: "strongly_inferred" | "weakly_inferred" | "modelled" | null;
  rationale: string;
  source_urls: string[];
  context_file_numbers: number[];
  market_record_keys: string[];
  avatar_record_keys: string[];
  competitor_record_keys: string[];
}

export interface AssociationModuleRecord {
  record_key: string;
  association_key: string;
  polarity: AssociationPolarity;
  association_kind: AssociationKind;
  scope: string;
  applies_to_avatar_record_keys: string[];
  observed_at: string;
  title: string;
  summary: string;
  details: Array<{ label: string; value: string }>;
  findings: AssociationModuleFinding[];
}

export interface AssociationModuleOutput {
  module_key: string;
  summary: string;
  records: AssociationModuleRecord[];
  unknowns: string[];
  contradictions: string[];
}

export interface RetrievedWebSource {
  url: string;
  title: string;
}

export interface AssociationResearchProviderResult {
  provider: "openai";
  model: string;
  providerRequestId: string;
  output: AssociationModuleOutput;
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

const ASSOCIATION_MODULE_SCHEMA = {
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
          association_key: { type: "string" },
          polarity: {
            type: "string",
            enum: ["positive", "negative", "ambivalent", "context_dependent"],
          },
          association_kind: {
            type: "string",
            enum: ["trust_signal", "credibility_marker", "proof_form", "authority_signal", "emotional_cue", "symbolic_cue", "language_cue", "category_norm", "avoidance_signal", "tension"],
          },
          scope: { type: "string" },
          applies_to_avatar_record_keys: { type: "array", items: { type: "string" } },
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
                competitor_record_keys: { type: "array", items: { type: "string" } },
              },
              required: ["claim", "disposition", "confidence", "rationale", "source_urls", "context_file_numbers", "market_record_keys", "avatar_record_keys", "competitor_record_keys"],
              additionalProperties: false,
            },
          },
        },
        required: ["record_key", "association_key", "polarity", "association_kind", "scope", "applies_to_avatar_record_keys", "observed_at", "title", "summary", "details", "findings"],
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

export function extractAssociationResearchSources(payload: OpenAIResponsePayload): RetrievedWebSource[] {
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

export function parseAssociationModuleOutput(payload: OpenAIResponsePayload, expectedModuleKey: string): AssociationModuleOutput {
  const message = (payload.output ?? []).find((item) => item.type === "message");
  const outputText = message?.content?.find((content) => content.type === "output_text")?.text;
  if (!outputText) throw new Error("OpenAI returned no structured Association OS output.");
  let parsed: AssociationModuleOutput;
  try {
    parsed = JSON.parse(outputText) as AssociationModuleOutput;
  } catch {
    throw new Error("OpenAI returned invalid JSON for the Association OS module.");
  }
  if (parsed.module_key !== expectedModuleKey || !Array.isArray(parsed.records)) {
    throw new Error("OpenAI returned an Association OS module with an invalid identity or record collection.");
  }
  return parsed;
}

export async function runOpenAiAssociationResearch(input: {
  module: typeof ASSOCIATION_RESEARCH_MODULES[number];
  clientName: string;
  approvedContext: string;
  approvedMarketOS: string;
  approvedAvatarOS: string;
  approvedCompetitorOS: string;
  existingAssociationModel: string;
  previousActiveAssociationOS: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<AssociationResearchProviderResult> {
  const apiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured for Association OS research.");
  const model = input.model ?? (Deno.env.get("OPENAI_ASSOCIATION_RESEARCH_MODEL") ?? "gpt-5.6-terra").trim();
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
        content: `You are the evidence-controlled Association OS research adapter for Attract Acquisition.
Research the associations that make approved buyer roles trust, value, doubt, avoid, or reject a brand in the approved market. Use web search when current external evidence is needed.
Never infer or target race, ethnicity, nationality, religion, health, disability, sexuality, gender identity, political beliefs, socioeconomic vulnerability, or another protected or sensitive trait. Do not use proxies for these traits.
Do not turn cultural, geographic, demographic, or identity stereotypes into buyer truths. Weak symbolic or cultural hypotheses must be unknown, never asserted.
Never invent sources, quotations, buyer attitudes, emotional reactions, symbols, norms, certifications, authority, or strategic recommendations.
Distinguish positive, negative, ambivalent, and context-dependent polarity. Preserve variation and disagreement rather than flattening them into a universal claim.
Keep association_key and record_key stable snake_case identifiers so the same association can be matched on refresh. observed_at must be the current observation date in ISO-8601 format.
Return atomic findings. Use asserted only when support exists. Use unknown when support is missing.
Never label a finding verified; verification is a separate database-controlled human workflow.
Source URLs in findings must be exact URLs that you actually consulted during this request.
When a finding relies on approved client context, list the exact context file number(s) in context_file_numbers.
When a finding relies on the active approved Market OS, list the exact Market OS record key(s) in market_record_keys.
When a finding relies on the active approved Avatar OS, list the exact Avatar OS record key(s) in avatar_record_keys.
When a finding relies on the active approved Competitor OS, list the exact Competitor OS record key(s) in competitor_record_keys.
applies_to_avatar_record_keys may contain only exact keys from the approved Avatar OS. An empty list means category-wide scope, not an invented universal buyer truth.
The association_map module establishes canonical association keys. Later modules must reuse those keys and must not silently create duplicate identities.
Describe supported associations only. Do not recommend a brand position, message, visual identity, offer, content, campaign, channel, or targeting action.`,
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

ACTIVE APPROVED COMPETITOR OS
${input.approvedCompetitorOS}

PREVIOUS ACTIVE ASSOCIATION OS (REFRESH COMPARISON ONLY)
${input.previousActiveAssociationOS || "No previous approved Association OS exists."}

ASSOCIATION MODEL BUILT SO FAR
${input.existingAssociationModel || "No prior Association OS module has completed."}

Produce a structured ${input.module.title} module. Preserve polarity and buyer-role variation, reuse canonical association identities, and record explicit unknowns instead of inventing detail. Every asserted external observation must cite at least one exact public URL.`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "association_os_module",
        description: "Evidence-backed structured output for one Association OS research module.",
        strict: true,
        schema: ASSOCIATION_MODULE_SCHEMA,
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
    throw new Error(`OpenAI Association OS research failed (HTTP ${response.status}): ${payload.error?.message ?? "unknown provider error"}`);
  }
  if (payload.status === "incomplete") {
    throw new Error(`OpenAI Association OS research was incomplete: ${payload.incomplete_details?.reason ?? "unknown reason"}`);
  }

  const output = parseAssociationModuleOutput(payload, input.module.key);
  const sources = extractAssociationResearchSources(payload);
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
