/**
 * §12.1 test 9: revolution (§6, §7.1 Phase A).
 *
 * Four of a kind toggles for the rest of the round; a triple does not; and a
 * wildcard joker counts toward the four (§5.4).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_HOUSE_RULES } from "../src/config.js";
import { applyKakumei, firesKakumei } from "../src/rules/kakumei.js";
import { effectiveInverted } from "../src/strength.js";
import { combo } from "./fixtures.js";

const ON = DEFAULT_HOUSE_RULES;
const OFF = { ...DEFAULT_HOUSE_RULES, kakumei: false };

const tripleK = combo(["S-13", "H-13", "D-13"]);
const quadK = combo(["S-13", "H-13", "D-13", "C-13"]);

describe("four of a kind (§6)", () => {
  it("toggles revolution on", () => {
    expect(firesKakumei(quadK, ON)).toBe(true);
    expect(applyKakumei(false, quadK, ON)).toBe(true);
  });

  it("toggles it back off when a second revolution lands", () => {
    expect(applyKakumei(true, quadK, ON)).toBe(false);
  });

  it("counts a wildcard joker toward the four (§5.4)", () => {
    const withJoker = combo(["JKR-1", "S-13", "H-13", "D-13"]);
    expect(withJoker.resolvedRank).toBe(13);
    expect(withJoker.cards).toHaveLength(4);
    expect(applyKakumei(false, withJoker, ON)).toBe(true);
  });

  it("fires on five of a kind too, both jokers bound in", () => {
    const five = combo(["JKR-1", "JKR-2", "S-13", "H-13", "D-13"]);
    expect(firesKakumei(five, ON)).toBe(true);
  });

  it("is rank-agnostic: four 3s revolt just as well as four kings", () => {
    expect(firesKakumei(combo(["S-3", "H-3", "D-3", "C-3"]), ON)).toBe(true);
  });
});

describe("fewer than four (§6)", () => {
  it("does not fire on a triple", () => {
    expect(firesKakumei(tripleK, ON)).toBe(false);
    expect(applyKakumei(false, tripleK, ON)).toBe(false);
  });

  it("does not fire on a pair of pure jokers, strong as it is", () => {
    expect(firesKakumei(combo(["JKR-1", "JKR-2"]), ON)).toBe(false);
  });
});

describe("the rule off", () => {
  it("leaves revolution alone", () => {
    expect(firesKakumei(quadK, OFF)).toBe(false);
    expect(applyKakumei(false, quadK, OFF)).toBe(false);
  });
});

describe("with 11-back (§5.2, §12.2 case 13)", () => {
  it("XORs: revolution plus an inverted trick is upright", () => {
    const revolution = applyKakumei(false, quadK, ON);
    expect(effectiveInverted(revolution, true)).toBe(false);
    expect(effectiveInverted(revolution, false)).toBe(true);
  });
});
