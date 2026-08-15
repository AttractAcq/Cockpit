import {
  callAnthropicWithTools,
  hasAnthropicKey,
  isAiEnabled,
  type AnthropicContentBlock,
  type AnthropicMessageParam,
  type AnthropicToolParam,
} from "../anthropic.ts";

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

const CONDITIONAL_MODULE_KEYS = new Set<string>(AVATAR_CONDITIONAL_MODULES.map((module) => module.key));

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

export interface AvatarResearchProviderResult {
  provider: "anthropic";
  model: string;
  providerRequestId: string;
  output: AvatarModuleOutput;
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

const AVATAR_MODULE_SCHEMA = {
  type: "object",
  properties: {
    module_key: { type: "string" },
    summary: { type: "string" },
    records: {
      type: "array",
      minItems: 1,
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
            minItems: 1,
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

// Kept low: Anthropic executes web_search calls sequentially server-side within
// one turn, and each one adds real wall-clock time toward the ~150s hard
// ceiling Supabase imposes on a single edge function request (see the budget
// constants below). A module that needs more evidence than this gets it by
// spanning additional turns instead, each with its own fresh time budget.
// Set to 1 (lower than Market OS's 2) because every Avatar OS module carries
// extra context Market OS modules don't (the full approved Market OS release
// on top of the client context files) — a real run timed out 4/4 attempts at
// max_uses:2 before this was lowered.
const WEB_SEARCH_TOOL: AnthropicToolParam = { type: "web_search_20260209", name: "web_search", max_uses: 1 };

const SUBMIT_MODULE_TOOL: AnthropicToolParam = {
  name: "submit_module",
  description:
    "Submit your final structured research for this module. Call this only once, when you have done enough " +
    "research and are confident in your findings. This ends your turn — no further research happens after this call.",
  input_schema: AVATAR_MODULE_SCHEMA as unknown as Record<string, unknown>,
  strict: true,
};

const MAX_AGENT_TURNS = 4;
// Supabase's Edge Function "request idle timeout" is a hard 150s per HTTP
// request regardless of plan (a 400s Pro "wall clock" figure governs the
// worker process's total lifetime across many requests, not a single
// response) — so a single `step` call cannot exceed ~150s no matter what
// these are set to. Keep enough headroom under that ceiling that our own
// AbortController fires cleanly instead of Supabase force-killing the
// worker with a 504 (which would leave the step's lease to expire instead
// of failing cleanly). Values carried over from the Market OS migration,
// where they were tuned against this exact platform ceiling.
// Avatar OS modules carry meaningfully more input context than Market OS's
// (client context files plus the full approved Market OS release), and 5
// straight real-run timeouts at the previous 135s/140s budget — even after
// cutting web_search to a single call per turn — showed search count wasn't
// the bottleneck. Pushed closer to the platform's actual ~150s ceiling to
// give the heavier prompt more room before our own AbortController fires.
const AGENT_WALL_CLOCK_BUDGET_MS = 147_000;
const PER_TURN_TIMEOUT_MS = 145_000;

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

function validateModuleOutput(raw: unknown, expectedModuleKey: string): AvatarModuleOutput {
  const candidate = raw as Partial<AvatarModuleOutput> | null;
  if (!candidate || typeof candidate !== "object") {
    throw new Error(`submit_module was called with a non-object input: ${compactWhitespace(JSON.stringify(raw)).slice(0, 700)}`);
  }
  if (!Array.isArray(candidate.records)) {
    throw new Error(
      `submit_module output has an invalid records collection (records: ${typeof candidate.records}). Raw input: ${compactWhitespace(JSON.stringify(raw)).slice(0, 700)}`,
    );
  }
  // Only the first (buyer_role_system) module is allowed to select follow-up
  // conditional modules — enforce this server-side rather than trusting the
  // model's own compliance with the system-prompt instruction, the same
  // lesson learned from module_key drift in the Market OS migration.
  const rawConditionalKeys = Array.isArray(candidate.conditional_module_keys) ? candidate.conditional_module_keys : [];
  const conditionalKeys = expectedModuleKey === "buyer_role_system"
    ? rawConditionalKeys.filter((key): key is AvatarConditionalModuleKey => CONDITIONAL_MODULE_KEYS.has(key))
    : [];
  return { ...candidate, module_key: expectedModuleKey, conditional_module_keys: conditionalKeys } as AvatarModuleOutput;
}

/**
 * Runs one Avatar OS research module as a bounded Claude tool-calling agent
 * loop: the model researches with web_search, reflects on whether it has
 * enough evidence, searches again if not, and finishes by calling
 * submit_module with output matching the same schema the old single-shot
 * OpenAI call used to produce. Bounded by MAX_AGENT_TURNS and a wall-clock
 * budget so a single `step` invocation stays well under the Supabase edge
 * function timeout.
 */
export async function runAvatarResearchAgent(input: {
  module: typeof AVATAR_RESEARCH_MODULES[number];
  clientName: string;
  approvedContext: string;
  approvedMarketOS: string;
  existingAvatarModel: string;
  memoryNote?: string;
  model?: string;
}): Promise<AvatarResearchProviderResult> {
  if (!isAiEnabled()) throw new Error("AI generation is not configured (AA_AI_GENERATION_ENABLED is not true).");
  if (!hasAnthropicKey()) throw new Error("ANTHROPIC_API_KEY is not configured for Avatar OS research.");

  const model = (input.model ?? Deno.env.get("ANTHROPIC_AVATAR_RESEARCH_MODEL") ?? "claude-sonnet-5").trim();

  const system = `You are the evidence-controlled Avatar OS research agent for Attract Acquisition.
Research actual buying roles and commercially relevant decision behaviour inside the approved market. Use web_search whenever external evidence is needed — you may search as many times as you need, reflecting after each search on whether you have enough evidence before deciding to search again or submit.
Never invent sources, quotations, personal biographies, demographic precision, sensitive traits, cultural conclusions, or strategic recommendations.
Do not infer race, ethnicity, religion, health, disability, sexuality, political beliefs, or other sensitive traits. Do not use stereotypes as evidence.
Model buying roles, responsibilities, authority, triggers, criteria, risk, trust, and behaviour — not decorative personas.
Return atomic findings. Use asserted only when support exists. Use unknown when support is missing.
Never label a finding verified; verification is a separate database-controlled human workflow.
Source URLs in findings must be exact URLs that you actually consulted during this request.
When a finding relies on approved client context, list the exact context file number(s) in context_file_numbers.
When a finding relies on the active approved Market OS, list the exact Market OS record key(s) in market_record_keys.
Only the buyer_role_system module may select conditional_module_keys. Other modules must return an empty list.
Select a conditional module only when the approved Market OS or supported role evidence demonstrates that it is materially relevant.
This module describes supported buyer reality only. Do not recommend positioning, brand, messaging, content, offers, campaigns, or channels.
Your submit_module records array must never be empty — decompose the module objective into at least one, usually several, named records (e.g. one per buying role or sub-topic), each with at least one finding. If a sub-topic is genuinely unresearchable, still create a record for it with a single finding whose disposition is "unknown" and rationale explains why. An empty records array is always wrong and will be rejected.
When you are confident in your findings, call submit_module exactly once with your final structured output. Do not submit until you are done researching.`;

  const memorySection = input.memoryNote
    ? `\nNOTES FROM YOUR PREVIOUS RESEARCH RUN ON THIS MODULE (may be stale — verify, don't assume):\n${input.memoryNote}\n`
    : "";

  // Split the first user turn into two content blocks so the large upstream
  // authority (identical across all 5 core modules of a run, and across
  // every retry/turn of one module) can be cached separately from the small
  // per-module-varying tail. Anthropic's prompt caching is prefix-based and
  // exact-match, so the cached block must be byte-identical across calls —
  // it is built here from only the run-stable inputs (client, context files,
  // Market OS authority), never the per-module module key/objective/memory/
  // existing-model fields.
  const stableAuthorityBlock = `CLIENT: ${input.clientName}

APPROVED CLIENT CONTEXT
${input.approvedContext}

ACTIVE APPROVED MARKET OS
${input.approvedMarketOS}`;

  const variableModuleBlock = `
MODULE KEY: ${input.module.key}
MODULE OBJECTIVE: ${input.module.focus}
${memorySection}
AVATAR MODEL BUILT SO FAR
${input.existingAvatarModel || "No prior Avatar OS module has completed."}

Produce a structured ${input.module.title} module. Separate every material buying role, preserve supported variation and disagreement, and record explicit unknowns instead of inventing detail. Keep record keys stable snake_case identifiers. Call submit_module when ready.`;

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
  let moduleOutput: AvatarModuleOutput | null = null;
  let providerRequestId: string | null = null;

  const startedAt = Date.now();
  let turnOrder = 0;

  while (turnOrder < MAX_AGENT_TURNS) {
    if (Date.now() - startedAt > AGENT_WALL_CLOCK_BUDGET_MS) {
      throw new Error("Avatar OS agent timed out (exceeded its wall-clock budget) before submitting a module.");
    }
    turnOrder += 1;

    const result = await callAnthropicWithTools({
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      tools: [WEB_SEARCH_TOOL, SUBMIT_MODULE_TOOL],
      model,
      // A broad module's full structured submit_module payload (many records,
      // each with several findings) can genuinely need more than 8000 output
      // tokens — Market OS hit stop_reason:"max_tokens" at ~8900 tokens mid
      // tool-call, which corrupted the JSON (records came back empty while
      // the rest of the content spilled into the summary string as raw text).
      maxTokens: 16000,
      timeoutMs: PER_TURN_TIMEOUT_MS,
      // Research-and-report is not a task that benefits from deep reasoning;
      // disabling adaptive thinking cuts real latency on a wide-context call.
      thinking: { type: "disabled" },
    });
    if (!result.ok) {
      throw new Error(`Anthropic Avatar OS agent call failed (${result.code}): ${result.error}`);
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
    throw new Error(`Avatar OS agent did not submit a module within ${MAX_AGENT_TURNS} turns.`);
  }

  const sources = [...sourcesByUrl.values()];
  if (
    moduleOutput.records.some((record) =>
      record.findings.some((finding) => finding.disposition === "asserted" && finding.source_urls.length > 0)
    ) && sources.length === 0
  ) {
    throw new Error("Avatar OS agent returned sourced findings without inspectable web sources.");
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
