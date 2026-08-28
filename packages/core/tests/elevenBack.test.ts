/**
 * §12.1 test 7: 11-back (§6, §7.1 Phase A).
 *
 * Parity over the combo count — one and three Jacks toggle, two are a no-op —
 * and the reset that comes with a cleared trick (§7.4).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_HOUSE_RULES } from "../src/config.js";
import { applyElevenBack, firesElevenBack } from "../src/rules/elevenBack.js";
import { effectiveInverted } from "../src/strength.js";
import { combo } from "./fixtures.js";

const ON = DEFAULT_HOUSE_RULES;
const OFF = { ...DEFAULT_HOUSE_RULES, elevenBack: false };

const oneJack = combo(["S-11"]);
const twoJacks = combo(["S-11", "H-11"]);
const threeJacks = combo(["S-11", "H-11", "D-11"]);

describe("parity (§6)", () => {
  it("toggles on one Jack", () => {
    expect(firesElevenBack(oneJack, ON)).toBe(true);
    expect(applyElevenBack(false, oneJack, ON)).toBe(true);
  });

  it("is a no-op on two Jacks", () => {
    expect(firesElevenBack(twoJacks, ON)).toBe(false);
    expect(applyElevenBack(false, twoJacks, ON)).toBe(false);
  });

  it("toggles on three Jacks", () => {
    expect(firesElevenBack(threeJacks, ON)).toBe(true);
    expect(applyElevenBack(false, threeJacks, ON)).toBe(true);
  });

  it("toggles back when a second odd play lands in the same trick", () => {
    expect(applyElevenBack(true, oneJack, ON)).toBe(false);
  });

  it("counts a joker bound to a Jack toward the parity (§5.4)", () => {
    const bound = combo(["JKR-1", "S-11", "H-11"]);
    expect(bound.resolvedRank).toBe(11);
    expect(applyElevenBack(false, bound, ON)).toBe(true);
  });

  it("does not fire on another rank, or with the rule off", () => {
    expect(firesElevenBack(combo(["S-12"]), ON)).toBe(false);
    expect(applyElevenBack(false, oneJack, OFF)).toBe(false);
  });
});

describe("reset on trick clear (§7.4)", () => {
  it("starts from false again, so the same Jack inverts the new trick", () => {
    // clearTrick sets trickInverted = false; the rule is a pure toggle over it.
    const afterClear = false;
    expect(applyElevenBack(afterClear, oneJack, ON)).toBe(true);
  });
});

describe("with revolution (§5.2, §12.2 case 13)", () => {
  it("XORs rather than stacks: both on is upright again", () => {
    const inverted = applyElevenBack(false, oneJack, ON);
    expect(effectiveInverted(true, inverted)).toBe(false);
    expect(effectiveInverted(false, inverted)).toBe(true);
  });
});
