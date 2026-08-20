// Cockpit v3 Step 3 — @mention parsing for Team workspace messages. Pure
// logic, kept out of the .tsx for the same reason as business-context-
// resolve.ts: this repo has no React component-test infrastructure.
//
// Mention *execution* (an agent actually acting on being mentioned) is
// explicitly deferred to Step 5 (Master AI) -- this is rendering only.
// Agents are matched by their real registry name (e.g. "run-market-os"),
// never an invented display name -- this codebase has no friendly
// agent-name concept anywhere else (TeamRolesSection shows the raw
// registry name too, see src/lib/workflows.ts).

export interface MentionCandidate {
  type: "human" | "agent";
  id: string;
  /** The exact text that follows "@" for this candidate, e.g. a staff full name or an agent's registry name. */
  label: string;
}

export interface MentionSegment {
  text: string;
  mention: MentionCandidate | null;
}

/**
 * Splits a message body into plain-text and mention segments. At each "@",
 * the longest matching candidate label (case-insensitive) is preferred, so
 * e.g. "@Alex Thomas" resolves as one mention rather than "@Alex" plus
 * literal " Thomas".
 */
export function parseMentions(body: string, candidates: MentionCandidate[]): MentionSegment[] {
  const sorted = [...candidates].sort((a, b) => b.label.length - a.label.length);
  const segments: MentionSegment[] = [];
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (buffer.length > 0) {
      segments.push({ text: buffer, mention: null });
      buffer = "";
    }
  };

  while (i < body.length) {
    if (body[i] === "@") {
      const rest = body.slice(i + 1);
      const restLower = rest.toLowerCase();
      const match = sorted.find((c) => c.label.length > 0 && restLower.startsWith(c.label.toLowerCase()));
      if (match) {
        flush();
        segments.push({ text: `@${match.label}`, mention: match });
        i += 1 + match.label.length;
        continue;
      }
    }
    buffer += body[i];
    i += 1;
  }
  flush();
  return segments;
}

/** The distinct candidates actually mentioned in a message, in first-mention order. */
export function extractMentions(body: string, candidates: MentionCandidate[]): MentionCandidate[] {
  const seen = new Set<string>();
  const result: MentionCandidate[] = [];
  for (const segment of parseMentions(body, candidates)) {
    if (segment.mention && !seen.has(segment.mention.id)) {
      seen.add(segment.mention.id);
      result.push(segment.mention);
    }
  }
  return result;
}
