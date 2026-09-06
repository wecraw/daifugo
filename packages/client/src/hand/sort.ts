/**
 * Hand sorting (§10.8): rank-then-suit, weakest first.
 *
 * The comparator is core's `compareCards` under `effectiveInverted` rather than a
 * fixed 3-to-2 order the client keeps for itself, so the hand visibly reverses
 * when revolution flips the table: what the hand shows and what beats what are
 * the same fact.
 */
import { compareCards, type Card } from "@daifugo/core";

/** The hand as it should read, weakest first, under the current effective order. */
export function sortHand(cards: readonly Card[], inverted: boolean): Card[] {
  return [...cards].sort((a, b) => compareCards(a, b, inverted));
}
