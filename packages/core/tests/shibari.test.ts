/**
 * §12.1 test 8: shibari (§6).
 *
 * Two hearts plays lock; a mixed {S,H} set locks; overlapping but unequal sets do
 * not; a non-matching play is then rejected by the evaluator; and a pure joker
 * satisfies a lock and maintains it without ever establishing one.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_HOUSE_RULES } from "../src/config.js";
import { checkLegality } from "../src/evaluator.js";
import { shibariLock } from "../src/rules/shibari.js";
import { bind, combo } from "./fixtures.js";

const ON = DEFAULT_HOUSE_RULES;
const OFF = { ...DEFAULT_HOUSE_RULES, shibari: false };

describe("establishing the lock (§6)", () => {
  it("locks when two consecutive singles share a suit", () => {
    expect(shibariLock(combo(["H-5"]), combo(["H-9"]), null, ON)).toEqual(["H"]);
  });

  it("locks a mixed set: spades+hearts after spades+hearts", () => {
    const previous = combo(["S-5", "H-5"]);
    const current = combo(["H-9", "S-9"]);
    expect(shibariLock(previous, current, null, ON)).toEqual(["S", "H"]);
  });

  it("does not lock on overlap: {S,H} then {H,D} is not a partial lock", () => {
    const previous = combo(["S-5", "H-5"]);
    const current = combo(["H-9", "D-9"]);
    expect(shibariLock(previous, current, null, ON)).toBeNull();
  });

  it("does not lock on the first play of a trick", () => {
    expect(shibariLock(null, combo(["H-9"]), null, ON)).toBeNull();
  });

  it("does not lock with the rule off", () => {
    expect(shibariLock(combo(["H-5"]), combo(["H-9"]), null, OFF)).toBeNull();
  });

  it("reads the bound suit of a joker, like every other rule (§5.4)", () => {
    const boundToHearts = combo(["JKR-1"], [bind("JKR-1", 9, "H")]);
    expect(shibariLock(combo(["H-5"]), boundToHearts, null, ON)).toEqual(["H"]);
  });
});

describe("an established lock (§6)", () => {
  it("is maintained while the trick runs", () => {
    const lock = shibariLock(combo(["H-5"]), combo(["H-9"]), ["H"], ON);
    expect(lock).toEqual(["H"]);
  });

  it("rejects a play whose suits do not match exactly", () => {
    const legality = checkLegality(combo(["S-9"]), { top: combo(["H-5"]), suitLock: ["H"] });
    expect(legality).toEqual({ ok: false, error: "SUIT_LOCK_MISMATCH" });
  });

  it("accepts a play that matches exactly", () => {
    const legality = checkLegality(combo(["H-9"]), { top: combo(["H-5"]), suitLock: ["H"] });
    expect(legality.ok).toBe(true);
  });
});

describe("pure jokers (§6)", () => {
  const pureJoker = combo(["JKR-1"]);

  it("satisfy any lock", () => {
    const legality = checkLegality(pureJoker, { top: combo(["H-5"]), suitLock: ["H"] });
    expect(legality.ok).toBe(true);
  });

  it("maintain an existing lock rather than clearing it", () => {
    expect(shibariLock(combo(["H-5"]), pureJoker, ["H"], ON)).toEqual(["H"]);
  });

  it("do not establish one: a suitless card pins nothing down", () => {
    expect(shibariLock(combo(["H-5"]), pureJoker, null, ON)).toBeNull();
    expect(shibariLock(pureJoker, combo(["H-9"]), null, ON)).toBeNull();
  });
});
