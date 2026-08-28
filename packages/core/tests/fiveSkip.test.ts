/**
 * §12.1 test 3: 5-skip (§6, §7.1 Phase E).
 *
 * One, two, and three fives at four players, plus the stacking case where the
 * skip count reaches every eligible opponent and the trick clears instead.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_HOUSE_RULES } from "../src/config.js";
import { fiveSkip, firesFiveSkip } from "../src/rules/fiveSkip.js";
import { combo, seatsOf } from "./fixtures.js";

const ON = DEFAULT_HOUSE_RULES;
const OFF = { ...DEFAULT_HOUSE_RULES, fiveSkip: false };

const single5 = combo(["S-5"]);
const pair5 = combo(["S-5", "H-5"]);
const triple5 = combo(["S-5", "H-5", "D-5"]);

describe("the trigger (§6)", () => {
  it("fires on a resolved rank of 5, at any count", () => {
    expect(firesFiveSkip(single5, ON)).toBe(true);
    expect(firesFiveSkip(triple5, ON)).toBe(true);
  });

  it("fires for a joker bound to a 5, which is a 5 (§5.4)", () => {
    const boundPair = combo(["JKR-1", "S-5"]);
    expect(boundPair.resolvedRank).toBe(5);
    expect(firesFiveSkip(boundPair, ON)).toBe(true);
  });

  it("does not fire on another rank, or with the rule off", () => {
    expect(firesFiveSkip(combo(["S-6"]), ON)).toBe(false);
    expect(firesFiveSkip(single5, OFF)).toBe(false);
  });
});

describe("skipping at four players (§6)", () => {
  const seats = seatsOf(4);

  it("skips one player for a single 5", () => {
    expect(fiveSkip(single5, "p0", seats, ON)).toEqual({
      kind: "SKIP",
      skippedPlayerIds: ["p1"],
      nextIndex: 2,
    });
  });

  it("skips two for a pair", () => {
    expect(fiveSkip(pair5, "p0", seats, ON)).toEqual({
      kind: "SKIP",
      skippedPlayerIds: ["p1", "p2"],
      nextIndex: 3,
    });
  });

  it("clears the trick and keeps the lead for a triple, S >= eligible others", () => {
    expect(fiveSkip(triple5, "p0", seats, ON)).toEqual({
      kind: "CLEAR_TRICK",
      leaderId: "p0",
    });
  });

  it("counts eligible seats, not seats: a passed player is skipped for free", () => {
    const withPass = seatsOf(4, { passed: ["p1"] });
    expect(fiveSkip(single5, "p0", withPass, ON)).toEqual({
      kind: "SKIP",
      skippedPlayerIds: ["p2"],
      nextIndex: 3,
    });
  });

  it("wraps past finished players (§12.2 case 15)", () => {
    const withFinished = seatsOf(4, { finished: ["p2"] });
    expect(fiveSkip(single5, "p1", withFinished, ON)).toEqual({
      kind: "SKIP",
      skippedPlayerIds: ["p3"],
      nextIndex: 0,
    });
  });
});

describe("the stacking case (§6)", () => {
  it("clears when the skip count reaches every eligible opponent", () => {
    // Two eligible others left, so a pair of 5s already skips the table.
    const seats = seatsOf(4, { passed: ["p3"] });
    expect(fiveSkip(pair5, "p0", seats, ON)).toEqual({
      kind: "CLEAR_TRICK",
      leaderId: "p0",
    });
  });

  it("clears when the player has just gone out and nobody eligible is left", () => {
    const seats = seatsOf(3, { finished: ["p0", "p1", "p2"] });
    expect(fiveSkip(single5, "p0", seats, ON)).toEqual({
      kind: "CLEAR_TRICK",
      leaderId: "p0",
    });
  });
});

describe("the rule off", () => {
  it("is inert", () => {
    expect(fiveSkip(triple5, "p0", seatsOf(4), OFF)).toEqual({ kind: "NONE" });
  });
});
