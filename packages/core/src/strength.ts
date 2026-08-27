/**
 * The single monotonic strength index (§5.1) and the comparison helpers built on
 * it (§5.2).
 *
 * Everything downstream — combo comparison, forced exchange selection, the
 * weakest-legal-single fallback on a timeout — reads strength through this file,
 * so the Ace-is-11 and joker-is-13 quirks live in exactly one table.
 *
 * No comparison here reads game state. Callers pass the orientation explicitly,
 * derived once via `effectiveInverted`, which keeps the XOR (§5.2) from being
 * re-derived — or half-derived — at each call site.
 */
import type { Card, Rank, Suit } from "./types.js";

/** A pure joker outranks every numbered card in the standard orientation. */
export const JOKER_STRENGTH = 13;

/**
 * Rank to strength index, §5.1 verbatim. Note that Ace (1) and Two (2) sit at the
 * top: `Rank` is a numeric value, never an ordering.
 */
export const STRENGTH_INDEX: Readonly<Record<Rank, number>> = Object.freeze({
  3: 0,
  4: 1,
  5: 2,
  6: 3,
  7: 4,
  8: 5,
  9: 6,
  10: 7,
  11: 8,
  12: 9,
  13: 10,
  1: 11,
  2: 12,
});

/**
 * Strength of a *resolved* rank. `null` means a pure joker — the same convention
 * as `PlayCombo.resolvedRank` and `Card.rank`, so a bound joker passes the rank it
 * resolved to and is scored as that rank (§5.4).
 */
export function strengthOf(rank: Rank | null): number {
  return rank === null ? JOKER_STRENGTH : STRENGTH_INDEX[rank];
}

/** Strength of a card as it sits in hand, i.e. with any joker taken as pure. */
export function cardStrength(card: Card): number {
  return card.isJoker ? JOKER_STRENGTH : strengthOf(card.rank);
}

/**
 * §5.2: `effectiveInverted = isRevolution XOR trickInverted`.
 *
 * Revolution and 11-back cancel: under both, the order is upright again.
 */
export function effectiveInverted(isRevolution: boolean, trickInverted: boolean): boolean {
  return isRevolution !== trickInverted;
}

/**
 * Negative when `a` is weaker than `b`, positive when stronger, 0 when equal.
 * Suitable directly as an `Array.prototype.sort` comparator (weakest first).
 */
export function compareStrength(a: number, b: number, inverted: boolean): number {
  return inverted ? b - a : a - b;
}

/** Strictly stronger. Equal strength is not stronger — count and suit lock decide. */
export function isStronger(a: number, b: number, inverted: boolean): boolean {
  return compareStrength(a, b, inverted) > 0;
}

/** Tie-break order for suits. Strength itself never depends on suit (§5.1). */
const SUIT_ORDER: Readonly<Record<Suit, number>> = Object.freeze({ S: 0, H: 1, D: 2, C: 3 });

/** Suitless cards — pure jokers — sort after every suited card of equal strength. */
const SUITLESS_ORDER = 4;

function suitOrder(card: Card): number {
  return card.suit === null ? SUITLESS_ORDER : SUIT_ORDER[card.suit];
}

/** Comparator over cards: strength first, then a stable suit and id tie-break. */
export function compareCards(a: Card, b: Card, inverted: boolean): number {
  const byStrength = compareStrength(cardStrength(a), cardStrength(b), inverted);
  if (byStrength !== 0) return byStrength;
  const bySuit = suitOrder(a) - suitOrder(b);
  if (bySuit !== 0) return bySuit;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Weakest first, in a new array. Callers wanting the strongest cards — the poor
 * side of an exchange (§4.3) — read from the end.
 *
 * The tie-break is total, so the result is a function of the input *set*, not of
 * the order cards happened to be dealt in. `applyAction` is pure and two servers
 * replaying one seed must agree on which cards a timeout auto-gave.
 */
export function sortByStrength(cards: readonly Card[], inverted = false): Card[] {
  return [...cards].sort((a, b) => compareCards(a, b, inverted));
}
