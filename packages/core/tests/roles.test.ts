/**
 * §12.5 tests 33-36: roles, exchange pairing, and forced selection (§4).
 *
 * The pairing counts are asserted against the §4.2 table verbatim for N = 3
 * through 8 rather than against a re-derivation of the formula, so a wrong
 * formula cannot agree with a wrong expectation.
 */
import { describe, expect, it } from "vitest";
import { SPADE_3_ID } from "../src/deck.js";
import {
  EXCHANGE_DURATION_MS,
  applyExchange,
  assignRoles,
  autoFillExchange,
  createExchangeState,
  exchangePairs,
  finishOrderOf,
  forcedSelection,
  isExchangeComplete,
  needsExchange,
  submitExchange,
  weakestSelection,
} from "../src/roles.js";
import type { Card, ExchangeState, Role } from "../src/types.js";
import { cards } from "./fixtures.js";

/** `p0..p{n-1}` in finish order, best first. */
function finishers(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `p${i}`);
}

function kinds(count: number): string[] {
  const roles = assignRoles(finishers(count));
  return finishers(count).map((id) => (roles[id] as Role).kind);
}

/** The §4.2 table as `"topRank↔bottomRank:count"` strings, top pair first. */
function pairTable(count: number): string[] {
  const order = finishers(count);
  return exchangePairs(order).map(
    (pair) => `${order.indexOf(pair.richId) + 1}↔${order.indexOf(pair.poorId) + 1}:${pair.count}`,
  );
}

describe("role assignment (§4.1)", () => {
  it("collapses to DAI_FUGO / HEIMIN(1) / DAI_HINMIN at N = 3", () => {
    expect(kinds(3)).toEqual(["DAI_FUGO", "HEIMIN", "DAI_HINMIN"]);
    expect(assignRoles(finishers(3))["p1"]).toEqual({ kind: "HEIMIN", rank: 1 });
  });

  it("has no HEIMIN at N = 4: the four named roles fill the table", () => {
    expect(kinds(4)).toEqual(["DAI_FUGO", "FUGO", "HINMIN", "DAI_HINMIN"]);
  });

  it("numbers HEIMIN from the top, 1-indexed", () => {
    const roles = assignRoles(finishers(6));
    expect(roles["p2"]).toEqual({ kind: "HEIMIN", rank: 1 });
    expect(roles["p3"]).toEqual({ kind: "HEIMIN", rank: 2 });
    expect(kinds(6)).toEqual(["DAI_FUGO", "FUGO", "HEIMIN", "HEIMIN", "HINMIN", "DAI_HINMIN"]);
  });

  it("degenerates safely below three players", () => {
    expect(kinds(2)).toEqual(["DAI_FUGO", "DAI_HINMIN"]);
    expect(kinds(1)).toEqual(["DAI_FUGO"]);
    expect(assignRoles([])).toEqual({});
  });
});

describe("finish order (§4.1, §7.7)", () => {
  it("appends the final remaining player as last place", () => {
    expect(finishOrderOf(["p2", "p0"], ["p0", "p1", "p2"])).toEqual(["p2", "p0", "p1"]);
  });

  it("keeps every unfinished player, in seat order, at the bottom", () => {
    expect(finishOrderOf(["p3"], ["p0", "p1", "p2", "p3"])).toEqual(["p3", "p0", "p1", "p2"]);
  });
});

/** §12.5 test 33. */
describe("exchange pairing counts (§4.2)", () => {
  it("matches the §4.2 table for N = 3 through 8", () => {
    expect(pairTable(3)).toEqual(["1↔3:1"]);
    expect(pairTable(4)).toEqual(["1↔4:2", "2↔3:1"]);
    expect(pairTable(5)).toEqual(["1↔5:2", "2↔4:1"]);
    expect(pairTable(6)).toEqual(["1↔6:3", "2↔5:2", "3↔4:1"]);
    expect(pairTable(7)).toEqual(["1↔7:3", "2↔6:2", "3↔5:1"]);
    expect(pairTable(8)).toEqual(["1↔8:4", "2↔7:3", "3↔6:2", "4↔5:1"]);
  });

  it("leaves the exact middle player out at odd N", () => {
    for (const count of [3, 5, 7]) {
      const paired = exchangePairs(finishers(count)).flatMap((p) => [p.richId, p.poorId]);
      expect(paired).not.toContain(`p${(count - 1) / 2}`);
      expect(paired).toHaveLength(count - 1);
    }
  });
});

