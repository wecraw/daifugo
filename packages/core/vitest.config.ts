import { defineConfig } from "vitest/config";

/**
 * `core` is the gate: §13 says no client work starts until §12.1-12.3 pass, and
 * the coverage thresholds below are the second half of that gate. They are set
 * just under what the suite actually reaches, so a change that leaves a new
 * branch untested fails here rather than in a client bug six issues later.
 *
 * `src/index.ts` is excluded: it is a barrel of re-exports with no behaviour, and
 * counting it would mean the threshold moves whenever a module is added.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      reporter: ["text", "lcov"],
      thresholds: {
        statements: 99,
        branches: 90,
        functions: 99,
        lines: 99,
      },
    },
  },
});
