// ESLint flat config (ESLint 9). This repository is ESM (`"type": "module"`).
//
// Intent: a **correctness** gate, not a style gate. Rules here catch real
// defects — invalid hooks usage, undeclared variables, duplicate declarations,
// unreachable code, unsafe or unused disable directives. Purely cosmetic rules
// (quotes, semicolons, line width, import order) are deliberately absent: the
// codebase predates linting, and mass-reformatting it would bury real changes
// in noise and make `git blame` useless.
//
// Type-aware linting is deliberately NOT enabled. `npm run typecheck` already
// runs the full TypeScript compiler over the same files, so type-aware rules
// would duplicate that at a large speed cost.

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Nothing generated, vendored, archived or machine-local is linted.
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "build/**",
      "archive/**",            // retired code, kept only for traceability
      "supabase/.temp/**",     // local CLI state
      "supabase/functions/node_modules/**", // Deno-managed, regenerated on demand
      "supabase/held-migrations/**",
      ".claude/**",
      "**/*.d.ts",
      "public/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── Frontend ──────────────────────────────────────────────────────────────
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Hooks correctness is the highest-value rule in a React codebase: a
      // conditional hook is a real bug, not a preference.
      "react-hooks/rules-of-hooks": "error",
      // Dependency completeness is advisory — the repo already carries two
      // reviewed `eslint-disable-line` directives for deliberate omissions.
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // ── Supabase Edge Functions (Deno runtime) ───────────────────────────────
  {
    files: ["supabase/functions/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node, Deno: "readonly" },
    },
  },

  // ── Tests and Node scripts ───────────────────────────────────────────────
  {
    files: ["tests/**/*.{ts,mjs,js}", "scripts/**/*.{mjs,js}", "*.config.{ts,js}", "vite.config.ts"],
    languageOptions: { globals: { ...globals.node } },
  },

  // ── Shared rule posture ──────────────────────────────────────────────────
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    rules: {
      // `any` is banned by repository convention (prefer `unknown` + narrow).
      // `tsc --noEmit` only catches *implicit* any (noImplicitAny) — an
      // explicit `: any` or `as any` compiles cleanly, so this rule is the
      // actual enforcement for the house rule, not a duplicate of typecheck.
      "@typescript-eslint/no-explicit-any": "error",
      // Unused code is a real signal, but an intentionally-ignored argument or
      // caught error is not. Underscore marks intent.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // Empty catch blocks are usually deliberate here (best-effort cleanup),
      // but an empty function body elsewhere is worth seeing.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
