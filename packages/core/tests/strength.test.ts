/** §12.1 test 1: standard order, inverted order, `effectiveInverted` XOR truth table. */
import { describe, expect, it } from "vitest";
import {
  JOKER_STRENGTH,
  STRENGTH_INDEX,
  cardStrength,
  compareStrength,
  effectiveInverted,
  isStronger,
  sortByStrength,
  strengthOf,
} from "../src/strength.js";
import { createDeck } from "../src/deck.js";
import type { Card, Rank } from "../src/types.js";

/** §5.1, written out literally so a table edit has to be deliberate. */
const SPEC_ORDER: Rank[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 1, 2];

function card(id: string): Card {
  const found = createDeck().find((c) => c.id === id);
  if (found === undefined) throw new Error(`no such card: ${id}`);
  return found;
}

describe("strength index (§5.1)", () => {
  it("maps 3 through 2 onto 0 through 12", () => {
    SPEC_ORDER.forEach((rank, index) => {
      expect(STRENGTH_INDEX[rank]).toBe(index);
      expect(strengthOf(rank)).toBe(index);
    });
  });

  it("ranks the pure joker above every numbered rank", () => {
    expect(JOKER_STRENGTH).toBe(13);
    expect(strengthOf(null)).toBe(JOKER_STRENGTH);
    for (const rank of SPEC_ORDER) {
      expect(strengthOf(rank)).toBeLessThan(JOKER_STRENGTH);
    }
  });

  it("reads a card's strength from its rank, and a joker's as pure", () => {
    expect(cardStrength(card("S-3"))).toBe(0);
    expect(cardStrength(card("H-1"))).toBe(11); // Ace is 11, not 0
    expect(cardStrength(card("D-2"))).toBe(12);
    expect(cardStrength(card("C-11"))).toBe(8); // Jack
    expect(cardStrength(card("JKR-1"))).toBe(JOKER_STRENGTH);
    expect(cardStrength(card("JKR-2"))).toBe(JOKER_STRENGTH);
  });

  it("is monotonic across the whole deck: suit never affects strength", () => {
    for (const rank of SPEC_ORDER) {
      const strengths = (["S", "H", "D", "C"] as const).map((suit) =>
        cardStrength(card(`${suit}-${rank}`)),
      );
      expect(new Set(strengths).size).toBe(1);
    }
  });
});

describe("effectiveInverted (§5.2)", () => {
  it("is the XOR of isRevolution and trickInverted", () => {
    expect(effectiveInverted(false, false)).toBe(false);
    expect(effectiveInverted(true, false)).toBe(true);
    expect(effectiveInverted(false, true)).toBe(true);
    expect(effectiveInverted(true, true)).toBe(false);
  });
});

describe("comparison (§5.2)", () => {
  it("orders by index in the standard orientation", () => {
    expect(compareStrength(5, 3, false)).toBeGreaterThan(0);
    expect(compareStrength(3, 5, false)).toBeLessThan(0);
    expect(compareStrength(4, 4, false)).toBe(0);
    expect(isStronger(strengthOf(2), strengthOf(13), false)).toBe(true);
    expect(isStronger(strengthOf(3), strengthOf(2), false)).toBe(false);
  });

  it("reverses the order when inverted", () => {
    expect(compareStrength(5, 3, true)).toBeLessThan(0);
    expect(compareStrength(3, 5, true)).toBeGreaterThan(0);
    expect(compareStrength(4, 4, true)).toBe(0);
    expect(isStronger(strengthOf(3), strengthOf(2), true)).toBe(true);
    expect(isStronger(strengthOf(2), strengthOf(3), true)).toBe(false);
  });

  it("makes the pure joker the weakest card under revolution (§5.2)", () => {
    for (const rank of SPEC_ORDER) {
      expect(isStronger(strengthOf(rank), JOKER_STRENGTH, true)).toBe(true);
      expect(isStronger(strengthOf(rank), JOKER_STRENGTH, false)).toBe(false);
    }
  });

  it("is never strictly stronger than itself, in either orientation", () => {
    for (const inverted of [false, true]) {
      for (let index = 0; index <= JOKER_STRENGTH; index++) {
        expect(isStronger(index, index, inverted)).toBe(false);
      }
    }
  });
});

describe("sortByStrength", () => {
  it("orders weakest first in the standard orientation", () => {
    const hand = [card("JKR-1"), card("S-3"), card("H-2"), card("D-8")];
    expect(sortByStrength(hand, false).map((c) => c.id)).toEqual(["S-3", "D-8", "H-2", "JKR-1"]);
  });

  it("orders weakest first under inversion, putting the joker at the bottom", () => {
    const hand = [card("JKR-1"), card("S-3"), card("H-2"), card("D-8")];
    expect(sortByStrength(hand, true).map((c) => c.id)).toEqual(["JKR-1", "H-2", "D-8", "S-3"]);
  });

  it("breaks ties deterministically and does not mutate its input", () => {
    const hand = [card("C-5"), card("S-5"), card("D-5"), card("H-5")];
    const before = hand.map((c) => c.id);
    const once = sortByStrength(hand, false).map((c) => c.id);
    const twice = sortByStrength([...hand].reverse(), false).map((c) => c.id);
    expect(once).toEqual(twice);
    expect(hand.map((c) => c.id)).toEqual(before);
  });
});
