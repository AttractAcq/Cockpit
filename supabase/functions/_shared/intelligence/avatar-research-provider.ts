export const AVATAR_CORE_MODULES = [
  {
    key: "buyer_role_system",
    title: "Buyer role system",
    focus: "Identify the material buying roles, their responsibilities, authority, influence, relationships, conflicts, and how the buying group reaches a decision. Distinguish roles from fictional personas.",
  },
  {
    key: "outcomes_triggers_timing",
    title: "Outcomes, triggers, and timing",
    focus: "Model desired outcomes, success measures, problem awareness, triggering events, urgency, timing, and reasons to delay or do nothing for each supported role.",
  },
  {
    key: "decision_tradeoffs_risk",
    title: "Decision criteria, trade-offs, and risk",
    focus: "Map decision criteria, trade-offs, objections, perceived risks, switching costs, and disqualifiers by buying role without prescribing strategy.",
  },
  {
    key: "trust_proof_credibility",
    title: "Trust, proof, and credibility",
    focus: "Establish the trust signals, proof expectations, credibility markers, and validation behaviours that materially affect each role's confidence.",
  },
  {
    key: "information_language_attention",
    title: "Information, language, and attention",
    focus: "Research how supported roles seek information, describe the problem, evaluate claims, and use relevant sources or attention channels. Record language only when evidenced.",
  },
] as const;

export const AVATAR_CONDITIONAL_MODULES = [
  {
    key: "multi_role_governance",
    title: "Multi-role governance",
    focus: "Deepen the buying-committee model where several roles share, block, delegate, or escalate authority across a material decision.",
  },
  {
    key: "procurement_and_compliance",
    title: "Procurement and compliance",
    focus: "Research formal procurement, legal, finance, security, regulatory, or compliance gates only where the approved market and role evidence makes them relevant.",
  },
  {
    key: "referral_and_gatekeeper",
    title: "Referrers and gatekeepers",
    focus: "Model referrers, intermediaries, access gatekeepers, and trusted advisers only where they materially shape access, shortlisting, or approval.",
  },
  {
    key: "high_consideration_risk",
    title: "High-consideration risk",
    focus: "Deepen risk, reassurance, consensus, and proof requirements where purchase stakes, duration, irreversibility, or reputational exposure are materially high.",
  },
] as const;

export const AVATAR_RESEARCH_MODULES = [...AVATAR_CORE_MODULES, ...AVATAR_CONDITIONAL_MODULES] as const;
export type AvatarConditionalModuleKey = typeof AVATAR_CONDITIONAL_MODULES[number]["key"];

export interface AvatarModuleFinding {
  claim: string;
  disposition: "asserted" | "unknown" | "not_relevant";
  confidence: "strongly_inferred" | "weakly_inferred" | "modelled" | null;
  rationale: string;
  source_urls: string[];
  context_file_numbers: number[];
  market_record_keys: string[];
}

export interface AvatarModuleRecord {
  record_key: string;
  title: string;
  summary: string;
  details: Array<{ label: string; value: string }>;
  findings: AvatarModuleFinding[];
}

export interface AvatarModuleOutput {
  module_key: string;
  summary: string;
  records: AvatarModuleRecord[];
  unknowns: string[];
  contradictions: string[];
  conditional_module_keys: AvatarConditionalModuleKey[];
}

export interface RetrievedWebSource {
  url: string;
  title: string;
}

export interface AvatarResearchProviderResult {
  provider: "openai";
  model: string;
  providerRequestId: string;
  output: AvatarModuleOutput;
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

const AVATAR_MODULE_SCHEMA = {
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
                market_record_keys: { type: "array", items: { type: "string" } },
              },
              required: ["claim", "disposition", "confidence", "rationale", "source_urls", "context_file_numbers", "market_record_keys"],
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
    conditional_module_keys: {
      type: "array",
      items: {
        type: "string",
        enum: ["multi_role_governance", "procurement_and_compliance", "referral_and_gatekeeper", "high_consideration_risk"],
      },
    },
  },
  required: ["module_key", "summary", "records", "unknowns", "contradictions", "conditional_module_keys"],
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

export function extractAvatarResearchSources(payload: OpenAIResponsePayload): RetrievedWebSource[] {
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

export function parseAvatarModuleOutput(payload: OpenAIResponsePayload, expectedModuleKey: string): AvatarModuleOutput {
  const message = (payload.output ?? []).find((item) => item.type === "message");
  const outputText = message?.content?.find((content) => content.type === "output_text")?.text;
  if (!outputText) throw new Error("OpenAI returned no structured Avatar OS output.");
  let parsed: AvatarModuleOutput;
  try {
    parsed = JSON.parse(outputText) as AvatarModuleOutput;
  } catch {
    throw new Error("OpenAI returned invalid JSON for the Avatar OS module.");
  }
  if (parsed.module_key !== expectedModuleKey || !Array.isArray(parsed.records)) {
    throw new Error("OpenAI returned a Avatar OS module with an invalid identity or record collection.");
  }
  return parsed;
}

export async function runOpenAiAvatarResearch(input: {
  module: typeof AVATAR_RESEARCH_MODULES[number];
  clientName: string;
  approvedContext: string;
  approvedMarketOS: string;
  existingAvatarModel: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<AvatarResearchProviderResult> {
  const apiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured for Avatar OS research.");
  const model = input.model ?? (Deno.env.get("OPENAI_AVATAR_RESEARCH_MODEL") ?? "gpt-5.6-terra").trim();
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
        content: `You are the evidence-controlled Avatar OS research adapter for Attract Acquisition.
Research actual buying roles and commercially relevant decision behaviour inside the approved market. Use web search whenever external evidence is needed.
Never invent sources, quotations, personal biographies, demographic precision, sensitive traits, cultural conclusions, or strategic recommendations.
Do not infer race, ethnicity, religion, health, disability, sexuality, political beliefs, or other sensitive traits. Do not use stereotypes as evidence.
Model buying roles, responsibilities, authority, triggers, criteria, risk, trust, and behaviour—not decorative personas.
Return atomic findings. Use asserted only when support exists. Use unknown when support is missing.
Never label a finding verified; verification is a separate database-controlled human workflow.
Source URLs in findings must be exact URLs that you actually consulted during this request.
When a finding relies on approved client context, list the exact context file number(s) in context_file_numbers.
When a finding relies on the active approved Market OS, list the exact Market OS record key(s) in market_record_keys.
Only the buyer_role_system module may select conditional_module_keys. Other modules must return an empty list.
Select a conditional module only when the approved Market OS or supported role evidence demonstrates that it is materially relevant.
This module describes supported buyer reality only. Do not recommend positioning, brand, messaging, content, offers, campaigns, or channels.`,
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

AVATAR MODEL BUILT SO FAR
${input.existingAvatarModel || "No prior Avatar OS module has completed."}

Produce a structured ${input.module.title} module. Separate every material buying role, preserve supported variation and disagreement, and record explicit unknowns instead of inventing detail. Keep record keys stable snake_case identifiers.`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "avatar_os_module",
        description: "Evidence-backed structured output for one Avatar OS research module.",
        strict: true,
        schema: AVATAR_MODULE_SCHEMA,
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
    throw new Error(`OpenAI Avatar OS research failed (HTTP ${response.status}): ${payload.error?.message ?? "unknown provider error"}`);
  }
  if (payload.status === "incomplete") {
    throw new Error(`OpenAI Avatar OS research was incomplete: ${payload.incomplete_details?.reason ?? "unknown reason"}`);
  }

  const output = parseAvatarModuleOutput(payload, input.module.key);
  const sources = extractAvatarResearchSources(payload);
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
