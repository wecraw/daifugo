/**
 * §12.1 test 10: mixed ranks rejected (no sequences); count must match the top
 * exactly; a pair of pure jokers is legal; a pure joker cannot pair with a
 * non-joker; both jokers must bind to the combo's rank.
 *
 * Plus the binding-validation and default-resolution halves of §5.4-§5.5, which
 * are the parts the server must never take on trust.
 */
import { describe, expect, it } from "vitest";
import { parseCombo } from "../src/combo.js";
import { createDeck } from "../src/deck.js";
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

/** A combo to sit on top of the trick. Built through the parser, never by hand. */
function top(ids: string[], bindings?: JokerBinding[]): PlayCombo {
  const result = parseCombo(cards(...ids), bindings);
  if (!result.ok) throw new Error(`bad fixture: ${result.error}`);
  return result.value;
}

function parsed(...args: Parameters<typeof parseCombo>): PlayCombo {
  const result = parseCombo(...args);
  if (!result.ok) throw new Error(`expected a legal combo, got ${result.error}`);
  return result.value;
}

function error(...args: Parameters<typeof parseCombo>): string {
  const result = parseCombo(...args);
  if (result.ok) throw new Error("expected the parse to fail");
  return result.error;
}

describe("N-of-a-kind is the only shape (§5.3)", () => {
  it("accepts a single, and reports rank, suits, and purity", () => {
    const combo = parsed(cards("S-3"));
    expect(combo.resolvedRank).toBe(3);
    expect(combo.suits).toEqual(["S"]);
    expect(combo.bindings).toEqual([]);
    expect(combo.isPureJokerPlay).toBe(false);
    expect(combo.cards.length).toBe(1);
  });

  it("accepts a pair, a triple, and a quad of one rank", () => {
    expect(parsed(cards("S-8", "H-8")).resolvedRank).toBe(8);
    expect(parsed(cards("S-8", "H-8", "D-8")).suits).toEqual(["S", "H", "D"]);
    expect(parsed(cards("S-8", "H-8", "D-8", "C-8")).cards.length).toBe(4);
  });

  it("rejects mixed ranks: there are no sequences", () => {
    expect(error(cards("S-3", "H-4"))).toBe("MIXED_RANKS");
    expect(error(cards("S-3", "H-4", "D-5"))).toBe("MIXED_RANKS");
    expect(error(cards("S-11", "H-12", "D-13"))).toBe("MIXED_RANKS");
  });

  it("rejects an empty selection and duplicated card ids", () => {
    expect(error([])).toBe("EMPTY_SELECTION");
    expect(error(cards("S-8", "S-8"))).toBe("DUPLICATE_CARD_IDS");
  });
});

describe("count must match the trick top exactly (§5.3)", () => {
  it("accepts an equal count", () => {
    expect(parsed(cards("S-9", "H-9"), undefined, { top: top(["S-8", "H-8"]) }).resolvedRank).toBe(
      9,
    );
  });

  it("rejects both a smaller and a larger count", () => {
    const pairOf8s = top(["S-8", "H-8"]);
    expect(error(cards("S-9"), undefined, { top: pairOf8s })).toBe("COMBO_COUNT_MISMATCH");
    expect(error(cards("S-9", "H-9", "D-9"), undefined, { top: pairOf8s })).toBe(
      "COMBO_COUNT_MISMATCH",
    );
  });

  it("does not constrain the count when leading", () => {
    expect(parsed(cards("S-9", "H-9", "D-9"), undefined, { top: null }).cards.length).toBe(3);
  });
});

describe("pure jokers (§5.3, §5.4)", () => {
  it("treats a lone joker as pure: rank null, suit null", () => {
    const combo = parsed(cards("JKR-1"));
    expect(combo.resolvedRank).toBeNull();
    expect(combo.suits).toEqual([null]);
    expect(combo.isPureJokerPlay).toBe(true);
    expect(combo.bindings).toEqual([]);
  });

  it("accepts two pure jokers as a pair", () => {
    const combo = parsed(cards("JKR-1", "JKR-2"));
    expect(combo.resolvedRank).toBeNull();
    expect(combo.suits).toEqual([null, null]);
    expect(combo.isPureJokerPlay).toBe(true);
  });

  it("refuses to pair a pure joker with a non-joker", () => {
    // Stated explicitly: one joker bound to the 8, the other left pure beside it.
    expect(error(cards("JKR-1", "JKR-2", "H-8"), [bind("JKR-1", 8, "S")])).toBe(
      "JOKER_MUST_BE_BOUND",
    );
    // And beside a bound joker alone, with no numbered card in the selection.
    expect(error(cards("JKR-1", "JKR-2"), [bind("JKR-1", 8, "S")])).toBe("JOKER_MUST_BE_BOUND");
  });

  it("binds rather than rejects when the client sends no bindings at all", () => {
    // JKR + 8H is only ever a pair of 8s (§5.5), never a pure joker beside an 8.
    const combo = parsed(cards("JKR-1", "H-8"));
    expect(combo.resolvedRank).toBe(8);
    expect(combo.isPureJokerPlay).toBe(false);
  });
});

