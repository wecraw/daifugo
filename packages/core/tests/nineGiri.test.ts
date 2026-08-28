/**
 * §12.1 test 5: 9-giri (§6, §7.1 Phase D), with its 8-giri sibling alongside.
 *
 * A single 9 does nothing; a pair or a triple clears. 8-giri is the same trick
 * ender without the minimum, so the two are asserted against each other here.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_HOUSE_RULES } from "../src/config.js";
import { firesEightGiri } from "../src/rules/eightGiri.js";
import { firesNineGiri } from "../src/rules/nineGiriMinPair.js";
import { combo } from "./fixtures.js";

const ON = DEFAULT_HOUSE_RULES;

const single9 = combo(["S-9"]);
const pair9 = combo(["S-9", "H-9"]);
const triple9 = combo(["S-9", "H-9", "D-9"]);

describe("9-giri needs a pair (§6)", () => {
  it("does not fire on a single 9", () => {
    expect(firesNineGiri(single9, ON)).toBe(false);
  });

  it("fires on a pair and on a triple", () => {
    expect(firesNineGiri(pair9, ON)).toBe(true);
    expect(firesNineGiri(triple9, ON)).toBe(true);
  });

  it("counts a joker bound to a 9 toward the pair (§5.4)", () => {
    const bound = combo(["JKR-1", "S-9"]);
    expect(bound.resolvedRank).toBe(9);
    expect(firesNineGiri(bound, ON)).toBe(true);
  });

  it("does not fire on another rank, or with the rule off", () => {
    expect(firesNineGiri(combo(["S-8", "H-8"]), ON)).toBe(false);
    expect(firesNineGiri(pair9, { ...ON, nineGiriMinPair: false })).toBe(false);
  });
});

describe("8-giri has no minimum (§6)", () => {
  it("fires on a single 8", () => {
    expect(firesEightGiri(combo(["S-8"]), ON)).toBe(true);
  });

  it("fires on a pair of 8s, and on a joker bound to an 8", () => {
    expect(firesEightGiri(combo(["S-8", "H-8"]), ON)).toBe(true);
    expect(firesEightGiri(combo(["JKR-1", "S-8"]), ON)).toBe(true);
  });

  it("does not fire on a 9, or with the rule off", () => {
    expect(firesEightGiri(single9, ON)).toBe(false);
    expect(firesEightGiri(combo(["S-8"]), { ...ON, eightGiri: false })).toBe(false);
  });
});
