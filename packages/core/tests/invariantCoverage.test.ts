/**
 * §12.3 confirmation: no action path reaches a commit without an assertion.
 *
 * The three invariants ship as `assertInvariants` and are wired into every engine
 * test through `act` (#8), so what is left for this issue is not writing them
 * again — it is checking that nothing has quietly stepped around them. Two ways
 * that can happen, and one test for each.
 *
 * A test file that calls `applyAction` directly gets an unchecked transition, so
 * the call sites are enumerated here: each one is a deliberate exception with a
 * reason, and a new one fails this test rather than silently opting its file out.
 * That is the point — the failure is cheap to fix (use `act`) and the alternative
 * is an assertion gap nobody notices for months.
 *
 * The other way is an action type no checked path ever applies. That half lives
 * in `fuzz.test.ts`, which counts the action types its matches drove through the
 * invariant checks and fails if §2's union is not covered.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Files allowed to reach past `act`, and why.
 *
 * `invariants.ts` is where the assertion itself lives. `timeouts.test.ts` asserts
 * that an early `TICK` returns the *same object* (§14), which `act` cannot
 * express: invariant 23 requires `stateVersion` to increase, and the property
 * under test is that it does not. `fuzz.test.ts` and the harness run the same
 * three checks through `transitionErrors`, which is `assertInvariants` without
 * `expect` — a fuzz failure is reported with its seed and log, not thrown.
 */
const ALLOWED = new Set(["invariants.ts", "timeouts.test.ts", "fuzz.test.ts", "harness.ts"]);

function testSources(dir: string): { name: string; source: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return testSources(path);
    if (!entry.name.endsWith(".ts")) return [];
    return [{ name: entry.name, source: readFileSync(path, "utf8") }];
  });
}

describe("the invariant helper is not stepped around (§12.3)", () => {
  it("is the only way the test suite applies an action", () => {
    const direct = testSources(TESTS_DIR)
      .filter(({ name }) => !ALLOWED.has(name))
      .filter(({ source }) => /\bapplyAction\s*\(/.test(source))
      .map(({ name }) => name);

    expect(direct).toEqual([]);
  });

  it("covers every test file that drives the engine at all", () => {
    // The inverse mistake: a file that imports the engine but asserts nothing
    // about the transitions it produces. Every such file must reach the engine
    // through `act`, `reject`, or the fuzz harness.
    const drivers = testSources(TESTS_DIR).filter(
      ({ name, source }) =>
        name.endsWith(".test.ts") &&
        !ALLOWED.has(name) &&
        /from "\.\.\/src\/engine\.js"/.test(source),
    );
    const unchecked = drivers
      .filter(({ source }) => !/from "\.\/invariants\.js"/.test(source))
      .map(({ name }) => name);

    expect(unchecked).toEqual([]);
  });
});
