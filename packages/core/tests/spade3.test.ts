/**
 * §12.1 test 2: the Spade-3-beats-joker counter (§5.4, §6).
 *
 * It beats a single pure joker in either orientation; it loses to a joker bound
 * to a 4; it does not beat a joker played as a 10; it is illegal against a pair
 * of jokers; and a joker bound to the 3 of Spades does not qualify as the beater.
 */
import { describe, expect, it } from "vitest";
import { parseCombo } from "../src/combo.js";
import { DEFAULT_HOUSE_RULES } from "../src/config.js";
import { createDeck } from "../src/deck.js";
import { canBeat, checkLegality } from "../src/evaluator.js";
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

/** Combos are built through the parser, never by hand. */
function combo(ids: string[], bindings?: JokerBinding[]): PlayCombo {
  const result = parseCombo(cards(...ids), bindings);
  if (!result.ok) throw new Error(`bad fixture: ${result.error}`);
  return result.value;
}

const pureJoker = combo(["JKR-1"]);
const pairOfJokers = combo(["JKR-1", "JKR-2"]);
const spade3 = combo(["S-3"]);

describe("the 3 of Spades over a single pure joker (§6)", () => {
  it("beats it in the standard orientation", () => {
    expect(canBeat(pureJoker, spade3, { top: pureJoker })).toBe(true);
  });

  it("beats it under revolution too, where a 3 already outranks it (§5.2)", () => {
    // Inert rather than absent: the exception changes nothing here, because the
    // 3 is the strongest card while inverted and wins on raw strength anyway.
    expect(canBeat(pureJoker, spade3, { top: pureJoker, isRevolution: true })).toBe(true);
  });

  it("is a legal play, not merely a strong one", () => {
    const legality = checkLegality(spade3, { top: pureJoker });
    expect(legality.ok).toBe(true);
  });

  it("does not apply when the house rule is off", () => {
    const config = { ...DEFAULT_HOUSE_RULES, spade3BeatsJoker: false };
    expect(canBeat(pureJoker, spade3, { top: pureJoker, config })).toBe(false);
    const legality = checkLegality(spade3, { top: pureJoker, config });
    expect(legality.ok ? null : legality.error).toBe("TOO_WEAK");
  });

  it("gives no other 3 the same privilege", () => {
    for (const id of ["H-3", "D-3", "C-3"]) {
      expect(canBeat(pureJoker, combo([id]), { top: pureJoker })).toBe(false);
    }
  });
});

describe("the victim side reads the binding, never card.isJoker (§5.4)", () => {
  it("does not beat a joker played as a 10", () => {
    const jokerAsTen = combo(["JKR-1"], [bind("JKR-1", 10, "H")]);
    expect(canBeat(jokerAsTen, spade3, { top: jokerAsTen })).toBe(false);
    const legality = checkLegality(spade3, { top: jokerAsTen });
    expect(legality.ok ? null : legality.error).toBe("TOO_WEAK");
  });

  it("loses to a joker bound to a 4, which is simply a 4", () => {
    const jokerAsFour = combo(["JKR-1"], [bind("JKR-1", 4, "H")]);
    expect(canBeat(spade3, jokerAsFour, { top: spade3 })).toBe(true);
    expect(canBeat(jokerAsFour, spade3, { top: jokerAsFour })).toBe(false);
  });

  it("is illegal against a pair of pure jokers: the counter is a single's only", () => {
    expect(canBeat(pairOfJokers, spade3, { top: pairOfJokers })).toBe(false);
    const legality = checkLegality(spade3, { top: pairOfJokers });
    expect(legality.ok ? null : legality.error).toBe("COMBO_COUNT_MISMATCH");
  });

  it("does not let a pair containing the 3 of Spades beat a pair of jokers", () => {
    const pairOf3s = combo(["S-3", "H-3"]);
    expect(canBeat(pairOfJokers, pairOf3s, { top: pairOfJokers })).toBe(false);
  });
});

describe("the beater must be the true S-3 (§5.4)", () => {
  it("refuses a joker bound to the 3 of Spades", () => {
    const jokerAsSpade3 = combo(["JKR-2"], [bind("JKR-2", 3, "S")]);
    expect(jokerAsSpade3.resolvedRank).toBe(3);
    expect(jokerAsSpade3.suits).toEqual(["S"]);
    expect(canBeat(pureJoker, jokerAsSpade3, { top: pureJoker })).toBe(false);
    const legality = checkLegality(jokerAsSpade3, { top: pureJoker });
    expect(legality.ok ? null : legality.error).toBe("TOO_WEAK");
  });

  it("is the one place card identity matters rather than resolved rank", () => {
    // Same resolved rank, same resolved suit; only the card id differs.
    const jokerAsSpade3 = combo(["JKR-2"], [bind("JKR-2", 3, "S")]);
    expect(jokerAsSpade3.resolvedRank).toBe(spade3.resolvedRank);
    expect(jokerAsSpade3.suits).toEqual(spade3.suits);
    expect(canBeat(pureJoker, spade3, { top: pureJoker })).toBe(true);
    expect(canBeat(pureJoker, jokerAsSpade3, { top: pureJoker })).toBe(false);
  });
});