describe("forced selection (§4.3)", () => {
  /** §12.5 test 34. */
  it("takes the strongest cards and never the 3 of Spades", () => {
    const hand = cards("S-3", "D-2", "H-13", "C-4", "JKR-1");
    expect(forcedSelection(hand, 3)).toEqual(["JKR-1", "D-2", "H-13"]);
    expect(forcedSelection(hand, 4)).not.toContain(SPADE_3_ID);
  });

  it("uses the standard order: revolution does not carry across rounds (§4.3)", () => {
    // Under revolution the 4 would be the strongest card in this hand.
    expect(forcedSelection(cards("C-4", "D-2"), 1)).toEqual(["D-2"]);
  });

  it("falls back to the 3 of Spades only when the hand holds nothing else", () => {
    expect(forcedSelection(cards("S-3", "H-5"), 2)).toEqual(["H-5", "S-3"]);
    expect(forcedSelection(cards("S-3"), 1)).toEqual(["S-3"]);
  });

  it("never returns more cards than the hand holds", () => {
    expect(forcedSelection(cards("H-5"), 3)).toEqual(["H-5"]);
  });
});

describe("weakest selection, the timeout auto-give (§4.4)", () => {
  it("takes the weakest cards in the standard order", () => {
    expect(weakestSelection(cards("S-3", "D-2", "H-13", "C-4"), 2)).toEqual(["S-3", "C-4"]);
  });

  it("does not exclude the 3 of Spades: only forced selection does", () => {
    expect(weakestSelection(cards("S-3", "H-5"), 1)).toEqual([SPADE_3_ID]);
  });
});

