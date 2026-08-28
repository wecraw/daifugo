/**
 * Taking a named set of cards out of a hand (§7.2).
 *
 * 7-pass and 10-discard both resolve a client-supplied card list against the hand
 * that owes it, and both must reject the same three ways — a repeated id, an id
 * the player does not hold, the wrong number of cards — with the same codes
 * (§8.0). Card conservation depends on the split being exact: `selected` and
 * `remaining` always partition the hand, so a caller that appends one and stores
 * the other cannot lose or duplicate a card.
 */
import type { ErrorCode } from "./i18n-keys.js";
import type { Card, Result } from "./types.js";
import { err, ok } from "./types.js";

export interface HandSplit {
  /** The named cards, in hand order rather than the order they were named. */
  selected: Card[];
  /** Everything else, in hand order. */
  remaining: Card[];
}

/**
 * Split `hand` around `cardIds`.
 *
 * Hand order is preserved on both sides so the result is a function of the hand
 * and the *set* of ids, not of the order a client happened to list them in:
 * `applyAction` is pure, and two servers replaying one action must produce byte
 * identical hands (§14).
 */
export function takeFromHand(
  hand: readonly Card[],
  cardIds: readonly string[],
): Result<HandSplit, ErrorCode> {
  const wanted = new Set(cardIds);
  if (wanted.size !== cardIds.length) return err("DUPLICATE_CARD_IDS");
  if (cardIds.some((id) => !hand.some((card) => card.id === id))) return err("CARD_NOT_IN_HAND");

  const selected: Card[] = [];
  const remaining: Card[] = [];
  for (const card of hand) {
    if (wanted.has(card.id)) selected.push(card);
    else remaining.push(card);
  }
  return ok({ selected, remaining });
}
