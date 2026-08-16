import {
  callAnthropicWithTools,
  hasAnthropicKey,
  isAiEnabled,
  type AnthropicContentBlock,
  type AnthropicMessageParam,
  type AnthropicToolParam,
} from "../anthropic.ts";

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

/** One recorded turn of the agent loop, for the client_agent_turns audit trail. */
export interface AgentTurnRecord {
  turnOrder: number;
  role: "assistant" | "user";
  content: unknown;
  stopReason: string | null;
  toolName: string | null;
  toolInput: unknown;
  toolOutput: unknown;
  inputTokens: number;
  outputTokens: number;
}

export interface BrandStrategistProviderResult {
  provider: "anthropic";
  model: string;
  providerRequestId: string;
  output: BrandStrategistModuleOutput;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  rawPayloadHash: string;
  retrievedAt: string;
  transcript: AgentTurnRecord[];
}

const FINDING_SCHEMA = {
  type: "object",
  properties: {
    claim: { type: "string", minLength: 20 },
    disposition: { type: "string", enum: ["asserted", "unknown", "not_relevant"] },
    confidence: {
      anyOf: [
        { type: "string", enum: ["strongly_inferred", "weakly_inferred", "modelled"] },
        { type: "null" },
      ],
    },
    rationale: { type: "string", minLength: 20 },
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
    summary: { type: "string", minLength: 30 },
    records: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          record_key: { type: "string" },
          record_kind: { type: "string", enum: ["implication", "opportunity", "risk", "tension", "recommendation"] },
          recommendation_type: { type: "string", enum: ["synthesis", "brand", "positioning", "offer", "proof", "trust_building", "content", "distribution", "risk_mitigation"] },
          priority: { type: "string", enum: ["now", "next", "later", "monitor"] },
          title: { type: "string", minLength: 15 },
          statement: { type: "string", minLength: 25 },
          rationale: { type: "string", minLength: 20 },
          expected_impact: { type: "string", minLength: 15 },
          dependencies: { type: "array", items: { type: "string" } },
          risks: { type: "array", items: { type: "string" } },
          trade_offs: { type: "array", items: { type: "string" } },
          contradictions: { type: "array", items: { type: "string" } },
          buyer_role_keys: { type: "array", items: { type: "string" } },
          market_condition_keys: { type: "array", items: { type: "string" } },
          downstream_owner: { type: "string", enum: ["brand_system", "offer_system", "content_system", "distribution_system", "sales_system", "human_decision", "experiment_design"] },
          proposed_next_action: { type: "string", minLength: 20 },
          validation_needed: { anyOf: [{ type: "string" }, { type: "null" }] },
          findings: { type: "array", minItems: 1, items: FINDING_SCHEMA },
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

const SUBMIT_MODULE_TOOL: AnthropicToolParam = {
  name: "submit_module",
  description:
    "Submit your final structured synthesis for this module. Call this only once, when you are confident in " +
    "your output. This ends your turn — no further reasoning happens after this call.",
  input_schema: BRAND_STRATEGIST_MODULE_SCHEMA as unknown as Record<string, unknown>,
  strict: true,
};

// Brand Strategist has no web_search tool at all — it's pure synthesis over
// already-approved upstream authority (Context + Market + Avatar +
// Competitor + Association), never new research. That removes the
// web_search-rate-limit exposure that dominated Competitor/Association OS's
// debugging this session, but this is still the heaviest single context of
// any Intelligence agent (all four upstream OSes plus Context, none
// optional — unlike Association OS, corroboration across domains is this
// domain's whole mechanism, so nothing here is downgradable to enrichment).
// Confirmed on Competitor OS that a second same-invocation call to recover
// from a truncated/degenerate submission can itself exceed Supabase's
// ~150s ceiling when stacked with a first attempt, so this is capped to one
// Anthropic call per invocation like Competitor/Association's write phase;
// recovery happens on the next retry (a fresh invocation with its own
// budget) via the attemptNumber-aware conciseness prompt below.
const MAX_TURNS = 1;
const PER_TURN_TIMEOUT_MS = 135_000;

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function findToolUse(content: AnthropicContentBlock[], name: string): { id: string; input: unknown } | null {
  for (const block of content) {
    if (block.type === "tool_use" && (block as { name?: unknown }).name === name) {
      const tu = block as { id: string; input: unknown };
      return { id: tu.id, input: tu.input };
    }
  }
  return null;
}

// Defensive backstop against degenerate submissions, same rationale and
// implementation as the other Intelligence providers (see
// competitor-research-provider.ts's isPlaceholderText for the live incident
// that motivated this). Brand Strategist's strict traceability rules
// (every record needs a real finding, every recommendation needs two-domain
// corroboration — enforced downstream in run-brand-strategist/index.ts)
// already make placeholder content harder to sneak past than on the other
// domains, but this is cheap, consistent insurance against a novel junk
// pattern that traceability alone wouldn't happen to catch.
const PLACEHOLDER_TOKENS = new Set([
  "sample", "placeholder", "n/a", "na", "none", "unused", "tbd", "todo",
  "n", "unknown", "removed", "empty", "stub", "filler", "test", "xxx",
  "not used", "not applicable", "no data", "no data available", "not researched",
  "no information", "unavailable", "not available", "n a", "not relevant",
  "no content", "not found", "no findings", "nothing found", "not provided",
]);

function isPlaceholderText(value: unknown): boolean {
  if (typeof value !== "string") return true;
  const trimmed = value.trim();
  const normalised = trimmed.toLowerCase().replace(/[.!?]+$/, "");
  if (normalised.length < 20) return true;
  if (PLACEHOLDER_TOKENS.has(normalised)) return true;
  if (!/\s/.test(trimmed)) return true;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 4) return true;
  return false;
}

function validateModuleOutput(raw: unknown, expectedModuleKey: string): BrandStrategistModuleOutput {
  const candidate = raw as Partial<BrandStrategistModuleOutput> | null;
  if (!candidate || typeof candidate !== "object") {
    throw new Error(`submit_module was called with a non-object input: ${compactWhitespace(JSON.stringify(raw)).slice(0, 700)}`);
  }
  if (!Array.isArray(candidate.records)) {
    throw new Error(
      `submit_module output has an invalid records collection (records: ${typeof candidate.records}). Raw input: ${compactWhitespace(JSON.stringify(raw)).slice(0, 700)}`,
    );
  }
  for (const record of candidate.records) {
    if (isPlaceholderText(record?.title) || isPlaceholderText(record?.statement)) {
      throw new Error(
        `submit_module returned a placeholder/degenerate record instead of real content (record_key: ${compactWhitespace(String(record?.record_key ?? "?"))}).`,
      );
    }
    for (const finding of record?.findings ?? []) {
      if (isPlaceholderText(finding?.claim) || isPlaceholderText(finding?.rationale)) {
        throw new Error(
          `submit_module returned a placeholder/degenerate finding instead of real content (record_key: ${compactWhitespace(String(record?.record_key ?? "?"))}).`,
        );
      }
    }
  }
  // module_key has no enum constraint in the tool schema, so the model's own
  // echo of it is not trustworthy identity — the caller already knows which
  // module this call was for.
  return { ...candidate, module_key: expectedModuleKey } as BrandStrategistModuleOutput;
}

/**
 * Runs one Brand Strategist synthesis module as a single bounded Claude
 * tool-calling call — no web_search, so there is no multi-turn research
 * loop the way the other Intelligence agents have. Bounded by
 * PER_TURN_TIMEOUT_MS so a single `step` invocation stays well under the
 * Supabase edge function timeout.
 */
export async function runBrandStrategistSynthesisAgent(input: {
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
  memoryNote?: string;
  model?: string;
  /**
   * 1-indexed attempt number for this step. Recovery from a truncated or
   * degenerate submission happens as the NEXT retry attempt — a fresh
   * Supabase invocation with its own full budget — instead of a second
   * turn within one call (see the MAX_TURNS comment above). Passing this
   * through lets the prompt ask for a more concise (but still real)
   * submission starting on attempt 2.
   */
  attemptNumber?: number;
}): Promise<BrandStrategistProviderResult> {
  if (!isAiEnabled()) throw new Error("AI generation is not configured (AA_AI_GENERATION_ENABLED is not true).");
  if (!hasAnthropicKey()) throw new Error("ANTHROPIC_API_KEY is not configured for Brand Strategist synthesis.");

  const model = (input.model ?? Deno.env.get("ANTHROPIC_BRAND_STRATEGIST_MODEL") ?? "claude-sonnet-5").trim();

  const system = `You are Attract Acquisition's evidence-controlled Brand Strategist synthesis agent.
Use only the approved Context and active approved Market, Avatar, Competitor, and Association OS material supplied in this request. Do not conduct new research or introduce outside facts — you have no search tool on this call, by design.
Every material record must contain at least one atomic supporting finding. Every asserted finding must name exact upstream Context file numbers or OS record keys. Prefer the bare record_key exactly as shown in brackets; do not prefix it with the record_type.
Every recommendation must be supported by at least two distinct approved OS domains. If support is insufficient, emit an implication, risk, tension, or explicit unknown instead of a recommendation.
Do not invent results, impact metrics, buyer facts, proof, market conditions, or certainty. expected_impact must be qualitative unless an approved upstream record provides a defensible number.
Disclose contradictions, uncertainty, dependencies, risks, and trade-offs. Never hide disagreement to make a recommendation sound decisive.
Recommendations are proposals for human approval. They are not approved experiments, completed work, instructions to mutate an upstream OS, or authorization to change Context, offers, content, calendars, campaigns, or distribution rules.
proposed_next_action must describe a bounded handoff or human decision. validation_needed must remain separate from execution.
Keep stable snake_case record keys. Do not duplicate recommendations already present in the strategy built so far.
The cross_os_synthesis module produces implications, opportunities, risks, and tensions — not recommendation records.
The strategic_recommendations module produces recommendation records only.
The recommendation_portfolio module produces recommendation records only and may consolidate earlier recommendations without changing their evidence basis.
Never write placeholder, filler, or stub text (e.g. "sample", "placeholder", "n/a", "none", "unused", "tbd", "not used") into any title, statement, rationale, expected_impact, or finding field, even under space or token pressure — a short real sentence is always correct where a placeholder token is never correct. If you are running low on output budget, shorten wording and cover fewer records with full detail rather than degrading any record to a placeholder.
Your submit_module records array must never be empty — decompose the module objective into at least one, usually several, records, each with at least one finding.
When you are confident in your output, call submit_module exactly once with your final structured module.`;

  const concisenessSection = (input.attemptNumber ?? 1) > 1
    ? "\nIMPORTANT: a previous attempt at this module was cut off by the output token limit before it finished. " +
      "This time, cover FEWER records rather than shortening any record below usefulness — every record and finding " +
      "you do include must still be a genuine, specific sentence (this schema rejects trivially short or placeholder " +
      "text). It is correct to include only your 2-4 most important, best-evidenced records this time and note the " +
      "rest as unknowns, rather than trying to fit everything and degrading to filler text. Prioritize breadth over " +
      "completeness this attempt.\n"
    : "";

  const memorySection = input.memoryNote
    ? `\nNOTES FROM YOUR PREVIOUS SYNTHESIS RUN ON THIS MODULE (may be stale — verify, don't assume):\n${input.memoryNote}\n`
    : "";

  // Split the first user turn so the large upstream authority (identical
  // across all 3 modules of a run, and across every retry of one module)
  // can be cached separately from the small per-module-varying tail — same
  // pattern as the other Intelligence agents.
  const stableAuthorityBlock = `CLIENT: ${input.clientName}

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
${input.previousActiveStrategy || "No previous approved Brand Strategist release exists."}`;

  const variableModuleBlock = `
MODULE KEY: ${input.module.key}
MODULE OBJECTIVE: ${input.module.focus}
${memorySection}${concisenessSection}
STRATEGY BUILT SO FAR
${input.existingStrategy || "No prior Brand Strategist module has completed."}

Produce the structured ${input.module.title} module. Use exact upstream record keys, preserve degraded-readiness warnings, and prefer explicit unknowns over unsupported decisiveness. Call submit_module when ready.`;

  const messages: AnthropicMessageParam[] = [{
    role: "user",
    content: [
      { type: "text", text: stableAuthorityBlock, cache_control: { type: "ephemeral" } },
      { type: "text", text: variableModuleBlock },
    ],
  }];
  const transcript: AgentTurnRecord[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreationInputTokens = 0;
  let totalCacheReadInputTokens = 0;
  let moduleOutput: BrandStrategistModuleOutput | null = null;
  let providerRequestId: string | null = null;

  let turnOrder = 0;

  while (turnOrder < MAX_TURNS) {
    turnOrder += 1;

    const result = await callAnthropicWithTools({
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      tools: [SUBMIT_MODULE_TOOL],
      model,
      maxTokens: 14000,
      timeoutMs: PER_TURN_TIMEOUT_MS,
      // Synthesis is not a task that benefits from adaptive "thinking" mode
      // reasoning tokens on top of the reasoning already baked into the
      // prompt; disabling it cuts real latency on a wide-context call.
      thinking: { type: "disabled" },
    });
    if (!result.ok) {
      throw new Error(`Anthropic Brand Strategist agent call failed (${result.code}): ${result.error}`);
    }
    providerRequestId ??= crypto.randomUUID();
    totalInputTokens += result.usage.inputTokens;
    totalOutputTokens += result.usage.outputTokens;
    totalCacheCreationInputTokens += result.usage.cacheCreationInputTokens;
    totalCacheReadInputTokens += result.usage.cacheReadInputTokens;

    const submitCall = findToolUse(result.content, "submit_module");
    transcript.push({
      turnOrder,
      role: "assistant",
      content: result.content,
      stopReason: result.stopReason,
      toolName: submitCall ? "submit_module" : null,
      toolInput: submitCall ? submitCall.input : null,
      toolOutput: null,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    messages.push({ role: "assistant", content: result.content });

    // A submit_module call cut off by the token cap is not trustworthy — the
    // tool JSON can come back with fields silently empty. Discard it rather
    // than persisting corrupted output; the next retry attempt (fresh
    // invocation) gets the conciseness prompt above.
    if (submitCall && result.stopReason !== "max_tokens") {
      moduleOutput = validateModuleOutput(submitCall.input, input.module.key);
    }
    break;
  }

  if (!moduleOutput) {
    throw new Error(`Brand Strategist agent did not submit a module within ${MAX_TURNS} turn(s).`);
  }

  const rawPayloadHash = await sha256(JSON.stringify(transcript));

  return {
    provider: "anthropic",
    model,
    providerRequestId: providerRequestId ?? crypto.randomUUID(),
    output: moduleOutput,
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      cache_creation_input_tokens: totalCacheCreationInputTokens,
      cache_read_input_tokens: totalCacheReadInputTokens,
    },
    rawPayloadHash,
    retrievedAt: new Date().toISOString(),
    transcript,
  };
}
