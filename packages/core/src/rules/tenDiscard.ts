/**
 * 10-Discard (§6, §7.1 Phase B, §7.2).
 *
 * The other interactive rule. `D` is the combo count, `k = min(D, cards
 * remaining)`, and the selected cards go to `graveyard` — the one sink that keeps
 * card conservation honest: `sum(hands) + trick + graveyard === 54` (§12.3), so
 * discarded cards are moved, never dropped.
 *
 * Like 7-pass, the discard can empty a hand, so the engine resumes at Phase C and
 * runs D through F afterwards (§7.2, §7.3).
 */
import { takeFromHand } from "../hand.js";
import type { ErrorCode } from "../i18n-keys.js";
import type { Card, HouseRulesConfig, PendingAction, PlayCombo, Result } from "../types.js";
import { err, ok } from "../types.js";

export interface TenDiscardResult {
  /** Cards bound for `graveyard`. */
  discarded: Card[];
  /** What is left of the hand. May be empty: that is a normal agari (§7.3). */
  remaining: Card[];
}

/** Resolved rank 10, at any count (§5.4: a bound joker is a 10). */
export function firesTenDiscard(combo: PlayCombo, config: Readonly<HouseRulesConfig>): boolean {
  return config.tenDiscard && combo.resolvedRank === 10;
}

/** `k = min(D, remaining)`, floored at zero (§6). */
export function tenDiscardCount(combo: PlayCombo, cardsRemaining: number): number {
  return Math.max(0, Math.min(combo.cards.length, cardsRemaining));
}

/** The pending action Phase B sets, or null when the pipeline should run on. */
export function tenDiscardPending(
  combo: PlayCombo,
  playerId: string,
  cardsRemaining: number,
  config: Readonly<HouseRulesConfig>,
): PendingAction | null {
  if (!firesTenDiscard(combo, config)) return null;
  const count = tenDiscardCount(combo, cardsRemaining);
  if (count === 0) return null;
  return { type: "RESOLVE_10_DISCARD", count, playerId };
}

/**
 * Apply a `SUBMIT_10_DISCARD` against the owing player's hand (§7.2).
 *
 * Only the player named in the pending action may resolve it; anyone else is
 * `NOT_YOUR_TURN`, which is the same answer they would get for playing out of
 * turn and the one §10.6 already renders.
 */
export function resolveTenDiscard(
  pending: PendingAction | null,
  playerId: string,
  cardIds: readonly string[],
  hand: readonly Card[],
): Result<TenDiscardResult, ErrorCode> {
  if (pending === null) return err("NO_PENDING_ACTION");
  if (pending.type !== "RESOLVE_10_DISCARD") return err("WRONG_PENDING_ACTION");
  if (pending.playerId !== playerId) return err("NOT_YOUR_TURN");
  if (cardIds.length !== pending.count) return err("WRONG_CARD_COUNT");

  const split = takeFromHand(hand, cardIds);
  if (!split.ok) return split;
  return ok({ discarded: split.value.selected, remaining: split.value.remaining });
}
