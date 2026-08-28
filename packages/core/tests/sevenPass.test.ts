/**
 * §12.1 test 4: 7-pass (§6, §7.1 Phase B, §7.2).
 *
 * The state transition, `k = min(C, remaining)`, k = 0 when the 7 was the last
 * card, and a target that skips finished players but not passed ones.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_HOUSE_RULES } from "../src/config.js";
import {
  firesSevenPass,
  resolveSevenPass,
  sevenPassCount,
  sevenPassPending,
  sevenPassTarget,
} from "../src/rules/sevenPass.js";
import type { PendingAction } from "../src/types.js";
import { cards, combo, seatsOf } from "./fixtures.js";

const ON = DEFAULT_HOUSE_RULES;
const OFF = { ...DEFAULT_HOUSE_RULES, sevenPass: false };

const single7 = combo(["S-7"]);
const triple7 = combo(["S-7", "H-7", "D-7"]);

describe("the trigger (§6)", () => {
  it("fires on a resolved rank of 7, including a bound joker (§5.4)", () => {
    expect(firesSevenPass(single7, ON)).toBe(true);
    expect(firesSevenPass(combo(["JKR-1", "S-7"]), ON)).toBe(true);
  });

  it("does not fire on another rank, or with the rule off", () => {
    expect(firesSevenPass(combo(["S-8"]), ON)).toBe(false);
    expect(firesSevenPass(single7, OFF)).toBe(false);
  });
});

describe("k = min(C, cards remaining) (§6)", () => {
  it("is the combo count when the hand is long enough", () => {
    expect(sevenPassCount(triple7, 5)).toBe(3);
  });

  it("is the remaining hand when it is shorter (§7.3)", () => {
    expect(sevenPassCount(triple7, 2)).toBe(2);
  });

  it("is zero when the 7 was the last card", () => {
    expect(sevenPassCount(single7, 0)).toBe(0);
  });
});

describe("the target (§6)", () => {
  it("is the nearest player to the left", () => {
    expect(sevenPassTarget("p0", seatsOf(4))).toBe("p1");
  });

  it("skips finished players", () => {
    expect(sevenPassTarget("p0", seatsOf(4, { finished: ["p1", "p2"] }))).toBe("p3");
  });

  it("does not skip passed players: they are still in the round", () => {
    expect(sevenPassTarget("p0", seatsOf(4, { passed: ["p1"] }))).toBe("p1");
  });

  it("wraps around the table", () => {
    expect(sevenPassTarget("p3", seatsOf(4))).toBe("p0");
  });

  it("is null when nobody else is still in the round", () => {
    expect(sevenPassTarget("p0", seatsOf(3, { finished: ["p1", "p2"] }))).toBeNull();
  });
});

describe("the pending action (§7.1 Phase B)", () => {
  it("halts the pipeline with the source, target, and count", () => {
    expect(sevenPassPending(triple7, "p0", 4, seatsOf(4), ON)).toEqual({
      type: "RESOLVE_7_PASS",
      count: 3,
      sourcePlayerId: "p0",
      targetPlayerId: "p1",
    });
  });

  it("is null when k is 0, so the pipeline runs straight on to Phase C", () => {
    expect(sevenPassPending(single7, "p0", 0, seatsOf(4), ON)).toBeNull();
  });

  it("is null with the rule off", () => {
    expect(sevenPassPending(single7, "p0", 3, seatsOf(4), OFF)).toBeNull();
  });

  it("is null when there is no non-finished target left", () => {
    expect(
      sevenPassPending(single7, "p0", 3, seatsOf(3, { finished: ["p1", "p2"] }), ON),
    ).toBeNull();
  });
});

describe("resolving the transfer (§7.2)", () => {
  const pending: PendingAction = {
    type: "RESOLVE_7_PASS",
    count: 1,
    sourcePlayerId: "p0",
    targetPlayerId: "p1",
  };
  const hand = cards("S-3", "H-4", "D-5");

  it("splits the given cards out of the source hand", () => {
    const result = resolveSevenPass(pending, "p0", ["H-4"], hand);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.given.map((c) => c.id)).toEqual(["H-4"]);
    expect(result.value.remaining.map((c) => c.id)).toEqual(["S-3", "D-5"]);
  });

  it("rejects a player who does not owe the transfer", () => {
    const result = resolveSevenPass(pending, "p1", ["H-4"], hand);
    expect(result).toEqual({ ok: false, error: "NOT_YOUR_TURN" });
  });

  it("rejects the wrong number of cards", () => {
    const result = resolveSevenPass(pending, "p0", ["H-4", "D-5"], hand);
    expect(result).toEqual({ ok: false, error: "WRONG_CARD_COUNT" });
  });

  it("rejects a card the player does not hold", () => {
    const result = resolveSevenPass(pending, "p0", ["C-9"], hand);
    expect(result).toEqual({ ok: false, error: "CARD_NOT_IN_HAND" });
  });

  it("rejects the wrong pending action", () => {
    const discard: PendingAction = { type: "RESOLVE_10_DISCARD", count: 1, playerId: "p0" };
    const result = resolveSevenPass(discard, "p0", ["H-4"], hand);
    expect(result).toEqual({ ok: false, error: "WRONG_PENDING_ACTION" });
  });
});
