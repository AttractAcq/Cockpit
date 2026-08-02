export const executableProjectionExclusionRules = [
  {
    id: "extensions-schema-ddl",
    classification: "platform-owned",
    description: "Exclude CREATE/ALTER SCHEMA statements for the Supabase-managed extensions schema.",
    pattern: /^(?:CREATE SCHEMA IF NOT EXISTS|ALTER SCHEMA) "extensions"/i,
  },
  {
    id: "extensions-function-ddl",
    classification: "platform-owned",
    description: "Exclude CREATE/ALTER/COMMENT statements for functions owned by the extensions schema.",
    pattern: /^(?:CREATE OR REPLACE|ALTER|COMMENT ON) FUNCTION "extensions"\./i,
  },
  {
    id: "extensions-grants",
    classification: "platform-owned",
    description: "Exclude GRANT/REVOKE statements whose target is in the Supabase-managed extensions schema.",
    pattern: /^(?:GRANT|REVOKE)[\s\S]*"extensions"/i,
  },
];

export function excludedProjectionRule(statement) {
  return executableProjectionExclusionRules.find((rule) => rule.pattern.test(statement)) ?? null;
}