describe("explicit bindings (§5.4)", () => {
  it("binds a joker to an 8 so it pairs with an 8", () => {
    const combo = parsed(cards("JKR-1", "H-8"), [bind("JKR-1", 8, "S")]);
    expect(combo.resolvedRank).toBe(8);
    expect(combo.suits).toEqual(["S", "H"]);
    expect(combo.isPureJokerPlay).toBe(false);
    expect(combo.bindings).toEqual([bind("JKR-1", 8, "S")]);
  });

  it("accepts both jokers bound to the combo's rank", () => {
    const combo = parsed(cards("JKR-1", "JKR-2", "H-8"), [
      bind("JKR-1", 8, "S"),
      bind("JKR-2", 8, "D"),
    ]);
    expect(combo.resolvedRank).toBe(8);
    expect(combo.suits).toEqual(["S", "D", "H"]);
    expect(combo.cards.length).toBe(3);
  });

  it("rejects a joker bound to a rank the rest of the combo does not share", () => {
    expect(error(cards("JKR-1", "H-8"), [bind("JKR-1", 9, "S")])).toBe("MIXED_RANKS");
    expect(
      error(cards("JKR-1", "JKR-2", "H-8"), [bind("JKR-1", 8, "S"), bind("JKR-2", 9, "D")]),
    ).toBe("MIXED_RANKS");
  });

  it("rejects a binding on a card that is absent or is not a joker", () => {
    expect(error(cards("JKR-1", "H-8"), [bind("H-8", 8, "S")])).toBe("INVALID_BINDING");
    expect(error(cards("JKR-1", "H-8"), [bind("JKR-2", 8, "S")])).toBe("INVALID_BINDING");
  });

  it("rejects a binding with a rank or suit that is not on a card", () => {
    expect(error(cards("JKR-1"), [{ cardId: "JKR-1", rank: 14 as Rank, suit: "S" }])).toBe(
      "INVALID_BINDING",
    );
    expect(error(cards("JKR-1"), [{ cardId: "JKR-1", rank: 8, suit: "X" as Suit }])).toBe(
      "INVALID_BINDING",
    );
  });

  it("rejects two bindings for the same joker", () => {
    expect(error(cards("JKR-1", "H-8"), [bind("JKR-1", 8, "S"), bind("JKR-1", 8, "D")])).toBe(
      "DUPLICATE_BINDING",
    );
  });
});

