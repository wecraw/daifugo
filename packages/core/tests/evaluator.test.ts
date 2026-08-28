/**
 * The evaluator (§5, §6, §10.3): legality against the trick top, comparison under
 * `effectiveInverted`, the suit lock, and legal-move generation.
 *
 * The Spade-3 counter has its own file (§12.1 test 2, `spade3.test.ts`); the
 * shibari rule file (§12.1 test 8) covers *setting* the lock, while matching an
 * already-set lock is the evaluator's and is covered here.
 */
import { describe, expect, it } from "vitest";
import { parseCombo } from "../src/combo.js";
import { createDeck } from "../src/deck.js";
import {
  canBeat,
  checkLegality,
  createLegalMoveCache,
  generateLegalMoves,
  hasLegalMove,
  legalMovesKey,
  matchesSuitLock,
} from "../src/evaluator.js";
import type { Card, JokerBinding, PlayCombo, Rank, Suit } from "../src/types.js";

const DECK = createDeck();

function card(id: string): Card {
  const found = DECK.find((c) => c.id === id);
  if (found === undefined) throw new Error(`no such card: ${id}`);
  return found;
}

function cards(...ids: string[]): Card[] {
  return ids.map(card);
}

function bind(cardId: string, rank: Rank, suit: Suit): JokerBinding {
  return { cardId, rank, suit };
}

function combo(ids: string[], bindings?: JokerBinding[]): PlayCombo {
  const result = parseCombo(cards(...ids), bindings);
  if (!result.ok) throw new Error(`bad fixture: ${result.error}`);
  return result.value;
}

/** Every generated move as a sorted card-id string, for order-free assertions. */
function moveIds(moves: readonly PlayCombo[]): string[] {
  return moves.map((move) =>
    move.cards
      .map((c) => c.id)
      .slice()
      .sort()
      .join("+"),
  );
}

function reason(candidate: PlayCombo, ctx: Parameters<typeof checkLegality>[1]): string | null {
  const result = checkLegality(candidate, ctx);
  return result.ok ? null : result.error;
}

describe("comparison against the trick top (§5.1, §5.3)", () => {
  it("lets anything lead an empty trick", () => {
    expect(canBeat(null, combo(["S-3"]), {})).toBe(true);
    expect(reason(combo(["S-3", "H-3"]), { top: null })).toBeNull();
  });

  it("compares by the strength index of the resolved rank", () => {
    const top = combo(["S-8"]);
    expect(canBeat(top, combo(["H-9"]), { top })).toBe(true);
    expect(canBeat(top, combo(["H-7"]), { top })).toBe(false);
  });

  it("does not treat equal strength as a beat", () => {
    const top = combo(["S-8"]);
    expect(canBeat(top, combo(["H-8"]), { top })).toBe(false);
    expect(reason(combo(["H-8"]), { top })).toBe("TOO_WEAK");
  });

  it("reads the Ace and the Two as the top of the order, not as 1 and 2", () => {
    const top = combo(["S-13"]);
    expect(canBeat(top, combo(["H-1"]), { top })).toBe(true);
    expect(canBeat(top, combo(["H-2"]), { top })).toBe(true);
    expect(canBeat(combo(["S-1"]), combo(["H-2"]), { top: combo(["S-1"]) })).toBe(true);
  });

  it("requires the count to match the top exactly", () => {
    const top = combo(["S-8", "H-8"]);
    expect(reason(combo(["S-9"]), { top })).toBe("COMBO_COUNT_MISMATCH");
    expect(reason(combo(["S-9", "H-9", "D-9"]), { top })).toBe("COMBO_COUNT_MISMATCH");
    expect(reason(combo(["S-9", "H-9"]), { top })).toBeNull();
  });

  it("reports the count mismatch before the strength, so the reason is the honest one", () => {
    // §10.6 renders the reason inline: "wrong number of cards" beats "not high
    // enough" when the selection is both.
    expect(reason(combo(["S-3"]), { top: combo(["S-8", "H-8"]) })).toBe("COMBO_COUNT_MISMATCH");
  });

  it("ranks a pure joker above every numbered card, and a bound one as its rank", () => {
    const top = combo(["S-2"]);
    expect(canBeat(top, combo(["JKR-1"]), { top })).toBe(true);
    expect(canBeat(top, combo(["JKR-1"], [bind("JKR-1", 4, "H")]), { top })).toBe(false);
  });
});

