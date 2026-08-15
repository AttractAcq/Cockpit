import {
  callAnthropicWithTools,
  hasAnthropicKey,
  isAiEnabled,
  type AnthropicContentBlock,
  type AnthropicMessageParam,
  type AnthropicToolParam,
} from "../anthropic.ts";

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

export interface AssociationResearchProviderResult {
  provider: "anthropic";
  model: string;
  providerRequestId: string;
  output: AssociationModuleOutput;
  sources: RetrievedWebSource[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    web_search_calls: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  rawPayloadHash: string;
  retrievedAt: string;
  transcript: AgentTurnRecord[];
}

/** Result of the search-only phase — a plain-text research brief plus sources, no structured module. */
export interface AssociationSearchPhaseResult {
  provider: "anthropic";
  model: string;
  providerRequestId: string;
  notes: string;
  sources: RetrievedWebSource[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    web_search_calls: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  rawPayloadHash: string;
  retrievedAt: string;
  transcript: AgentTurnRecord[];
}

export function normaliseAssociationAuthorityRecordKey(
  value: string,
  allowedKeys: Iterable<string>,
): string | null {
  const allowed = new Set(allowedKeys);
  const candidate = value.trim();
  if (allowed.has(candidate)) return candidate;
  const slashIndex = candidate.lastIndexOf("/");
  if (slashIndex < 0) return null;
  const unqualified = candidate.slice(slashIndex + 1).trim();
  return allowed.has(unqualified) ? unqualified : null;
}

const ASSOCIATION_MODULE_SCHEMA = {
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
          title: { type: "string", minLength: 15 },
          summary: { type: "string", minLength: 25 },
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
            minItems: 1,
            items: {
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

// Kept low, matching Competitor OS: Anthropic executes web_search calls
// sequentially server-side within one turn, and each one adds real wall-clock
// time toward Supabase's ~150s per-invocation ceiling. Association OS's hard
// requirement is Context + Avatar OS only (Market OS and Competitor OS are
// optional enrichment, attached when available — see run-association-os's
// AssociationAuthority field comments), but with all of it attached this can
// still be the heaviest single prompt of any Intelligence agent, so search
// budget is kept tight and modules that need more evidence get it across
// additional turns instead, each with its own fresh time budget.
const WEB_SEARCH_TOOL: AnthropicToolParam = { type: "web_search_20260209", name: "web_search", max_uses: 1 };

const SUBMIT_MODULE_TOOL: AnthropicToolParam = {
  name: "submit_module",
  description:
    "Submit your final structured research for this module. Call this only once, when you have done enough " +
    "research and are confident in your findings. This ends your turn — no further research happens after this call.",
  input_schema: ASSOCIATION_MODULE_SCHEMA as unknown as Record<string, unknown>,
  strict: true,
};

const MAX_AGENT_TURNS = 4;
// Same platform ceiling and same tuning rationale as Competitor OS (see that
// provider's equivalent comment): Supabase's Edge Function "request idle
// timeout" is a hard ~150s per HTTP request. These leave real buffer for
// run-association-os's own DB reads/writes around each call.
const AGENT_WALL_CLOCK_BUDGET_MS = 138_000;
const PER_TURN_TIMEOUT_MS = 135_000;

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

/** Pulls {url, title} pairs out of a web_search_tool_result block. A failed search has an object (not array) content. */
function extractWebSearchResultSources(block: AnthropicContentBlock): RetrievedWebSource[] {
  if (block.type !== "web_search_tool_result") return [];
  const content = (block as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const out: RetrievedWebSource[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const url = normaliseUrl(String((item as { url?: unknown }).url ?? ""));
    if (!url) continue;
    const rawTitle = (item as { title?: unknown }).title;
    out.push({ url, title: compactWhitespace(typeof rawTitle === "string" && rawTitle ? rawTitle : new URL(url).hostname) });
  }
  return out;
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

// Defensive backstop against degenerate submissions: the tool schema's
// minLength constraints are the primary defense, but "strict" tool-use
// enforcement of string-content constraints (as opposed to types/enums/
// required) isn't something to fully rely on — confirmed live on Competitor
// OS that under conciseness pressure the model can otherwise satisfy
// minItems:1 with throwaway single-word or identifier-style content that is
// schema-valid but useless. Caught here so the step fails cleanly and
// retries with real content instead of silently persisting junk.
const PLACEHOLDER_TOKENS = new Set([
  "sample", "placeholder", "n/a", "na", "none", "unused", "tbd", "todo",
  "n", "unknown", "removed", "empty", "stub", "filler", "test", "xxx",
  "not used", "not applicable", "no data", "no data available", "not researched",
  "no information", "unavailable", "not available", "n a", "not relevant",
  "no content", "not found", "no findings", "nothing found", "not provided",
]);

// Real research prose is always multiple space-separated words; a single
// underscore/hyphen-joined token or identifier-looking string never is,
// regardless of length or novelty — confirmed live on Competitor OS this
// structural check catches unanticipated junk an exact-phrase blocklist
// can't (the model invented "duplicate_placeholder_remove", never listed).
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

function validateModuleOutput(raw: unknown, expectedModuleKey: string): AssociationModuleOutput {
  const candidate = raw as Partial<AssociationModuleOutput> | null;
  if (!candidate || typeof candidate !== "object") {
    throw new Error(`submit_module was called with a non-object input: ${compactWhitespace(JSON.stringify(raw)).slice(0, 700)}`);
  }
  if (!Array.isArray(candidate.records)) {
    throw new Error(
      `submit_module output has an invalid records collection (records: ${typeof candidate.records}). Raw input: ${compactWhitespace(JSON.stringify(raw)).slice(0, 700)}`,
    );
  }
  for (const record of candidate.records) {
    if (isPlaceholderText(record?.title) || isPlaceholderText(record?.summary)) {
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
  // echo of it is not trustworthy identity. The caller already knows which
  // module this call was for — always use that instead of rejecting on a
  // trivial mismatch.
  return { ...candidate, module_key: expectedModuleKey } as AssociationModuleOutput;
}

/**
 * Runs one Association OS research module as a bounded Claude tool-calling
 * agent loop, mirroring runCompetitorResearchAgent. Bounded by a wall-clock
 * budget so a single `step` invocation stays well under the Supabase edge
 * function timeout.
 */
export async function runAssociationResearchAgent(input: {
  module: typeof ASSOCIATION_RESEARCH_MODULES[number];
  clientName: string;
  approvedContext: string;
  approvedMarketOS: string;
  approvedAvatarOS: string;
  approvedCompetitorOS: string;
  existingAssociationModel: string;
  previousActiveAssociationOS: string;
  memoryNote?: string;
  model?: string;
  /**
   * When set, this call is the write phase of a two-phase split (see
   * runAssociationSearchPhase): web_search is withheld entirely and the
   * model must synthesize the final structured module from these
   * pre-gathered notes/sources instead of searching live. Every Association
   * OS module runs this way — combined search+write in one call repeatedly
   * exceeded Supabase's ~150s per-invocation ceiling on Competitor OS's
   * identically-shaped modules, and Association OS carries even more
   * upstream authority, so search and write always run as two separate
   * Supabase invocations, each with its own full time budget.
   */
  priorResearchNotes?: string;
  priorSources?: RetrievedWebSource[];
  /**
   * 1-indexed attempt number for this step. The write phase is capped to a
   * single Anthropic call per invocation (see maxTurns below), so recovery
   * from a truncated/degenerate submission happens as the NEXT retry
   * attempt — a fresh Supabase invocation with its own full budget —
   * instead of a second turn within one call. Passing this through lets the
   * prompt ask for a more concise (but still real) submission starting on
   * attempt 2.
   */
  attemptNumber?: number;
}): Promise<AssociationResearchProviderResult> {
  if (!isAiEnabled()) throw new Error("AI generation is not configured (AA_AI_GENERATION_ENABLED is not true).");
  if (!hasAnthropicKey()) throw new Error("ANTHROPIC_API_KEY is not configured for Association OS research.");

  const model = (input.model ?? Deno.env.get("ANTHROPIC_ASSOCIATION_RESEARCH_MODEL") ?? "claude-sonnet-5").trim();
  const hasPriorResearch = Boolean(input.priorResearchNotes);

  const system = `You are the evidence-controlled Association OS research agent for Attract Acquisition.
${hasPriorResearch
    ? "You do not have web_search on this call — a prior research phase already gathered evidence for you. Synthesize the final structured module from the research notes and sources provided below, plus the approved context. Do not invent sources beyond what was gathered."
    : "Research the associations that make approved buyer roles trust, value, doubt, avoid, or reject a brand in the approved market. Use web_search whenever external evidence is needed — you may search as many times as you need, reflecting after each search on whether you have enough evidence before deciding to search again or submit."}
Never infer or target race, ethnicity, nationality, religion, health, disability, sexuality, gender identity, political beliefs, socioeconomic vulnerability, or another protected or sensitive trait. Do not use proxies for these traits.
Do not turn cultural, geographic, demographic, or identity stereotypes into buyer truths. Weak symbolic or cultural hypotheses must be unknown, never asserted.
Never invent sources, quotations, buyer attitudes, emotional reactions, symbols, norms, certifications, authority, or strategic recommendations.
Distinguish positive, negative, ambivalent, and context-dependent polarity. Preserve variation and disagreement rather than flattening them into a universal claim.
Keep association_key and record_key stable snake_case identifiers so the same association can be matched on refresh. observed_at must be the current observation date in ISO-8601 format, not a guessed publication date.
Return atomic findings. Use asserted only when support exists. Use unknown when support is missing.
Never label a finding verified; verification is a separate database-controlled human workflow.
Source URLs in findings must be exact URLs that you actually consulted during this request.
When a finding relies on approved client context, list the exact context file number(s) in context_file_numbers.
When a finding relies on the active approved Market OS, list the exact Market OS record key(s) in market_record_keys.
When a finding relies on the active approved Avatar OS, list the exact Avatar OS record key(s) in avatar_record_keys.
When a finding relies on the active approved Competitor OS, list the exact Competitor OS record key(s) in competitor_record_keys.
applies_to_avatar_record_keys may contain only exact keys from the approved Avatar OS. An empty list means category-wide scope, not an invented universal buyer truth.
Use the Avatar OS record_key value alone. Never prefix it with record_type, buyer_role_system/, or any other path.
The association_map module establishes canonical association keys. Later modules must reuse those keys and must not silently create duplicate identities.
Describe supported associations only. Do not recommend a brand position, message, visual identity, offer, content, campaign, channel, or targeting action.
Your submit_module records array must never be empty — decompose the module objective into at least one, usually several, named records, each with at least one finding. If a sub-topic is genuinely unresearchable, still create a record for it with a single finding whose disposition is "unknown" and rationale explains why. An empty records array is always wrong and will be rejected.
Never write placeholder, filler, or stub text (e.g. "sample", "placeholder", "n/a", "none", "unused", "tbd", "not used") into any title, summary, claim, or rationale field, even under space or token pressure — a short real sentence is always correct where a placeholder token is never correct. If you are running low on output budget, shorten wording and cover fewer records with full detail rather than degrading any record to a placeholder.
If the research notes below show that the search phase gathered little or no real evidence (e.g. it reports repeated tool errors, a rate limit, or an otherwise empty result), do NOT invent findings to compensate and do NOT pad the submission with filler. Instead submit exactly one record whose association_key and record_key describe the module itself (e.g. "research_gap_this_pass"), association_kind "tension", polarity "context_dependent", and exactly one finding with disposition "unknown" whose claim and rationale are a real, specific sentence honestly explaining what could not be researched this pass and why — this is a fully valid, honest submission, not a failure to avoid.
When you are confident in your findings, call submit_module exactly once with your final structured output. Do not submit until you are done researching.`;

  const memorySection = input.memoryNote
    ? `\nNOTES FROM YOUR PREVIOUS RESEARCH RUN ON THIS MODULE (may be stale — verify, don't assume):\n${input.memoryNote}\n`
    : "";

  const researchNotesSection = input.priorResearchNotes
    ? `\nRESEARCH NOTES FROM SEARCH PHASE\n${input.priorResearchNotes}\n\nSOURCES GATHERED\n${
        (input.priorSources ?? []).map((source) => `- ${source.title}: ${source.url}`).join("\n") || "(none)"
      }\n`
    : "";

  const concisenessSection = (input.attemptNumber ?? 1) > 1
    ? "\nIMPORTANT: a previous attempt at this module was cut off by the output token limit before it finished. " +
      "This time, cover FEWER records rather than shortening any record below usefulness — every record and finding " +
      "you do include must still be a genuine, specific sentence (this schema rejects trivially short or placeholder " +
      "text). It is correct to include only your 2-4 most important, best-evidenced records this time and note the " +
      "rest as unknowns, rather than trying to fit everything and degrading to filler text. Prioritize breadth over " +
      "completeness this attempt.\n"
    : "";

  // Split the first user turn into two content blocks so the large upstream
  // authority (identical across all 6 modules of a run, and across every
  // retry of one module) can be cached separately from the small
  // per-module-varying tail — same pattern as Competitor OS.
  const stableAuthorityBlock = `CLIENT: ${input.clientName}

APPROVED CLIENT CONTEXT
${input.approvedContext}

ACTIVE APPROVED MARKET OS
${input.approvedMarketOS}

ACTIVE APPROVED AVATAR OS
${input.approvedAvatarOS}

ACTIVE APPROVED COMPETITOR OS
${input.approvedCompetitorOS}

PREVIOUS ACTIVE ASSOCIATION OS (REFRESH COMPARISON ONLY)
${input.previousActiveAssociationOS || "No previous approved Association OS exists."}`;

  const variableModuleBlock = `
MODULE KEY: ${input.module.key}
MODULE OBJECTIVE: ${input.module.focus}
${memorySection}${researchNotesSection}${concisenessSection}
ASSOCIATION MODEL BUILT SO FAR
${input.existingAssociationModel || "No prior Association OS module has completed."}

Produce a structured ${input.module.title} module. Preserve polarity and buyer-role variation, reuse canonical association identities, and record explicit unknowns instead of inventing detail. Every asserted external observation must cite at least one exact public URL. Call submit_module when ready.`;

  const messages: AnthropicMessageParam[] = [{
    role: "user",
    content: [
      { type: "text", text: stableAuthorityBlock, cache_control: { type: "ephemeral" } },
      { type: "text", text: variableModuleBlock },
    ],
  }];
  const transcript: AgentTurnRecord[] = [];
  const sourcesByUrl = new Map<string, RetrievedWebSource>((input.priorSources ?? []).map((source) => [source.url, source]));
  const tools: AnthropicToolParam[] = hasPriorResearch ? [SUBMIT_MODULE_TOOL] : [WEB_SEARCH_TOOL, SUBMIT_MODULE_TOOL];
  let webSearchCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreationInputTokens = 0;
  let totalCacheReadInputTokens = 0;
  let moduleOutput: AssociationModuleOutput | null = null;
  let providerRequestId: string | null = null;

  const startedAt = Date.now();
  let turnOrder = 0;
  // The write phase (hasPriorResearch) never has web_search, so a second
  // turn only ever happens to recover from a truncated submit_module — and
  // that recovery itself calls the model again for a full-length
  // generation. Two such calls back to back can together exceed Supabase's
  // ~150s hard kill even though each individually fits under
  // PER_TURN_TIMEOUT_MS (confirmed live on Competitor OS). Capping the
  // write phase to a single turn means one invocation only ever makes one
  // Anthropic call; a truncated or degenerate turn 1 fails fast and
  // cleanly, and the natural per-step retry (a fresh Supabase invocation)
  // tries again with the attemptNumber-aware conciseness prompt above.
  const maxTurns = hasPriorResearch ? 1 : MAX_AGENT_TURNS;

  while (turnOrder < maxTurns) {
    if (Date.now() - startedAt > AGENT_WALL_CLOCK_BUDGET_MS) {
      throw new Error("Association OS agent timed out (exceeded its wall-clock budget) before submitting a module.");
    }
    turnOrder += 1;

    const result = await callAnthropicWithTools({
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      tools,
      model,
      maxTokens: 14000,
      timeoutMs: PER_TURN_TIMEOUT_MS,
      // Research-and-report is not a task that benefits from deep reasoning;
      // disabling adaptive thinking cuts real latency on a wide-context call.
      thinking: { type: "disabled" },
    });
    if (!result.ok) {
      throw new Error(`Anthropic Association OS agent call failed (${result.code}): ${result.error}`);
    }
    providerRequestId ??= crypto.randomUUID();
    totalInputTokens += result.usage.inputTokens;
    totalOutputTokens += result.usage.outputTokens;
    totalCacheCreationInputTokens += result.usage.cacheCreationInputTokens;
    totalCacheReadInputTokens += result.usage.cacheReadInputTokens;

    let turnWebSearchCalls = 0;
    for (const block of result.content) {
      if (block.type === "server_tool_use" && (block as { name?: unknown }).name === "web_search") {
        turnWebSearchCalls += 1;
      }
      for (const source of extractWebSearchResultSources(block)) {
        sourcesByUrl.set(source.url, source);
      }
    }
    webSearchCalls += turnWebSearchCalls;

    const submitCall = findToolUse(result.content, "submit_module");
    transcript.push({
      turnOrder,
      role: "assistant",
      content: result.content,
      stopReason: result.stopReason,
      toolName: submitCall ? "submit_module" : turnWebSearchCalls > 0 ? "web_search" : null,
      toolInput: submitCall ? submitCall.input : null,
      toolOutput: turnWebSearchCalls > 0 ? { web_search_calls: turnWebSearchCalls } : null,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    messages.push({ role: "assistant", content: result.content });

    // A submit_module call cut off by the token cap is not trustworthy — the
    // tool JSON can come back with fields silently empty. Discard it and ask
    // for a shorter resubmission instead of persisting corrupted output.
    if (submitCall && result.stopReason !== "max_tokens") {
      moduleOutput = validateModuleOutput(submitCall.input, input.module.key);
      break;
    }

    // pause_turn: the model's server-side web_search loop hit its internal cap
    // mid-turn. Resend the same messages unchanged — the API detects the
    // trailing server_tool_use block and resumes automatically. No nudge.
    if (result.stopReason === "pause_turn") continue;

    if (submitCall) {
      // The prior assistant turn left a tool_use block (submitCall) unanswered —
      // Anthropic requires the very next message to carry a matching tool_result
      // or the next API call is rejected with a 400 ("tool_use ids were found
      // without tool_result blocks"). A plain text user message doesn't satisfy
      // that, so the correction must itself be a tool_result.
      messages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: submitCall.id,
          content:
            "Your last submit_module call was cut off before it finished (hit the output token limit), so it was " +
            "discarded. Call submit_module again with a more concise submission — fewer records or shorter findings " +
            "— that fits well within the limit. Do not omit records; keep them brief instead.",
          is_error: true,
        }],
      });
      continue;
    }

    // end_turn / max_tokens without calling submit_module: the model produced
    // prose instead of finishing. Nudge once per turn budget, then loop again.
    messages.push({
      role: "user",
      content:
        "You have not submitted your module yet. If you have enough evidence, call submit_module now. " +
        "Otherwise, continue researching with web_search.",
    });
  }

  if (!moduleOutput) {
    throw new Error(`Association OS agent did not submit a module within ${maxTurns} turn(s).`);
  }

  const sources = [...sourcesByUrl.values()];
  if (
    moduleOutput.records.some((record) =>
      record.findings.some((finding) => finding.disposition === "asserted" && finding.source_urls.length > 0)
    ) && sources.length === 0
  ) {
    throw new Error("Association OS agent returned sourced findings without inspectable web sources.");
  }

  const rawPayloadHash = await sha256(JSON.stringify(transcript));

  return {
    provider: "anthropic",
    model,
    providerRequestId: providerRequestId ?? crypto.randomUUID(),
    output: moduleOutput,
    sources,
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      web_search_calls: webSearchCalls,
      cache_creation_input_tokens: totalCacheCreationInputTokens,
      cache_read_input_tokens: totalCacheReadInputTokens,
    },
    rawPayloadHash,
    retrievedAt: new Date().toISOString(),
    transcript,
  };
}

const SEARCH_PHASE_MAX_TURNS = 3;
const SEARCH_PHASE_WALL_CLOCK_BUDGET_MS = 140_000;
const SEARCH_PHASE_PER_TURN_TIMEOUT_MS = 138_000;

/**
 * Search-only phase, run ahead of runAssociationResearchAgent's write phase
 * for every Association OS module. Has no submit_module tool at all, so the
 * model can only search and then write a plain-text research brief. For
 * every module after association_map, this is corpus-first: the model is
 * told the associations already discovered and is directed to run targeted,
 * subject-specific searches about THIS module's aspect of them, rather than
 * re-running broad discovery every module — confirmed live on Competitor OS
 * that the un-directed version burns search budget on redundant rediscovery
 * and contributes to hitting Anthropic's web_search rate limit sooner than
 * necessary. Persisted by the caller as its own client_research_steps row so
 * the write phase runs as a genuinely separate Supabase invocation.
 */
export async function runAssociationSearchPhase(input: {
  module: typeof ASSOCIATION_RESEARCH_MODULES[number];
  clientName: string;
  approvedContext: string;
  approvedMarketOS: string;
  approvedAvatarOS: string;
  approvedCompetitorOS: string;
  previousActiveAssociationOS: string;
  existingAssociationModel?: string;
  memoryNote?: string;
  model?: string;
}): Promise<AssociationSearchPhaseResult> {
  if (!isAiEnabled()) throw new Error("AI generation is not configured (AA_AI_GENERATION_ENABLED is not true).");
  if (!hasAnthropicKey()) throw new Error("ANTHROPIC_API_KEY is not configured for Association OS research.");

  const model = (input.model ?? Deno.env.get("ANTHROPIC_ASSOCIATION_RESEARCH_MODEL") ?? "claude-sonnet-5").trim();

  const hasExistingCorpus = Boolean(input.existingAssociationModel) && input.module.key !== "association_map";

  const system = `You are the evidence-gathering phase of the Association OS research agent for Attract Acquisition.
Your only job this call is to research the associations that make approved buyer roles trust, value, doubt, avoid, or reject a brand in the approved market using web_search, then write a plain-text research brief — not a final structured registry. A second pass will turn your brief into the structured module.
Never infer or target race, ethnicity, nationality, religion, health, disability, sexuality, gender identity, political beliefs, socioeconomic vulnerability, or another protected or sensitive trait. Do not use proxies for these traits.
Do not turn cultural, geographic, demographic, or identity stereotypes into buyer truths. Weak symbolic or cultural hypotheses must be reported as unknown, never asserted as fact.
${hasExistingCorpus
    ? "A prior module has already discovered and named this client's canonical association set — see ASSOCIATION MODEL BUILT SO FAR below. Do NOT re-run broad discovery searches for new associations; that work is done. Instead, run targeted, subject-specific queries about this module's objective for the SPECIFIC named associations already on file. Only search for a new, previously unlisted association if evidence you encounter while doing targeted searches strongly and unambiguously points to one — that should be the rare exception, not where you start."
    : "Search broadly enough to surface several real, evidence-backed positive and negative associations relevant to the approved buyer roles and market."}
When you have gathered enough evidence (or are confident none exists), stop calling web_search and write a concise plain-text brief: for each association found, give its name, a one-line description, its likely polarity (positive/negative/ambivalent/context_dependent), and the exact source URL(s) that support it. Note explicit unknowns rather than guessing.`;

  const memorySection = input.memoryNote
    ? `\nNOTES FROM YOUR PREVIOUS RESEARCH RUN ON THIS MODULE (may be stale — verify, don't assume):\n${input.memoryNote}\n`
    : "";

  const existingModelSection = input.existingAssociationModel
    ? `\nASSOCIATION MODEL BUILT SO FAR (reuse these canonical association identities where the same one comes up again${hasExistingCorpus ? " — this is your search target list, not just a naming reference" : ""})\n${input.existingAssociationModel}\n`
    : "";

  const variableModuleBlock = `
MODULE KEY: ${input.module.key}
MODULE OBJECTIVE: ${input.module.focus}
${memorySection}${existingModelSection}
${hasExistingCorpus
    ? "Gather evidence now with web_search — targeted queries about the named associations above, for this module's specific objective — then write your plain-text research brief."
    : "Gather evidence now with web_search, then write your plain-text research brief."}`;

  const stableAuthorityBlock = `CLIENT: ${input.clientName}

APPROVED CLIENT CONTEXT
${input.approvedContext}

ACTIVE APPROVED MARKET OS
${input.approvedMarketOS}

ACTIVE APPROVED AVATAR OS
${input.approvedAvatarOS}

ACTIVE APPROVED COMPETITOR OS
${input.approvedCompetitorOS}

PREVIOUS ACTIVE ASSOCIATION OS (REFRESH COMPARISON ONLY)
${input.previousActiveAssociationOS || "No previous approved Association OS exists."}`;

  const messages: AnthropicMessageParam[] = [{
    role: "user",
    content: [
      { type: "text", text: stableAuthorityBlock, cache_control: { type: "ephemeral" } },
      { type: "text", text: variableModuleBlock },
    ],
  }];
  const transcript: AgentTurnRecord[] = [];
  const sourcesByUrl = new Map<string, RetrievedWebSource>();
  let webSearchCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreationInputTokens = 0;
  let totalCacheReadInputTokens = 0;
  let notes: string | null = null;
  let providerRequestId: string | null = null;

  const startedAt = Date.now();
  let turnOrder = 0;

  while (turnOrder < SEARCH_PHASE_MAX_TURNS) {
    if (Date.now() - startedAt > SEARCH_PHASE_WALL_CLOCK_BUDGET_MS) break;
    turnOrder += 1;

    const result = await callAnthropicWithTools({
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      tools: [WEB_SEARCH_TOOL],
      model,
      maxTokens: 4000,
      timeoutMs: SEARCH_PHASE_PER_TURN_TIMEOUT_MS,
      thinking: { type: "disabled" },
    });
    if (!result.ok) {
      throw new Error(`Anthropic Association OS search phase call failed (${result.code}): ${result.error}`);
    }
    providerRequestId ??= crypto.randomUUID();
    totalInputTokens += result.usage.inputTokens;
    totalOutputTokens += result.usage.outputTokens;
    totalCacheCreationInputTokens += result.usage.cacheCreationInputTokens;
    totalCacheReadInputTokens += result.usage.cacheReadInputTokens;

    let turnWebSearchCalls = 0;
    for (const block of result.content) {
      if (block.type === "server_tool_use" && (block as { name?: unknown }).name === "web_search") {
        turnWebSearchCalls += 1;
      }
      for (const source of extractWebSearchResultSources(block)) {
        sourcesByUrl.set(source.url, source);
      }
    }
    webSearchCalls += turnWebSearchCalls;

    const textBlocks = result.content.filter((block): block is { type: "text"; text: string } => block.type === "text");
    const text = textBlocks.map((block) => block.text).join("\n").trim();

    transcript.push({
      turnOrder,
      role: "assistant",
      content: result.content,
      stopReason: result.stopReason,
      toolName: turnWebSearchCalls > 0 ? "web_search" : null,
      toolInput: null,
      toolOutput: turnWebSearchCalls > 0 ? { web_search_calls: turnWebSearchCalls } : null,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    messages.push({ role: "assistant", content: result.content });

    if (result.stopReason === "pause_turn") continue;

    if (result.stopReason !== "max_tokens" && text) {
      notes = text;
      break;
    }
    if (turnWebSearchCalls === 0 && !text) break;

    messages.push({
      role: "user",
      content: "Write your plain-text research brief now, summarizing what you found (or did not find) with exact source URLs.",
    });
  }

  const sources = [...sourcesByUrl.values()];
  if (!notes) {
    notes = sources.length > 0
      ? `No written brief was produced within the turn budget. Sources gathered: ${sources.map((source) => `${source.title} (${source.url})`).join("; ")}`
      : "No research brief or sources were gathered within the turn budget.";
  }

  const rawPayloadHash = await sha256(JSON.stringify(transcript));

  return {
    provider: "anthropic",
    model,
    providerRequestId: providerRequestId ?? crypto.randomUUID(),
    notes,
    sources,
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      web_search_calls: webSearchCalls,
      cache_creation_input_tokens: totalCacheCreationInputTokens,
      cache_read_input_tokens: totalCacheReadInputTokens,
    },
    rawPayloadHash,
    retrievedAt: new Date().toISOString(),
    transcript,
  };
}
