export const FORBIDDEN_EXECUTION_CONTENT: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "deprecated offer", pattern: /Proof Brand Lite|Proof Engine Buildout|Authority Brand/i },
  { label: "legacy pricing", pattern: /\bZAR\b|\bR\d{4,}|\bR\d{1,3}(?:,\d{3})+/i },
  { label: "guaranteed outcome", pattern: /guaranteed (?:leads|results|revenue|roi)/i },
  { label: "invented client outcome", pattern: /our clients (?:achieved|generated|saw|increased|grew)/i },
  { label: "invented trust claim", pattern: /trusted by (?:hundreds|thousands|leading|top)/i },
  { label: "invented ROI", pattern: /\b(?:roi of|\d+(?:\.\d+)?x roi|\d+(?:\.\d+)?% roi)\b/i },
  { label: "invented testimonial", pattern: /\b(?:client )?testimonial:\s*(?!not provided|none|absent|unavailable)/i },
  { label: "invented case study", pattern: /\bcase stud(?:y|ies):\s*(?!not provided|none|absent|unavailable)/i },
];

// Forbidden phrases are allowed only when the sentence clearly establishes a
// proof-honesty constraint. Include ordinary policy wording ("prohibited",
// "unsupported", "unverified") so a safe rule is not mistaken for a claim.
const HONESTY_CONSTRAINT = /\b(?:do not|never|must not|cannot|avoid|forbidden|prohibit(?:ed|s|ing)?|prohibitions?|disallow(?:ed|s|ing)?|unsupported|unverified|unsubstantiated|not claim|not use|not invent|not guaranteed|no guarantees?|without guarantees?|no testimonials?|no case stud(?:y|ies)|no fabricated|no guaranteed)\b/i;

export function executionHonestyErrors(text: string): string[] {
  const scannable = text.split(/(?<=[.!?\n])/).map((sentence) => {
    const namesForbidden = FORBIDDEN_EXECUTION_CONTENT.some(({ pattern }) => pattern.test(sentence));
    return namesForbidden && HONESTY_CONSTRAINT.test(sentence) ? "[explicit proof-honesty constraint]" : sentence;
  }).join("");
  return FORBIDDEN_EXECUTION_CONTENT.filter(({ pattern }) => pattern.test(scannable)).map(({ label }) => label);
}