describe("effectiveInverted (§5.2)", () => {
  const top = combo(["S-8"]);

  it("reverses the order under revolution", () => {
    expect(canBeat(top, combo(["H-7"]), { top, isRevolution: true })).toBe(true);
    expect(canBeat(top, combo(["H-9"]), { top, isRevolution: true })).toBe(false);
  });

  it("reverses the order under 11-back", () => {
    expect(canBeat(top, combo(["H-7"]), { top, trickInverted: true })).toBe(true);
    expect(canBeat(top, combo(["H-9"]), { top, trickInverted: true })).toBe(false);
  });

  it("cancels when both are set: the XOR is upright again", () => {
    const ctx = { top, isRevolution: true, trickInverted: true };
    expect(canBeat(top, combo(["H-9"]), ctx)).toBe(true);
    expect(canBeat(top, combo(["H-7"]), ctx)).toBe(false);
  });

  it("makes the pure joker the weakest card while inverted", () => {
    const overTwo = combo(["S-2"]);
    expect(canBeat(overTwo, combo(["JKR-1"]), { top: overTwo, isRevolution: true })).toBe(false);
    const overJoker = combo(["JKR-1"]);
    expect(canBeat(overJoker, combo(["H-4"]), { top: overJoker, isRevolution: true })).toBe(true);
  });
});

describe("shibari: matching an active suit lock (§6)", () => {
  const top = combo(["S-7"]);
  const lock: Suit[] = ["H"];

  it("accepts an exact match and rejects anything else", () => {
    expect(reason(combo(["H-9"]), { top, suitLock: lock })).toBeNull();
    expect(reason(combo(["D-9"]), { top, suitLock: lock })).toBe("SUIT_LOCK_MISMATCH");
  });

  it("locks on the exact multiset, so overlap is not a partial match", () => {
    const pairTop = combo(["S-7", "H-7"]);
    const mixed: Suit[] = ["H", "S"];
    expect(reason(combo(["H-9", "S-9"]), { top: pairTop, suitLock: mixed })).toBeNull();
    expect(reason(combo(["H-9", "D-9"]), { top: pairTop, suitLock: mixed })).toBe(
      "SUIT_LOCK_MISMATCH",
    );
    expect(reason(combo(["H-9", "C-9"]), { top: pairTop, suitLock: ["H", "H"] })).toBe(
      "SUIT_LOCK_MISMATCH",
    );
  });

  it("wildcards a pure joker through the lock", () => {
    expect(reason(combo(["JKR-1"]), { top, suitLock: lock })).toBeNull();
    // A pure joker fills whichever slot the bound suits did not claim. Beside a
    // numbered card a joker is always bound (§5.3), so the pair here is both
    // jokers — the only pure play with a slot left over to fill.
    const pairTop = combo(["S-7", "H-7"]);
    expect(reason(combo(["JKR-1", "JKR-2"]), { top: pairTop, suitLock: ["H", "D"] })).toBeNull();
    const oneBound = combo(["JKR-1", "H-9"], [bind("JKR-1", 9, "D")]);
    expect(reason(oneBound, { top: pairTop, suitLock: ["H", "D"] })).toBeNull();
    expect(reason(oneBound, { top: pairTop, suitLock: ["H", "C"] })).toBe("SUIT_LOCK_MISMATCH");
  });

  it("holds a bound joker to its bound suit", () => {
    const asHeart = combo(["JKR-1"], [bind("JKR-1", 9, "H")]);
    const asDiamond = combo(["JKR-1"], [bind("JKR-1", 9, "D")]);
    expect(reason(asHeart, { top, suitLock: lock })).toBeNull();
    expect(reason(asDiamond, { top, suitLock: lock })).toBe("SUIT_LOCK_MISMATCH");
  });

  it("checks the lock after the strength, matching the Phase 0 order (§7.1)", () => {
    expect(reason(combo(["D-3"]), { top, suitLock: lock })).toBe("TOO_WEAK");
  });

  it("exposes the match as a helper the shibari rule can reuse", () => {
    expect(matchesSuitLock(combo(["H-9"]), ["H"])).toBe(true);
    expect(matchesSuitLock(combo(["H-9", "S-9"]), ["S", "H"])).toBe(true);
    expect(matchesSuitLock(combo(["H-9"]), ["H", "S"])).toBe(false);
  });
});

