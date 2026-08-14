// Generic "ask_agent" tool contract for cross-domain intelligence calls.
//
// An agent (e.g. Competitor OS) that needs a clarification from another
// already-approved domain (e.g. Market OS, Avatar OS) declares this tool
// with the domains it's allowed to query. The handler reads only the
// *approved* active release for that domain — never draft/needs_review
// state — so an agent can only consult authority a human has already signed
// off on, mirroring the approval boundary the rest of Intelligence enforces.
//
// Not wired into any agent yet. Market OS (the first agent-runtime migration)
// is foundational and has nothing upstream to call. This file is the seam
// the next migration (Competitor OS, which needs Market OS + Avatar OS) plugs
// into — build the tool config with buildAskAgentTool() and route its
// tool_use calls through answerAskAgentQuestion().

import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AnthropicToolParam } from "../anthropic.ts";

export const ASK_AGENT_TOOL_NAME = "ask_agent";

export interface AskAgentToolConfig {
  /** Domains this agent is allowed to query. Must all be upstream of this agent's own domain. */
  allowedDomains: string[];
}

export function buildAskAgentTool(config: AskAgentToolConfig): AnthropicToolParam {
  return {
    name: ASK_AGENT_TOOL_NAME,
    description:
      "Ask a specific question of another intelligence domain's approved research. " +
      `Only these domains are available: ${config.allowedDomains.join(", ")}. ` +
      "Returns that domain's approved findings and records relevant to your question, or " +
      "says no approved release exists yet. Use this when you need a fact or clarification " +
      "that domain owns, rather than re-researching it yourself.",
    input_schema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          enum: config.allowedDomains,
          description: "Which upstream intelligence domain to ask.",
        },
        question: {
          type: "string",
          description: "The specific question to ask, in plain language.",
        },
      },
      required: ["domain", "question"],
      additionalProperties: false,
    },
  };
}

export interface AskAgentAnswer {
  domain: string;
  hasApprovedRelease: boolean;
  answer: string;
}

/**
 * Reads the approved active release for `domain` and returns a compact text
 * answer built from its records. Never reads draft or needs_review state.
 */
export async function answerAskAgentQuestion(
  sb: SupabaseClient,
  clientId: string,
  domain: string,
  question: string,
): Promise<AskAgentAnswer> {
  const { data: active } = await sb
    .from("client_intelligence_active_releases")
    .select("release_id")
    .eq("client_id", clientId)
    .eq("intelligence_domain", domain)
    .maybeSingle();

  if (!active?.release_id) {
    return {
      domain,
      hasApprovedRelease: false,
      answer:
        `No approved ${domain} release exists yet for this client. Treat this as unknown, not as evidence of absence.`,
    };
  }

  const { data: records } = await sb
    .from("client_intelligence_records")
    .select("title, summary")
    .eq("release_id", active.release_id)
    .order("display_order");

  const body = (records ?? [])
    .map((r: { title: string; summary: string }) => `- ${r.title}: ${r.summary}`.trim())
    .join("\n");

  return {
    domain,
    hasApprovedRelease: true,
    answer: body
      ? `Approved ${domain} findings relevant to your question ("${question}"):\n${body}`
      : `The approved ${domain} release has no structured records yet.`,
  };
}