describe("round 1 (§4.3)", () => {
  /** §12.5 test 36. */
  it("skips the exchange", () => {
    expect(needsExchange(1)).toBe(false);
    expect(needsExchange(2)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The phase, end to end                                                      */
/* -------------------------------------------------------------------------- */

const ORDER = ["rich", "mid", "poor"];

/** A three-player table: `rich` <-> `poor` swap one card, `mid` sits out. */
function threeHanded(): { hands: Record<string, Card[]>; exchange: ExchangeState } {
  const hands: Record<string, Card[]> = {
    rich: cards("S-3", "H-4", "D-5"),
    mid: cards("C-6", "S-7", "H-8"),
    poor: cards("D-9", "C-10", "S-2"),
  };
  return { hands, exchange: createExchangeState(ORDER, hands) };
}

describe("exchange state at phase start (§4.3)", () => {
  it("owes both sides the pair count and points each at their partner", () => {
    const { exchange } = threeHanded();
    expect(exchange.required).toEqual({ rich: 1, poor: 1 });
    expect(exchange.partner).toEqual({ rich: "poor", poor: "rich" });
    expect(exchange.submitted).toEqual({});
  });

  it("pre-computes the poor side only, so they have nothing to submit", () => {
    const { exchange } = threeHanded();
    expect(exchange.forced).toEqual({ poor: ["S-2"] });
  });

  it("is empty for a table with no pairs", () => {
    const exchange = createExchangeState(["solo"], { solo: cards("S-3") });
    expect(exchange.required).toEqual({});
    expect(isExchangeComplete(exchange)).toBe(true);
  });
});

describe("submission (§4.3, §8.0)", () => {
  it("records a rich player's choice and completes the phase", () => {
    const { hands, exchange } = threeHanded();
    const result = submitExchange(exchange, "rich", ["D-5"], hands["rich"] as Card[]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isExchangeComplete(exchange)).toBe(false);
    expect(isExchangeComplete(result.value)).toBe(true);
    expect(exchange.submitted).toEqual({});
  });

  it("rejects the poor side: their selection is forced", () => {
    const { hands, exchange } = threeHanded();
    const result = submitExchange(exchange, "poor", ["D-9"], hands["poor"] as Card[]);
    expect(result).toEqual({ ok: false, error: "EXCHANGE_FORCED" });
  });

  it("rejects a player who is not in the exchange", () => {
    const { hands, exchange } = threeHanded();
    const result = submitExchange(exchange, "mid", ["C-6"], hands["mid"] as Card[]);
    expect(result).toEqual({ ok: false, error: "NOT_EXCHANGE_PARTICIPANT" });
  });

  it("rejects the wrong count, an unheld card, and a second submission", () => {
    const { hands, exchange } = threeHanded();
    const hand = hands["rich"] as Card[];
    expect(submitExchange(exchange, "rich", ["S-3", "H-4"], hand)).toEqual({
      ok: false,
      error: "WRONG_CARD_COUNT",
    });
    expect(submitExchange(exchange, "rich", ["C-10"], hand)).toEqual({
      ok: false,
      error: "CARD_NOT_IN_HAND",
    });

    const first = submitExchange(exchange, "rich", ["S-3"], hand);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(submitExchange(first.value, "rich", ["H-4"], hand)).toEqual({
      ok: false,
      error: "EXCHANGE_ALREADY_SUBMITTED",
    });
  });
});

describe("the deadline (§4.4)", () => {
  it("is 60 seconds", () => {
    expect(EXCHANGE_DURATION_MS).toBe(60_000);
  });

  /** §12.5 test 35. */
  it("auto-gives an unsubmitted rich player's weakest cards", () => {
    const { hands, exchange } = threeHanded();
    const filled = autoFillExchange(exchange, hands);
    expect(filled.submitted).toEqual({ rich: ["S-3"] });
    expect(isExchangeComplete(filled)).toBe(true);
  });

  it("leaves a submission that already arrived alone", () => {
    const { hands, exchange } = threeHanded();
    const submitted = submitExchange(exchange, "rich", ["D-5"], hands["rich"] as Card[]);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(autoFillExchange(submitted.value, hands).submitted).toEqual({ rich: ["D-5"] });
  });
});

describe("application (§4.3)", () => {
  it("moves both directions at once and conserves every card", () => {
    const { hands, exchange } = threeHanded();
    const result = applyExchange(autoFillExchange(exchange, hands), hands);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const next = result.value;
    expect(next["rich"]?.map((c) => c.id)).toEqual(["H-4", "D-5", "S-2"]);
    expect(next["poor"]?.map((c) => c.id)).toEqual(["D-9", "C-10", "S-3"]);
    expect(next["mid"]).toEqual(hands["mid"]);

    const before = Object.values(hands)
      .flat()
      .map((c) => c.id);
    const after = Object.values(next)
      .flat()
      .map((c) => c.id);
    expect([...after].sort()).toEqual([...before].sort());
    expect(hands["rich"]?.map((c) => c.id)).toEqual(["S-3", "H-4", "D-5"]);
  });

  it("applies the multi-pair table atomically", () => {
    const order = ["a", "b", "c", "d"];
    const hands: Record<string, Card[]> = {
      a: cards("S-3", "H-4", "D-5", "C-6"),
      b: cards("S-7", "H-8", "D-9", "C-10"),
      c: cards("S-11", "H-12", "D-13", "C-1"),
      d: cards("S-2", "H-2", "D-2", "C-2"),
    };
    const exchange = createExchangeState(order, hands);
    expect(exchange.required).toEqual({ a: 2, d: 2, b: 1, c: 1 });
    expect(exchange.forced).toEqual({ d: ["C-2", "D-2"], c: ["C-1"] });

    const filled = autoFillExchange(exchange, hands);
    const result = applyExchange(filled, hands);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ids = (playerId: string) => result.value[playerId]?.map((c) => c.id);
    expect(ids("a")).toEqual(["D-5", "C-6", "D-2", "C-2"]);
    expect(ids("d")).toEqual(["S-2", "H-2", "S-3", "H-4"]);
    expect(ids("b")).toEqual(["H-8", "D-9", "C-10", "C-1"]);
    expect(ids("c")).toEqual(["S-11", "H-12", "D-13", "S-7"]);
  });

  it("auto-gives for a rich player who never submitted, as the deadline would (§4.4)", () => {
    const { hands, exchange } = threeHanded();
    const result = applyExchange(exchange, hands);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value["poor"]?.map((c) => c.id)).toEqual(["D-9", "C-10", "S-3"]);
  });
});
