/** §3 deck, seeded shuffle, dealing, seating rotation. §12.5 tests 31 and 32. */
import { describe, expect, it } from "vitest";
import {
  DECK_SIZE,
  DIAMOND_3_ID,
  JOKER_IDS,
  RANKS,
  SPADE_3_ID,
  SUITS,
  cardId,
  createDeck,
  createRng,
  deal,
  findCardHolder,
  openingLeaderId,
  pickDealerIndex,
  reseat,
  shuffle,
} from "../src/deck.js";
import type { Card } from "../src/types.js";

/** The head of the "daifugo-pin" shuffle; see the pin test below. */
const PINNED_HEAD = ["C-6", "C-8", "S-2", "H-2", "JKR-1", "D-11", "S-4", "D-1"];

function seats(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `p${i}`);
}

function handOf(hands: Record<string, Card[]>, playerId: string): Card[] {
  const hand = hands[playerId];
  if (hand === undefined) throw new Error(`no hand dealt to ${playerId}`);
  return hand;
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no element at ${index}`);
  return item;
}

function ids(cards: readonly Card[]): string[] {
  return cards.map((c) => c.id);
}

describe("createDeck (§3.1)", () => {
  it("is 54 cards with unique ids", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(DECK_SIZE);
    expect(DECK_SIZE).toBe(54);
    expect(new Set(ids(deck)).size).toBe(54);
  });

  it("is 13 of each suit plus two jokers", () => {
    const deck = createDeck();
    for (const suit of SUITS) {
      expect(deck.filter((c) => c.suit === suit)).toHaveLength(13);
    }
    const jokers = deck.filter((c) => c.isJoker);
    expect(ids(jokers)).toEqual([...JOKER_IDS]);
    expect(jokers.every((c) => c.suit === null && c.rank === null)).toBe(true);
  });

  it("uses the id format from §2", () => {
    expect(ids(createDeck())).toContain("S-3");
    expect(ids(createDeck())).toContain("H-11");
    expect(cardId("D", 3)).toBe(DIAMOND_3_ID);
    expect(cardId("S", 3)).toBe(SPADE_3_ID);
    for (const card of createDeck()) {
      if (card.isJoker) continue;
      expect(card.id).toBe(`${card.suit}-${card.rank}`);
    }
  });

  it("covers every rank in every suit", () => {
    const deck = createDeck();
    expect(RANKS).toHaveLength(13);
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        expect(ids(deck)).toContain(cardId(suit, rank));
      }
    }
  });

  it("returns a fresh array each call, so a caller cannot poison the deck", () => {
    const first = createDeck();
    first.pop();
    expect(createDeck()).toHaveLength(DECK_SIZE);
  });
});

describe("seeded shuffle (§2: all randomness enters via START_GAME.seed)", () => {
  it("gives an identical permutation for the same seed, always", () => {
    const a = shuffle(createDeck(), createRng("seed-alpha"));
    const b = shuffle(createDeck(), createRng("seed-alpha"));
    expect(ids(a)).toEqual(ids(b));
  });

  it("gives a different permutation for a different seed", () => {
    const a = shuffle(createDeck(), createRng("seed-alpha"));
    const b = shuffle(createDeck(), createRng("seed-beta"));
    expect(ids(a)).not.toEqual(ids(b));
  });

  it("permutes rather than losing or duplicating cards", () => {
    const shuffled = shuffle(createDeck(), createRng("conservation"));
    expect(shuffled).toHaveLength(DECK_SIZE);
    expect(new Set(ids(shuffled))).toEqual(new Set(ids(createDeck())));
  });

  it("actually reorders, and does not mutate its input", () => {
    const deck = createDeck();
    const before = ids(deck);
    const shuffled = shuffle(deck, createRng("reorder"));
    expect(ids(deck)).toEqual(before);
    expect(ids(shuffled)).not.toEqual(before);
  });

  it("pins the PRNG: this seed must deal this deck forever", () => {
    // A regression pin, not a spec rule. Changing the PRNG or the shuffle
    // direction breaks replay of any stored seed, so it has to be deliberate.
    const shuffled = shuffle(createDeck(), createRng("daifugo-pin"));
    expect(ids(shuffled).slice(0, 8)).toEqual(PINNED_HEAD);
  });
});

describe("pickDealerIndex (§3.2 round 1)", () => {
  it("returns a seat index in range, deterministically per seed", () => {
    for (const count of [3, 4, 5, 6, 7, 8]) {
      const index = pickDealerIndex(count, createRng(`dealer-${count}`));
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(count);
      expect(Number.isInteger(index)).toBe(true);
      expect(pickDealerIndex(count, createRng(`dealer-${count}`))).toBe(index);
    }
  });
});

describe("deal (§3.3)", () => {
  it("deals one card at a time starting with the dealer, moving left", () => {
    const deck = createDeck();
    const order = seats(5);
    const hands = deal(deck, order, 0);
    order.forEach((playerId, seat) => {
      expect(at(handOf(hands, playerId), 0).id).toBe(at(deck, seat).id);
      expect(at(handOf(hands, playerId), 1).id).toBe(at(deck, seat + 5).id);
    });
  });

  it("starts at the dealer wherever they sit, and wraps left", () => {
    const deck = createDeck();
    const order = seats(4);
    const hands = deal(deck, order, 2);
    expect(at(handOf(hands, "p2"), 0).id).toBe(at(deck, 0).id);
    expect(at(handOf(hands, "p3"), 0).id).toBe(at(deck, 1).id);
    expect(at(handOf(hands, "p0"), 0).id).toBe(at(deck, 2).id);
    expect(at(handOf(hands, "p1"), 0).id).toBe(at(deck, 3).id);
  });

  it("exhausts the deck without losing or duplicating a card", () => {
    for (const count of [3, 4, 5, 6, 7, 8]) {
      const deck = shuffle(createDeck(), createRng(`conserve-${count}`));
      const hands = deal(deck, seats(count), 0);
      const dealt = Object.values(hands).flat();
      expect(dealt).toHaveLength(DECK_SIZE);
      expect(new Set(ids(dealt))).toEqual(new Set(ids(createDeck())));
    }
  });

  it("leaves hands uneven rather than compensating (§3.3)", () => {
    const hands = deal(createDeck(), seats(5), 0);
    expect(ids(handOf(hands, "p0"))).toHaveLength(11);
    expect(ids(handOf(hands, "p3"))).toHaveLength(11);
    expect(ids(handOf(hands, "p4"))).toHaveLength(10);
  });

  it("gives every player a hand even when the deck divides evenly", () => {
    const hands = deal(createDeck(), seats(6), 0);
    for (const playerId of seats(6)) {
      expect(handOf(hands, playerId)).toHaveLength(9);
    }
  });

  it("is deterministic for a given seed", () => {
    const order = seats(7);
    const first = deal(shuffle(createDeck(), createRng("same")), order, 3);
    const second = deal(shuffle(createDeck(), createRng("same")), order, 3);
    for (const playerId of order) {
      expect(ids(handOf(first, playerId))).toEqual(ids(handOf(second, playerId)));
    }
  });
});

describe("reseat (§3.2)", () => {
  it("seats the winner at N-1 and the last-place finisher as dealer at 0", () => {
    // §12.5 test 32.
    const finishOrder = ["winner", "second", "third", "fourth", "last"];
    const order = reseat(finishOrder);
    expect(at(order, order.length - 1)).toBe("winner");
    expect(at(order, 0)).toBe("last");
  });

  it("reads from the dealer as last, (N-1)th, ..., 2nd, 1st", () => {
    const finishOrder = ["a", "b", "c", "d", "e", "f"];
    expect(reseat(finishOrder)).toEqual(["f", "e", "d", "c", "b", "a"]);
  });

  it("keeps every player, changing only their order", () => {
    for (const count of [3, 4, 5, 6, 7, 8]) {
      const finishOrder = seats(count);
      const order = reseat(finishOrder);
      expect(order).toHaveLength(count);
      expect(new Set(order)).toEqual(new Set(finishOrder));
    }
  });

  it("does not mutate the finish order it was given", () => {
    const finishOrder = ["a", "b", "c"];
    reseat(finishOrder);
    expect(finishOrder).toEqual(["a", "b", "c"]);
  });
});

describe("reseat then deal (§12.5 test 31)", () => {
  it("deals the previous winner the fewest cards", () => {
    for (const count of [4, 5, 7, 8]) {
      const finishOrder = seats(count);
      const order = reseat(finishOrder);
      const hands = deal(shuffle(createDeck(), createRng(`round2-${count}`)), order, 0);

      const winner = at(finishOrder, 0);
      const dealer = at(finishOrder, count - 1);
      const sizes = order.map((playerId) => handOf(hands, playerId).length);

      expect(handOf(hands, winner)).toHaveLength(Math.min(...sizes));
      expect(handOf(hands, dealer)).toHaveLength(Math.max(...sizes));
      expect(handOf(hands, winner).length).toBeLessThan(handOf(hands, dealer).length);
    }
  });
});

describe("opening leader (§3.4)", () => {
  it("is the holder of the 3 of Diamonds", () => {
    const hands = deal(shuffle(createDeck(), createRng("opening")), seats(5), 0);
    const leader = openingLeaderId(hands);
    expect(leader).not.toBeNull();
    if (leader === null) return;
    expect(ids(handOf(hands, leader))).toContain(DIAMOND_3_ID);
  });

  it("finds exactly one holder for any card, over any deal", () => {
    for (const count of [3, 6, 8]) {
      const order = seats(count);
      const hands = deal(shuffle(createDeck(), createRng(`holder-${count}`)), order, 0);
      const holder = findCardHolder(hands, SPADE_3_ID);
      const holders = order.filter((p) => ids(handOf(hands, p)).includes(SPADE_3_ID));
      expect(holders).toEqual(holder === null ? [] : [holder]);
      expect(holder).not.toBeNull();
    }
  });

  it("returns null when nobody holds the card", () => {
    expect(findCardHolder({ p0: [], p1: [] }, DIAMOND_3_ID)).toBeNull();
    expect(openingLeaderId({})).toBeNull();
  });
});
