import {
  callAnthropicWithTools,
  hasAnthropicKey,
  isAiEnabled,
  type AnthropicContentBlock,
  type AnthropicMessageParam,
  type AnthropicToolParam,
} from "../anthropic.ts";

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

export interface CompetitorResearchProviderResult {
  provider: "anthropic";
  model: string;
  providerRequestId: string;
  output: CompetitorModuleOutput;
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
export interface CompetitorSearchPhaseResult {
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

const COMPETITOR_MODULE_SCHEMA = {
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
          subject_key: { type: "string" },
          alternative_type: {
            type: "string",
            enum: ["direct", "indirect", "substitute", "internal", "do_nothing", "reference_brand", "client", "market_pattern"],
          },
          observation_kind: { type: "string" },
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

// Kept low: Anthropic executes web_search calls sequentially server-side within
// one turn, and each one adds real wall-clock time toward the ~150s hard
// ceiling Supabase imposes on a single edge function request (see the budget
// constants below). A module that needs more evidence than this gets it by
// spanning additional turns instead, each with its own fresh time budget.
// Set to 1 (same floor as Avatar OS) because Competitor OS modules carry the
// heaviest context of any Intelligence agent so far — approved Context files
// plus the full approved Market OS release, the full approved Avatar OS
// release, the previous approved Competitor OS (refresh comparison), and the
// Competitor model built so far this run.
const WEB_SEARCH_TOOL: AnthropicToolParam = { type: "web_search_20260209", name: "web_search", max_uses: 1 };

const SUBMIT_MODULE_TOOL: AnthropicToolParam = {
  name: "submit_module",
  description:
    "Submit your final structured research for this module. Call this only once, when you have done enough " +
    "research and are confident in your findings. This ends your turn — no further research happens after this call.",
  input_schema: COMPETITOR_MODULE_SCHEMA as unknown as Record<string, unknown>,
  strict: true,
};

const MAX_AGENT_TURNS = 4;
// Supabase's Edge Function "request idle timeout" is a hard 150s per HTTP
// request regardless of plan (a 400s Pro "wall clock" figure governs the
// worker process's total lifetime across many requests, not a single
// response) — so a single `step` call cannot exceed ~150s no matter what
// these are set to.
//
// Confirmed live: 145_000/147_000 (carried over from the Avatar OS
// migration) left too little room — a write-phase call that ran close to
// its 145s abort budget, plus run-competitor-os's own DB reads/writes
// around it (loadCompetitorAuthority's ~9 parallel queries, existingRecords,
// memory, the research-step lookup, then persistModule's several sequential
// inserts), together exceeded Supabase's hard 150s kill and returned a raw
// 504 instead of our own graceful, recoverable abort. Tightened to leave
// real buffer for that surrounding work.
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
// required) isn't something to fully rely on — confirmed live that under
// conciseness pressure the model can otherwise satisfy minItems:1 with
// throwaway single-word content ("sample", "placeholder", "unused", "n",
// "none") that is schema-valid but useless. Caught here so the step fails
// cleanly and retries with real content instead of silently persisting junk.
const PLACEHOLDER_TOKENS = new Set([
  "sample", "placeholder", "n/a", "na", "none", "unused", "tbd", "todo",
  "n", "unknown", "removed", "empty", "stub", "filler", "test", "xxx",
  "not used", "not applicable", "no data", "no data available", "not researched",
  "no information", "unavailable", "not available", "n a", "not relevant",
  "no content", "not found", "no findings", "nothing found", "not provided",
]);

// Confirmed live that an exact-phrase blocklist is whack-a-mole: the model
// invented "duplicate_placeholder_remove" — never in the blocklist, well
// past the length floor, but obviously not a sentence. Real research prose
// is always multiple space-separated words; a single underscore/hyphen-
// joined token or identifier-looking string never is, regardless of length
// or novelty, so that structural check catches unanticipated variants the
// exact-match list can't.
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

function validateModuleOutput(raw: unknown, expectedModuleKey: string): CompetitorModuleOutput {
  const candidate = raw as Partial<CompetitorModuleOutput> | null;
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
  // echo of it is not trustworthy identity (the same casing/wording drift
  // observed during the Market OS migration). The caller already knows which
  // module this call was for — always use that instead of rejecting on a
  // trivial mismatch.
  return { ...candidate, module_key: expectedModuleKey } as CompetitorModuleOutput;
}

/**
 * Runs one Competitor OS research module as a bounded Claude tool-calling
 * agent loop: the model researches with web_search, reflects on whether it
 * has enough evidence, searches again if not, and finishes by calling
 * submit_module with output matching the same schema the old single-shot
 * OpenAI call used to produce. Bounded by MAX_AGENT_TURNS and a wall-clock
 * budget so a single `step` invocation stays well under the Supabase edge
 * function timeout.
 */
export async function runCompetitorResearchAgent(input: {
  module: typeof COMPETITOR_RESEARCH_MODULES[number];
  clientName: string;
  approvedContext: string;
  approvedMarketOS: string;
  approvedAvatarOS: string;
  existingCompetitorModel: string;
  previousActiveCompetitorOS: string;
  memoryNote?: string;
  model?: string;
  /**
   * When set, this call is the write phase of a two-phase split (see
   * runCompetitorSearchPhase): web_search is withheld entirely and the model
   * must synthesize the final structured module from these pre-gathered
   * notes/sources instead of searching live. Every Competitor OS module runs
   * this way — combined search+write in one turn repeatedly exceeded
   * Supabase's ~150s per-invocation ceiling even after context, caching, and
   * max-tokens mitigations, and the failure was not limited to any one
   * module — so search and write always run as two separate Supabase
   * invocations, each with its own full time budget.
   */
  priorResearchNotes?: string;
  priorSources?: RetrievedWebSource[];
  /**
   * 1-indexed attempt number for this step (client_research_steps.attempt_count
   * after claim_client_research_step increments it). The write phase is capped
   * to a single Anthropic call per invocation (see maxTurns below), so the
   * "ask for a shorter resubmission" recovery that used to happen as a second
   * turn within one call now happens as the NEXT retry attempt — a fresh
   * Supabase invocation with its own full time budget — instead. Passing this
   * through lets the prompt ask for a more concise submission starting on
   * attempt 2, since attempt 1 truncating at the token cap is expected for
   * the heavier modules (e.g. alternative_registry needs ~8-10k output
   * tokens) rather than a sign of a broken run.
   */
  attemptNumber?: number;
}): Promise<CompetitorResearchProviderResult> {
  if (!isAiEnabled()) throw new Error("AI generation is not configured (AA_AI_GENERATION_ENABLED is not true).");
  if (!hasAnthropicKey()) throw new Error("ANTHROPIC_API_KEY is not configured for Competitor OS research.");

  const model = (input.model ?? Deno.env.get("ANTHROPIC_COMPETITOR_RESEARCH_MODEL") ?? "claude-sonnet-5").trim();
  const hasPriorResearch = Boolean(input.priorResearchNotes);

  const system = `You are the evidence-controlled Competitor OS research agent for Attract Acquisition.
${hasPriorResearch
    ? "You do not have web_search on this call — a prior research phase already gathered evidence for you. Synthesize the final structured module from the research notes and sources provided below, plus the approved context. Do not invent sources beyond what was gathered."
    : "Research the buyer-visible competitive system inside the approved market. Use web_search whenever external evidence is needed — you may search as many times as you need, reflecting after each search on whether you have enough evidence before deciding to search again or submit."}
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
Describe observations and system patterns only. Do not score winners, recommend a response, prescribe positioning, copy competitors, or turn evidence into strategy.
Your submit_module records array must never be empty — decompose the module objective into at least one, usually several, named records (e.g. one per alternative or sub-topic), each with at least one finding. If a sub-topic is genuinely unresearchable, still create a record for it with a single finding whose disposition is "unknown" and rationale explains why. An empty records array is always wrong and will be rejected.
Never write placeholder, filler, or stub text (e.g. "sample", "placeholder", "n/a", "none", "unused", "tbd", "not used") into any title, summary, claim, or rationale field, even under space or token pressure — a short real sentence is always correct where a placeholder token is never correct. If you are running low on output budget, shorten wording and cover fewer records with full detail rather than degrading any record to a placeholder.
If the research notes below show that the search phase gathered little or no real evidence (e.g. it reports repeated tool errors, a rate limit, or an otherwise empty result), do NOT invent findings to compensate and do NOT pad the submission with filler. Instead submit exactly one record whose subject_key and record_key describe the module itself (e.g. "research_gap_this_pass"), alternative_type "market_pattern", and exactly one finding with disposition "unknown" whose claim and rationale are a real, specific sentence honestly explaining what could not be researched this pass and why (referencing the actual reason from the notes, e.g. a web_search tool limit) — this is a fully valid, honest submission, not a failure to avoid.
When you are confident in your findings, call submit_module exactly once with your final structured output. Do not submit until you are done researching.`;

  const memorySection = input.memoryNote
    ? `\nNOTES FROM YOUR PREVIOUS RESEARCH RUN ON THIS MODULE (may be stale — verify, don't assume):\n${input.memoryNote}\n`
    : "";

  const researchNotesSection = input.priorResearchNotes
    ? `\nRESEARCH NOTES FROM SEARCH PHASE\n${input.priorResearchNotes}\n\nSOURCES GATHERED\n${
        (input.priorSources ?? []).map((source) => `- ${source.title}: ${source.url}`).join("\n") || "(none)"
      }\n`
    : "";

  // A prior attempt on this same step hit the output token cap before
  // finishing (see the attemptNumber doc comment above) — ask for a more
  // concise submission this time rather than silently retrying the exact
  // same prompt and truncating identically again.
  const concisenessSection = (input.attemptNumber ?? 1) > 1
    ? "\nIMPORTANT: a previous attempt at this module was cut off by the output token limit before it finished. " +
      "This time, cover FEWER records rather than shortening any record below usefulness — every record and finding " +
      "you do include must still be a genuine, specific sentence (this schema rejects trivially short or placeholder " +
      "text). It is correct to include only your 2-4 most important, best-evidenced records this time and note the " +
      "rest as unknowns, rather than trying to fit everything and degrading to filler text. Prioritize breadth over " +
      "completeness this attempt.\n"
    : "";

  // Split the first user turn into two content blocks so the large upstream
  // authority (identical across all 7 modules of a run, and across every
  // retry/turn of one module) can be cached separately from the small
  // per-module-varying tail. Anthropic's prompt caching is prefix-based and
  // exact-match, so the cached block must be byte-identical across calls —
  // it is built here from only the run-stable inputs (client, context files,
  // Market/Avatar authority, previous Competitor OS), never the per-module
  // module key/objective/memory/existing-model fields.
  const stableAuthorityBlock = `CLIENT: ${input.clientName}

APPROVED CLIENT CONTEXT
${input.approvedContext}

ACTIVE APPROVED MARKET OS
${input.approvedMarketOS}

ACTIVE APPROVED AVATAR OS
${input.approvedAvatarOS}

PREVIOUS ACTIVE COMPETITOR OS (REFRESH COMPARISON ONLY)
${input.previousActiveCompetitorOS || "No previous approved Competitor OS exists."}`;

  const variableModuleBlock = `
MODULE KEY: ${input.module.key}
MODULE OBJECTIVE: ${input.module.focus}
${memorySection}${researchNotesSection}${concisenessSection}
COMPETITOR MODEL BUILT SO FAR
${input.existingCompetitorModel || "No prior Competitor OS module has completed."}

Produce a structured ${input.module.title} module. Preserve alternative type distinctions, reuse canonical subject identities, and record explicit unknowns instead of inventing detail. Every asserted external observation must cite at least one exact public URL. Keep record keys stable snake_case identifiers. Call submit_module when ready.`;

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
  let moduleOutput: CompetitorModuleOutput | null = null;
  let providerRequestId: string | null = null;

  const startedAt = Date.now();
  let turnOrder = 0;
  // The write phase (hasPriorResearch) never has web_search, so a second turn
  // only ever happens to recover from a truncated submit_module — and that
  // recovery itself calls the model again for a full-length generation. Two
  // such calls back to back can together exceed Supabase's ~150s hard kill
  // even though each individually fits under PER_TURN_TIMEOUT_MS (confirmed
  // live: a truncated turn 1 followed by a real turn 2 hit a 504 idle-timeout
  // rather than our own graceful abort). Capping the write phase to a single
  // turn means one invocation only ever makes one Anthropic call; a
  // truncated or incomplete turn 1 fails fast and cleanly, and the natural
  // per-step retry (a fresh Supabase invocation with its own full budget)
  // tries again rather than compounding two long calls into one window.
  const maxTurns = hasPriorResearch ? 1 : MAX_AGENT_TURNS;

  while (turnOrder < maxTurns) {
    if (Date.now() - startedAt > AGENT_WALL_CLOCK_BUDGET_MS) {
      throw new Error("Competitor OS agent timed out (exceeded its wall-clock budget) before submitting a module.");
    }
    turnOrder += 1;
    // maxTurns caps the write phase to 1, so this per-turn timeout is the
    // real ceiling for that phase's only call. It leaves buffer under
    // Supabase's ~150s hard idle-timeout kill (see the maxTurns comment
    // above) for the surrounding DB reads/writes in run-competitor-os's
    // runStep/persistModule, which are not free.

    const result = await callAnthropicWithTools({
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      tools,
      model,
      // A 10000 cap (cut down from Market/Avatar's 16000) was originally set
      // to solve a *different* problem: two full-length calls (an initial
      // truncated attempt + a same-invocation resubmission) stacking past
      // Supabase's 150s ceiling. That's now solved structurally by capping
      // the write phase to one call per invocation (maxTurns above) with
      // recovery moved across retries instead. Left over at 10000, the cap
      // instead squeezed the heaviest modules (alternative_registry,
      // positioning_category_map) into degrading to placeholder content to
      // fit — confirmed live once the placeholder validation backstop below
      // started rejecting exactly that. Raised back up now that only one
      // call happens per invocation regardless of length; PER_TURN_TIMEOUT_MS
      // above was raised in step with it to keep real headroom.
      maxTokens: 14000,
      timeoutMs: PER_TURN_TIMEOUT_MS,
      // Research-and-report is not a task that benefits from deep reasoning;
      // disabling adaptive thinking cuts real latency on a wide-context call.
      thinking: { type: "disabled" },
    });
    if (!result.ok) {
      throw new Error(`Anthropic Competitor OS agent call failed (${result.code}): ${result.error}`);
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
    throw new Error(`Competitor OS agent did not submit a module within ${maxTurns} turn(s).`);
  }

  const sources = [...sourcesByUrl.values()];
  if (
    moduleOutput.records.some((record) =>
      record.findings.some((finding) => finding.disposition === "asserted" && finding.source_urls.length > 0)
    ) && sources.length === 0
  ) {
    throw new Error("Competitor OS agent returned sourced findings without inspectable web sources.");
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
 * Search-only phase, run ahead of runCompetitorResearchAgent's write phase
 * for every Competitor OS module. Has no submit_module tool at all, so the
 * model can only search and then write a plain-text research brief — it
 * never attempts the large structured-JSON generation that, combined with a
 * live search, repeatedly exceeded Supabase's ~150s per-invocation ceiling
 * (observed on more than one module, not just the first). Persisted by the
 * caller as its own client_research_steps row so the write phase runs as a
 * genuinely separate Supabase invocation with its own full time budget.
 */
export async function runCompetitorSearchPhase(input: {
  module: typeof COMPETITOR_RESEARCH_MODULES[number];
  clientName: string;
  approvedContext: string;
  approvedMarketOS: string;
  approvedAvatarOS: string;
  previousActiveCompetitorOS: string;
  existingCompetitorModel?: string;
  memoryNote?: string;
  model?: string;
}): Promise<CompetitorSearchPhaseResult> {
  if (!isAiEnabled()) throw new Error("AI generation is not configured (AA_AI_GENERATION_ENABLED is not true).");
  if (!hasAnthropicKey()) throw new Error("ANTHROPIC_API_KEY is not configured for Competitor OS research.");

  const model = (input.model ?? Deno.env.get("ANTHROPIC_COMPETITOR_RESEARCH_MODEL") ?? "claude-sonnet-5").trim();

  // alternative_registry is the only module that needs broad discovery — it's
  // what establishes the named competitor set in the first place. Every later
  // module was confirmed live to redundantly re-run broad "who are the
  // competitors" searches instead of targeted queries about the subjects
  // alternative_registry already found, burning search budget on
  // rediscovery and pushing this session into Anthropic's web_search rate
  // limit sooner than a gap-focused search pattern would have. Corpus-first:
  // once a competitor set exists, later modules search THAT set's specific
  // aspect for this module (pricing, proof, distribution, etc.), not the
  // market from scratch.
  const hasExistingCorpus = Boolean(input.existingCompetitorModel) && input.module.key !== "alternative_registry";

  const system = `You are the evidence-gathering phase of the Competitor OS research agent for Attract Acquisition.
Your only job this call is to research the buyer-visible competitive system inside the approved market using web_search, then write a plain-text research brief — not a final structured registry. A second pass will turn your brief into the structured module.
Use only public, lawfully accessible material. Do not log in, bypass access controls, evade platform restrictions, impersonate anyone, or collect private/personal data.
${hasExistingCorpus
    ? "A prior module has already discovered and named this client's competitive set — see COMPETITOR MODEL BUILT SO FAR below. Do NOT re-run broad discovery searches for new alternatives; that work is done. Instead, run targeted, subject-specific queries about this module's objective for the SPECIFIC named subjects already on file (e.g. \"<competitor name> pricing\", \"<competitor name> case studies\", \"<competitor name> LinkedIn\" rather than \"best agencies in this category\"). Only search for a new, previously unlisted alternative if evidence you encounter while doing targeted searches strongly and unambiguously points to one — that should be the rare exception, not where you start."
    : "Search for real, named direct and indirect competitors, substitutes, internal/in-house alternatives, and clearly distinguished reference brands. Search broadly enough to surface several real alternatives where they plausibly exist."}
When you have gathered enough evidence (or are confident none exists), stop calling web_search and write a concise plain-text brief: for each alternative found, give its name, a one-line description, its likely alternative type (direct/indirect/substitute/internal/do_nothing/reference_brand), and the exact source URL(s) that support it. Note explicit unknowns rather than guessing.`;

  const memorySection = input.memoryNote
    ? `\nNOTES FROM YOUR PREVIOUS RESEARCH RUN ON THIS MODULE (may be stale — verify, don't assume):\n${input.memoryNote}\n`
    : "";

  const stableAuthorityBlock = `CLIENT: ${input.clientName}

APPROVED CLIENT CONTEXT
${input.approvedContext}

ACTIVE APPROVED MARKET OS
${input.approvedMarketOS}

ACTIVE APPROVED AVATAR OS
${input.approvedAvatarOS}

PREVIOUS ACTIVE COMPETITOR OS (REFRESH COMPARISON ONLY)
${input.previousActiveCompetitorOS || "No previous approved Competitor OS exists."}`;

  const existingModelSection = input.existingCompetitorModel
    ? `\nCOMPETITOR MODEL BUILT SO FAR (reuse these canonical subject identities where the same entity comes up again${hasExistingCorpus ? " — this is your search target list, not just a naming reference" : ""})\n${input.existingCompetitorModel}\n`
    : "";

  const variableModuleBlock = `
MODULE KEY: ${input.module.key}
MODULE OBJECTIVE: ${input.module.focus}
${memorySection}${existingModelSection}
${hasExistingCorpus
    ? "Gather evidence now with web_search — targeted queries about the named subjects above, for this module's specific objective — then write your plain-text research brief."
    : "Gather evidence now with web_search, then write your plain-text research brief."}`;

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
      throw new Error(`Anthropic Competitor OS search phase call failed (${result.code}): ${result.error}`);
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

    // A clean stop with no further search and some written text is treated
    // as the final brief. If the model searched but wrote nothing yet, nudge
    // it to write the brief now instead of looping to the turn cap.
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