describe("default binding resolution (§5.5)", () => {
  it("resolves a lone led joker to pure", () => {
    expect(parsed(cards("JKR-1"), undefined, { top: null }).isPureJokerPlay).toBe(true);
    expect(parsed(cards("JKR-1", "JKR-2"), undefined, { top: null }).isPureJokerPlay).toBe(true);
  });

  it("binds a led joker to a 3 under revolution, where pure is the weakest card", () => {
    const combo = parsed(cards("JKR-1"), undefined, { top: null, inverted: true });
    expect(combo.resolvedRank).toBe(3);
    expect(combo.isPureJokerPlay).toBe(false);
  });

  it("maximises raw strength only, never a house-rule trigger", () => {
    // A player who wants the joker to be a 7 (to fire 7-pass) overrides the
    // default with explicit bindings; the default never guesses at intent (§6).
    expect(parsed(cards("JKR-1"), undefined, { top: null, inverted: true }).resolvedRank).toBe(3);
    expect(parsed(cards("JKR-1"), [bind("JKR-1", 7, "H")]).resolvedRank).toBe(7);
  });

  it("beats a 4 under revolution by binding to a 3, but can never beat a 3", () => {
    const overFour = parsed(cards("JKR-1"), undefined, { top: top(["H-4"]), inverted: true });
    expect(overFour.resolvedRank).toBe(3);
    // Nothing is stronger than a 3 while inverted, and equal strength does not beat.
    expect(error(cards("JKR-1"), undefined, { top: top(["H-3"]), inverted: true })).toBe(
      "NO_LEGAL_BINDING",
    );
  });

  it("binds a joker to the rank the non-joker cards force", () => {
    const combo = parsed(cards("JKR-1", "H-8"), undefined, { top: null });
    expect(combo.resolvedRank).toBe(8);
    expect(combo.bindings.length).toBe(1);
    expect(combo.bindings[0]?.rank).toBe(8);
    expect(combo.isPureJokerPlay).toBe(false);
  });

  it("keeps a joker pure over a numbered top, since pure is the strongest binding", () => {
    const combo = parsed(cards("JKR-1"), undefined, { top: top(["S-2"]) });
    expect(combo.isPureJokerPlay).toBe(true);
    expect(combo.resolvedRank).toBeNull();
  });

  it("picks the greatest effective strength, which inverts under revolution", () => {
    // A pure joker is the weakest card during revolution (§5.2), so the strongest
    // legal binding over a 4 is the 3 - the only rank that beats it inverted.
    const combo = parsed(cards("JKR-1"), undefined, {
      top: top(["S-4"]),
      inverted: true,
    });
    expect(combo.resolvedRank).toBe(3);
    expect(combo.isPureJokerPlay).toBe(false);
  });

  it("binds an all-joker pair to a rank when pure cannot beat the top", () => {
    // Inverted, a pure pair of jokers is the weakest pair there is.
    const combo = parsed(cards("JKR-1", "JKR-2"), undefined, {
      top: top(["S-6", "H-6"]),
      inverted: true,
    });
    expect(combo.resolvedRank).toBe(3);
    expect(combo.isPureJokerPlay).toBe(false);
    expect(combo.bindings.length).toBe(2);
    expect(new Set(combo.suits).size).toBe(2); // never two jokers on one card
  });

  it("never binds a joker to the 3 of Spades to top a pure joker", () => {
    // The counter is the true S-3's privilege, not the rank's (§5.4), so there is
    // no binding that gets a second joker over the first in standard orientation.
    expect(error(cards("JKR-2"), undefined, { top: top(["JKR-1"]) })).toBe("NO_LEGAL_BINDING");
  });

  it("reports NO_LEGAL_BINDING when no binding produces a legal play", () => {
    // The 8 forces the rank; a pair of 8s cannot beat a pair of kings.
    expect(error(cards("JKR-1", "H-8"), undefined, { top: top(["S-13", "H-13"]) })).toBe(
      "NO_LEGAL_BINDING",
    );
  });

  it("honours a caller-supplied legality filter, e.g. a suit lock", () => {
    const combo = parsed(cards("JKR-1", "H-8"), undefined, {
      top: top(["S-7", "H-7"]),
      isLegal: (c) => c.suits.includes("D"),
    });
    expect(combo.suits).toEqual(["D", "H"]);
  });

  it("distinguishes an empty bindings array from an absent one", () => {
    // Absent asks for the default, which binds the joker to the 8 (§5.5).
    expect(parsed(cards("JKR-1", "H-8")).resolvedRank).toBe(8);
    // An empty array explicitly binds nothing, so the joker stays pure — which
    // beside an 8 is not a combo at all, and says so rather than silently binding.
    expect(error(cards("JKR-1", "H-8"), [])).toBe("JOKER_MUST_BE_BOUND");
  });

  it("lets an explicit empty array play a led joker pure under revolution", () => {
    // The default resolves this to a 3, the strongest card when inverted; sending
    // no bindings is how the player overrides that and leads the joker pure (§10.5).
    expect(parsed(cards("JKR-1"), undefined, { inverted: true }).resolvedRank).toBe(3);
    const pure = parsed(cards("JKR-1"), [], { inverted: true });
    expect(pure.isPureJokerPlay).toBe(true);
    expect(pure.resolvedRank).toBeNull();
  });
});

describe("purity", () => {
  it("never mutates its input and returns a frozen combo", () => {
    const input = cards("JKR-1", "H-8");
    const snapshot = input.map((c) => c.id);
    const combo = parsed(input, [bind("JKR-1", 8, "S")]);
    expect(input.map((c) => c.id)).toEqual(snapshot);
    expect(Object.isFrozen(combo)).toBe(true);
    expect(() => {
      (combo.cards as Card[]).push(card("S-2"));
    }).toThrow();
  });
});
