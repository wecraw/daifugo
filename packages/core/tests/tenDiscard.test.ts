/**
 * §12.1 test 6: 10-discard (§6, §7.1 Phase B, §7.2).
 *
 * A pair of 10s discards two cards to the graveyard; `k = min(D, remaining)`;
 * a player who does not owe the discard is rejected.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_HOUSE_RULES } from "../src/config.js";
import {
  firesTenDiscard,
  resolveTenDiscard,
  tenDiscardCount,
  tenDiscardPending,
} from "../src/rules/tenDiscard.js";
import type { PendingAction } from "../src/types.js";
import { cards, combo } from "./fixtures.js";

const ON = DEFAULT_HOUSE_RULES;
const OFF = { ...DEFAULT_HOUSE_RULES, tenDiscard: false };

const single10 = combo(["S-10"]);
const pair10 = combo(["S-10", "H-10"]);

describe("the trigger (§6)", () => {
  it("fires on a resolved rank of 10, including a bound joker (§5.4)", () => {
    expect(firesTenDiscard(single10, ON)).toBe(true);
    expect(firesTenDiscard(combo(["JKR-1", "S-10"]), ON)).toBe(true);
  });

  it("does not fire on another rank, or with the rule off", () => {
    expect(firesTenDiscard(combo(["S-11"]), ON)).toBe(false);
    expect(firesTenDiscard(single10, OFF)).toBe(false);
  });
});

describe("k = min(D, cards remaining) (§6)", () => {
  it("is the combo count when the hand is long enough", () => {
    expect(tenDiscardCount(pair10, 4)).toBe(2);
  });

  it("is the remaining hand when it is shorter (§7.3)", () => {
    expect(tenDiscardCount(pair10, 1)).toBe(1);
  });

  it("is zero when the 10s were the last cards", () => {
    expect(tenDiscardCount(pair10, 0)).toBe(0);
  });
});

describe("the pending action (§7.1 Phase B)", () => {
  it("halts the pipeline with the owing player and the count", () => {
    expect(tenDiscardPending(pair10, "p0", 5, ON)).toEqual({
      type: "RESOLVE_10_DISCARD",
      count: 2,
      playerId: "p0",
    });
  });

  it("is null when k is 0, or with the rule off", () => {
    expect(tenDiscardPending(pair10, "p0", 0, ON)).toBeNull();
    expect(tenDiscardPending(pair10, "p0", 5, OFF)).toBeNull();
  });
});

describe("resolving the discard (§7.2)", () => {
  const pending: PendingAction = { type: "RESOLVE_10_DISCARD", count: 2, playerId: "p0" };
  const hand = cards("S-3", "H-4", "D-5", "C-6");

  it("moves the selected cards out of the hand and into the graveyard", () => {
    const result = resolveTenDiscard(pending, "p0", ["H-4", "C-6"], hand);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.discarded.map((c) => c.id)).toEqual(["H-4", "C-6"]);
    expect(result.value.remaining.map((c) => c.id)).toEqual(["S-3", "D-5"]);
  });

  it("rejects a non-active player: only the player who owes it may discard", () => {
    const result = resolveTenDiscard(pending, "p1", ["H-4", "C-6"], hand);
    expect(result).toEqual({ ok: false, error: "NOT_YOUR_TURN" });
  });

  it("rejects the wrong number of cards", () => {
    const result = resolveTenDiscard(pending, "p0", ["H-4"], hand);
    expect(result).toEqual({ ok: false, error: "WRONG_CARD_COUNT" });
  });

  it("rejects a card the player does not hold", () => {
    const result = resolveTenDiscard(pending, "p0", ["H-4", "C-9"], hand);
    expect(result).toEqual({ ok: false, error: "CARD_NOT_IN_HAND" });
  });

  it("rejects the same card twice", () => {
    const result = resolveTenDiscard(pending, "p0", ["H-4", "H-4"], hand);
    expect(result).toEqual({ ok: false, error: "DUPLICATE_CARD_IDS" });
  });

  it("rejects the wrong pending action", () => {
    const sevenPass: PendingAction = {
      type: "RESOLVE_7_PASS",
      count: 2,
      sourcePlayerId: "p0",
      targetPlayerId: "p1",
    };
    const result = resolveTenDiscard(sevenPass, "p0", ["H-4", "C-6"], hand);
    expect(result).toEqual({ ok: false, error: "WRONG_PENDING_ACTION" });
  });
});
