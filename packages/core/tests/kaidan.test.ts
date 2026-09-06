/**
 * §12.1 test 9: kaidan (§6).
 *
 * Two consecutive plays exactly one strength-index step apart lock the trick;
 * a jump of two or more does not; the lock advances step by step; a mismatched
 * count never locks; a stronger-but-wrong-step play is rejected by the
 * evaluator; and the direction follows `effectiveInverted`.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_HOUSE_RULES } from "../src/config.js";
import { checkLegality } from "../src/evaluator.js";
import { kaidanLock } from "../src/rules/kaidan.js";
import { strengthOf } from "../src/strength.js";
import { combo } from "./fixtures.js";

const ON = DEFAULT_HOUSE_RULES;
const OFF = { ...DEFAULT_HOUSE_RULES, kaidan: false };

describe("establishing the lock (§6)", () => {
  it("locks a +1 pair on a pair: 3-3 then 4-4 requires 5-5 next", () => {
    const threes = combo(["S-3", "H-3"]);
    const fours = combo(["S-4", "H-4"]);
    expect(kaidanLock(threes, fours, null, false, ON)).toBe(strengthOf(5));
  });

  it("locks a +1 single: a 4 then a 5 requires a 6 next", () => {
    expect(kaidanLock(combo(["S-4"]), combo(["S-5"]), null, false, ON)).toBe(strengthOf(6));
  });

  it("does not lock on a jump of two or more", () => {
    expect(kaidanLock(combo(["S-3"]), combo(["S-6"]), null, false, ON)).toBeNull();
  });

  it("does not lock on the first play of a trick", () => {
    expect(kaidanLock(null, combo(["S-4"]), null, false, ON)).toBeNull();
  });

  it("does not lock when the count changes", () => {
    const single = combo(["S-3"]);
    const pair = combo(["S-4", "H-4"]);
    expect(kaidanLock(single, pair, null, false, ON)).toBeNull();
  });

  it("does not lock with the rule off", () => {
    expect(kaidanLock(combo(["S-3"]), combo(["S-4"]), null, false, OFF)).toBeNull();
  });
});

describe("an established lock advances (§6)", () => {
  it("moves the requirement one further step on the next accepted play", () => {
    const fours = combo(["S-4"]);
    const fives = combo(["S-5"]);
    // Already locked requiring a 5 (strengthOf(5)); playing it advances to a 6.
    expect(kaidanLock(fours, fives, strengthOf(5), false, ON)).toBe(strengthOf(6));
  });

  it("rejects a stronger play that does not hit the exact next step", () => {
    const legality = checkLegality(combo(["S-9"]), {
      top: combo(["S-4"]),
      kaidanLock: strengthOf(5),
    });
    expect(legality).toEqual({ ok: false, error: "KAIDAN_LOCK_MISMATCH" });
  });

  it("accepts a play that hits the exact next step", () => {
    const legality = checkLegality(combo(["S-5"]), {
      top: combo(["S-4"]),
      kaidanLock: strengthOf(5),
    });
    expect(legality.ok).toBe(true);
  });
});

describe("direction follows effectiveInverted (§5.2)", () => {
  it("locks toward decreasing strength while inverted", () => {
    const nines = combo(["S-9", "H-9"]);
    const eights = combo(["S-8", "H-8"]);
    // Inverted: a 9 then an 8 is a winning +1 step, and requires a 7 next.
    expect(kaidanLock(nines, eights, null, true, ON)).toBe(strengthOf(7));
  });

  it("rejects a play that beats the top under inversion but skips the required step", () => {
    // A 3 is stronger than an 8 while inverted, but the lock demands a 7 exactly.
    const legality = checkLegality(combo(["S-3"]), {
      top: combo(["S-8"]),
      trickInverted: true,
      kaidanLock: strengthOf(7),
    });
    expect(legality).toEqual({ ok: false, error: "KAIDAN_LOCK_MISMATCH" });
  });
});
