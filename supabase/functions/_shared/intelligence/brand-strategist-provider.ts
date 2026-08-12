export const BRAND_STRATEGIST_MODULES = [
  {
    key: "cross_os_synthesis",
    title: "Cross-OS synthesis",
    focus: "Identify evidence-backed strategic implications, opportunities, tensions, and risks that emerge only when Market, Avatar, Competitor, and Association authority are considered together.",
  },
  {
    key: "strategic_recommendations",
    title: "Strategic recommendations",
    focus: "Turn supported implications into clear recommendations across brand, positioning, offers, proof, trust-building, content, and distribution where the approved authority warrants them.",
  },
  {
    key: "recommendation_portfolio",
    title: "Recommendation portfolio",
    focus: "Resolve overlaps, expose conflicts and dependencies, and assemble a transparent now/next/later/monitor portfolio with proposed downstream owners and validation needs.",
  },
] as const;

export type BrandStrategistRecordKind = "implication" | "opportunity" | "risk" | "tension" | "recommendation";
export type BrandStrategistRecommendationType =
  | "synthesis"
  | "brand"
  | "positioning"
  | "offer"
  | "proof"
  | "trust_building"
  | "content"
  | "distribution"
  | "risk_mitigation";
export type BrandStrategistPriority = "now" | "next" | "later" | "monitor";
export type BrandStrategistOwner =
  | "brand_system"
  | "offer_system"
  | "content_system"
  | "distribution_system"
  | "sales_system"
  | "human_decision"
  | "experiment_design";

export interface BrandStrategistFinding {
  claim: string;
  disposition: "asserted" | "unknown" | "not_relevant";
  confidence: "strongly_inferred" | "weakly_inferred" | "modelled" | null;
  rationale: string;
  context_file_numbers: number[];
  market_record_keys: string[];
  avatar_record_keys: string[];
  competitor_record_keys: string[];
  association_record_keys: string[];
}

export interface BrandStrategistRecord {
  record_key: string;
  record_kind: BrandStrategistRecordKind;
  recommendation_type: BrandStrategistRecommendationType;
  priority: BrandStrategistPriority;
  title: string;
  statement: string;
  rationale: string;
  expected_impact: string;
  dependencies: string[];
  risks: string[];
  trade_offs: string[];
  contradictions: string[];
  buyer_role_keys: string[];
  market_condition_keys: string[];
  downstream_owner: BrandStrategistOwner;
  proposed_next_action: string;
  validation_needed: string | null;
  findings: BrandStrategistFinding[];
}

export interface BrandStrategistModuleOutput {
  module_key: string;
  summary: string;
  records: BrandStrategistRecord[];
  unknowns: string[];
  contradictions: string[];
}

export interface BrandStrategistProviderResult {
  provider: "openai";
  model: string;
  providerRequestId: string;
  output: BrandStrategistModuleOutput;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
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
    content?: Array<{ type?: string; text?: string }>;
  }>;
}

const FINDING_SCHEMA = {
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
    context_file_numbers: { type: "array", items: { type: "integer" } },
    market_record_keys: { type: "array", items: { type: "string" } },
    avatar_record_keys: { type: "array", items: { type: "string" } },
    competitor_record_keys: { type: "array", items: { type: "string" } },
    association_record_keys: { type: "array", items: { type: "string" } },
  },
  required: ["claim", "disposition", "confidence", "rationale", "context_file_numbers", "market_record_keys", "avatar_record_keys", "competitor_record_keys", "association_record_keys"],
  additionalProperties: false,
} as const;

const BRAND_STRATEGIST_MODULE_SCHEMA = {
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
          record_kind: { type: "string", enum: ["implication", "opportunity", "risk", "tension", "recommendation"] },
          recommendation_type: { type: "string", enum: ["synthesis", "brand", "positioning", "offer", "proof", "trust_building", "content", "distribution", "risk_mitigation"] },
          priority: { type: "string", enum: ["now", "next", "later", "monitor"] },
          title: { type: "string" },
          statement: { type: "string" },
          rationale: { type: "string" },
          expected_impact: { type: "string" },
          dependencies: { type: "array", items: { type: "string" } },
          risks: { type: "array", items: { type: "string" } },
          trade_offs: { type: "array", items: { type: "string" } },
          contradictions: { type: "array", items: { type: "string" } },
          buyer_role_keys: { type: "array", items: { type: "string" } },
          market_condition_keys: { type: "array", items: { type: "string" } },
          downstream_owner: { type: "string", enum: ["brand_system", "offer_system", "content_system", "distribution_system", "sales_system", "human_decision", "experiment_design"] },
          proposed_next_action: { type: "string" },
          validation_needed: { anyOf: [{ type: "string" }, { type: "null" }] },
          findings: { type: "array", items: FINDING_SCHEMA },
        },
        required: ["record_key", "record_kind", "recommendation_type", "priority", "title", "statement", "rationale", "expected_impact", "dependencies", "risks", "trade_offs", "contradictions", "buyer_role_keys", "market_condition_keys", "downstream_owner", "proposed_next_action", "validation_needed", "findings"],
        additionalProperties: false,
      },
    },
    unknowns: { type: "array", items: { type: "string" } },
    contradictions: { type: "array", items: { type: "string" } },
  },
  required: ["module_key", "summary", "records", "unknowns", "contradictions"],
  additionalProperties: false,
} as const;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseBrandStrategistModuleOutput(
  payload: OpenAIResponsePayload,
  expectedModuleKey: string,
): BrandStrategistModuleOutput {
  const message = (payload.output ?? []).find((item) => item.type === "message");
  const outputText = message?.content?.find((content) => content.type === "output_text")?.text;
  if (!outputText) throw new Error("OpenAI returned no structured Brand Strategist output.");
  let parsed: BrandStrategistModuleOutput;
  try {
    parsed = JSON.parse(outputText) as BrandStrategistModuleOutput;
  } catch {
    throw new Error("OpenAI returned invalid JSON for the Brand Strategist module.");
  }
  if (parsed.module_key !== expectedModuleKey || !Array.isArray(parsed.records)) {
    throw new Error("OpenAI returned a Brand Strategist module with an invalid identity or record collection.");
  }
  return parsed;
}

