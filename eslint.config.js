import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  {
    // `.claude/worktrees` holds throwaway checkouts of branches being worked on
    // elsewhere. They are excluded from git and are not this tree's code, so
    // linting them only ever reports the same problems twice.
    ignores: ["**/dist/**", "**/node_modules/**", ".claude/**", "packages/client/ios/**"],
  },
  js.configs.recommended,
  {
    files: ["packages/core/**/*.{ts,tsx}", "packages/server/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Deploy tooling: Node scripts outside the workspaces (docs/DEPLOY.md).
    files: ["scripts/**/*.{js,mjs}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["packages/client/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Client tests run in Vitest's jsdom: a browser inside a Node process, so
    // both sets of globals are legitimate here.
    files: ["packages/client/tests/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
    },
  },
  prettier,
];