describe("generateLegalMoves (§10.3)", () => {
  it("offers every N-of-a-kind in the hand when leading", () => {
    const hand = cards("S-3", "H-3", "S-8");
    expect(moveIds(generateLegalMoves(hand, { top: null })).sort()).toEqual([
      "H-3",
      "H-3+S-3",
      "S-3",
      "S-8",
    ]);
  });

  it("never offers a mixed-rank combo: there are no sequences (§5.3)", () => {
    const moves = generateLegalMoves(cards("S-3", "H-4", "D-5"), { top: null });
    expect(moves.every((move) => move.resolvedRank !== null)).toBe(true);
    expect(moveIds(moves).sort()).toEqual(["D-5", "H-4", "S-3"]);
  });

  it("restricts the count to the trick top and drops anything too weak", () => {
    const hand = cards("S-3", "H-3", "S-9", "H-9", "D-9");
    const top = combo(["S-8", "H-8"]);
    // Only the pairs of 9s beat a pair of 8s; the pair of 3s is too weak and no
    // single or triple has the right count.
    expect(moveIds(generateLegalMoves(hand, { top })).sort()).toEqual([
      "D-9+H-9",
      "D-9+S-9",
      "H-9+S-9",
    ]);
  });

  it("enumerates the distinct suit subsets, which the suit lock can tell apart", () => {
    const hand = cards("S-9", "H-9", "D-9");
    const top = combo(["S-7"]);
    expect(moveIds(generateLegalMoves(hand, { top })).sort()).toEqual(["D-9", "H-9", "S-9"]);
    expect(moveIds(generateLegalMoves(hand, { top, suitLock: ["H"] }))).toEqual(["H-9"]);
  });

  it("expands joker bindings, and binds each set to its strongest legal form (§5.5)", () => {
    const hand = cards("JKR-1", "H-8");
    const top = combo(["S-7"]);
    const moves = generateLegalMoves(hand, { top });
    expect(moveIds(moves).sort()).toEqual(["H-8", "JKR-1"]);
    // Led over a 7, the lone joker is strongest played pure.
    const jokerMove = moves.find((move) => move.cards.length === 1 && move.cards[0]?.isJoker);
    expect(jokerMove?.isPureJokerPlay).toBe(true);
  });

  it("binds a joker to satisfy an active suit lock rather than dropping the move", () => {
    const hand = cards("JKR-1", "H-8");
    const top = combo(["S-7", "H-7"]);
    const moves = generateLegalMoves(hand, { top, suitLock: ["H", "D"] });
    expect(moveIds(moves)).toEqual(["H-8+JKR-1"]);
    expect(moves[0]?.suits.slice().sort()).toEqual(["D", "H"]);
  });

  it("pairs the two jokers, and binds them when pure cannot win", () => {
    const pure = generateLegalMoves(cards("JKR-1", "JKR-2"), { top: combo(["S-2", "H-2"]) });
    expect(moveIds(pure)).toEqual(["JKR-1+JKR-2"]);
    expect(pure[0]?.isPureJokerPlay).toBe(true);

    const inverted = generateLegalMoves(cards("JKR-1", "JKR-2"), {
      top: combo(["S-6", "H-6"]),
      isRevolution: true,
    });
    expect(inverted[0]?.resolvedRank).toBe(3);
  });

  it("includes the 3 of Spades over a single pure joker (§6)", () => {
    const hand = cards("S-3", "H-3");
    const top = combo(["JKR-1"]);
    expect(moveIds(generateLegalMoves(hand, { top }))).toEqual(["S-3"]);
  });

  it("distinguishes an empty legal set from 'nothing good' (§10.7)", () => {
    const hand = cards("S-3", "H-4");
    expect(generateLegalMoves(hand, { top: combo(["S-2"]) })).toEqual([]);
    expect(hasLegalMove(hand, { top: combo(["S-2"]) })).toBe(false);

    // Nothing good, but not nothing: the 4 is legal over the 3.
    const weak = generateLegalMoves(hand, { top: combo(["D-3"]) });
    expect(moveIds(weak)).toEqual(["H-4"]);
    expect(hasLegalMove(hand, { top: combo(["D-3"]) })).toBe(true);
  });

  it("is never empty when leading with cards in hand, and is empty for an empty hand", () => {
    expect(generateLegalMoves(cards("S-3"), { top: null }).length).toBe(1);
    expect(generateLegalMoves([], { top: null })).toEqual([]);
    expect(hasLegalMove([], { top: null })).toBe(false);
  });

  it("orders the moves weakest first under the effective orientation", () => {
    const hand = cards("S-3", "H-9", "D-13");
    const upright = generateLegalMoves(hand, { top: null });
    expect(moveIds(upright)).toEqual(["S-3", "H-9", "D-13"]);
    const inverted = generateLegalMoves(hand, { top: null, isRevolution: true });
    expect(moveIds(inverted)).toEqual(["D-13", "H-9", "S-3"]);
  });

  it("returns only combos that pass checkLegality", () => {
    const hand = cards("JKR-1", "S-9", "H-9", "D-9", "S-3", "H-11");
    const ctx = { top: combo(["S-8", "H-8"]), trickInverted: false } as const;
    for (const move of generateLegalMoves(hand, ctx)) {
      expect(checkLegality(move, ctx).ok).toBe(true);
    }
  });

  it("handles an 18-card hand fast enough to run per turn (§10.3)", () => {
    const hand = DECK.slice(0, 16).concat(cards("JKR-1", "JKR-2"));
    const started = performance.now();
    for (let i = 0; i < 20; i++) generateLegalMoves(hand, { top: null });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("never mutates the hand and returns frozen combos", () => {
    const hand = cards("S-9", "H-9");
    const snapshot = hand.map((c) => c.id);
    const moves = generateLegalMoves(hand, { top: null });
    expect(hand.map((c) => c.id)).toEqual(snapshot);
    expect(moves.every((move) => Object.isFrozen(move))).toBe(true);
  });
});

describe("memoisation on (hand, trickTop, isRevolution, trickInverted, suitLock) (§10.3)", () => {
  const hand = cards("S-9", "H-9", "JKR-1");

  it("keys equal inputs together and different inputs apart", () => {
    const top = combo(["S-8"]);
    expect(legalMovesKey(hand, { top })).toBe(legalMovesKey(cards("H-9", "S-9", "JKR-1"), { top }));
    expect(legalMovesKey(hand, { top })).not.toBe(legalMovesKey(hand, { top: null }));
    expect(legalMovesKey(hand, { top })).not.toBe(legalMovesKey(hand, { top: combo(["H-8"]) }));
    expect(legalMovesKey(hand, { top })).not.toBe(legalMovesKey(hand, { top, isRevolution: true }));
    expect(legalMovesKey(hand, { top })).not.toBe(
      legalMovesKey(hand, { top, trickInverted: true }),
    );
    expect(legalMovesKey(hand, { top })).not.toBe(legalMovesKey(hand, { top, suitLock: ["H"] }));
    expect(legalMovesKey(hand, { top: combo(["JKR-1"]) })).not.toBe(
      legalMovesKey(hand, { top: combo(["JKR-1"], [bind("JKR-1", 9, "S")]) }),
    );
  });

  it("returns the identical array for a repeated lookup", () => {
    const cache = createLegalMoveCache();
    const top = combo(["S-8"]);
    const first = cache(hand, { top });
    expect(cache(cards("H-9", "S-9", "JKR-1"), { top })).toBe(first);
    expect(cache(hand, { top, isRevolution: true })).not.toBe(first);
    expect(moveIds(first)).toEqual(moveIds(generateLegalMoves(hand, { top })));
  });
});