export async function runOpenAiBrandStrategistSynthesis(input: {
  module: typeof BRAND_STRATEGIST_MODULES[number];
  clientName: string;
  approvedContext: string;
  approvedMarketOS: string;
  approvedAvatarOS: string;
  approvedCompetitorOS: string;
  approvedAssociationOS: string;
  authorityReadiness: string;
  existingStrategy: string;
  previousActiveStrategy: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<BrandStrategistProviderResult> {
  const apiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured for Brand Strategist synthesis.");
  const model = input.model ?? (Deno.env.get("OPENAI_BRAND_STRATEGIST_MODEL") ?? "gpt-5.6-terra").trim();
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = {
    model,
    reasoning: { effort: "medium" },
    store: false,
    max_output_tokens: 12000,
    input: [
      {
        role: "system",
        content: `You are Attract Acquisition's evidence-controlled Brand Strategist synthesis adapter.
Use only the approved Context and active approved Market, Avatar, Competitor, and Association OS material supplied in this request. Do not conduct new research or introduce outside facts.
Every material record must contain at least one atomic supporting finding. Every asserted finding must name exact upstream Context file numbers or OS record keys. Prefer the bare record_key exactly as shown in brackets; do not prefix it with the record_type.
Every recommendation must be supported by at least two distinct approved OS domains. If support is insufficient, emit an implication, risk, tension, or explicit unknown instead of a recommendation.
Do not invent results, impact metrics, buyer facts, proof, market conditions, or certainty. expected_impact must be qualitative unless an approved upstream record provides a defensible number.
Disclose contradictions, uncertainty, dependencies, risks, and trade-offs. Never hide disagreement to make a recommendation sound decisive.
Recommendations are proposals for human approval. They are not approved experiments, completed work, instructions to mutate an upstream OS, or authorization to change Context, offers, content, calendars, campaigns, or distribution rules.
proposed_next_action must describe a bounded handoff or human decision. validation_needed must remain separate from execution.
Keep stable snake_case record keys. Do not duplicate recommendations already present in the strategy built so far.
The cross_os_synthesis module produces implications, opportunities, risks, and tensions—not recommendation records.
The strategic_recommendations module produces recommendation records only.
The recommendation_portfolio module produces recommendation records only and may consolidate earlier recommendations without changing their evidence basis.`,
      },
      {
        role: "user",
        content: `CLIENT: ${input.clientName}
MODULE KEY: ${input.module.key}
MODULE OBJECTIVE: ${input.module.focus}

AUTHORITY READINESS
${input.authorityReadiness}

APPROVED CLIENT CONTEXT
${input.approvedContext}

ACTIVE APPROVED MARKET OS
${input.approvedMarketOS}

ACTIVE APPROVED AVATAR OS
${input.approvedAvatarOS}

ACTIVE APPROVED COMPETITOR OS
${input.approvedCompetitorOS}

ACTIVE APPROVED ASSOCIATION OS
${input.approvedAssociationOS}

PREVIOUS ACTIVE BRAND STRATEGIST RELEASE
${input.previousActiveStrategy || "No previous approved Brand Strategist release exists."}

STRATEGY BUILT SO FAR
${input.existingStrategy || "No prior Brand Strategist module has completed."}

Produce the structured ${input.module.title} module. Use exact upstream record keys, preserve degraded-readiness warnings, and prefer explicit unknowns over unsupported decisiveness.`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "brand_strategist_module",
        description: "Evidence-backed structured output for one Brand Strategist synthesis module.",
        strict: true,
        schema: BRAND_STRATEGIST_MODULE_SCHEMA,
      },
    },
  };

  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(105_000),
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
    throw new Error(`OpenAI Brand Strategist synthesis failed (HTTP ${response.status}): ${payload.error?.message ?? "unknown provider error"}`);
  }
  if (payload.status === "incomplete") {
    throw new Error(`OpenAI Brand Strategist synthesis was incomplete: ${payload.incomplete_details?.reason ?? "unknown reason"}`);
  }

  return {
    provider: "openai",
    model,
    providerRequestId: payload.id ?? crypto.randomUUID(),
    output: parseBrandStrategistModuleOutput(payload, input.module.key),
    usage: {
      input_tokens: payload.usage?.input_tokens ?? 0,
      output_tokens: payload.usage?.output_tokens ?? 0,
      total_tokens: payload.usage?.total_tokens ?? 0,
    },
    rawPayloadHash,
    retrievedAt: new Date().toISOString(),
  };
}
