/**
 * 7-Pass (§6, §7.1 Phase B, §7.2).
 *
 * An interactive rule: it halts the pipeline with a `RESOLVE_7_PASS` pending
 * action and the engine resumes at Phase C once the player submits, because the
 * transfer can empty their hand (§7.3).
 *
 * `k = min(C, cards remaining after the play)`, so playing your last 7 passes
 * nothing and the pipeline never halts at all. The target is the nearest player
 * still **in the round** to the left — passed players included, since a passed
 * player simply picks the cards up next trick, but never a finished or dropped
 * one (§4.5). That is deliberately a different predicate from 5-skip's (§6),
 * which counts eligible seats.
 */
import { takeFromHand } from "../hand.js";
import type { ErrorCode } from "../i18n-keys.js";
import { type SeatingContext, nextInRoundIndex, seatIndexOf } from "../turnOrder.js";
import type { Card, HouseRulesConfig, PendingAction, PlayCombo, Result } from "../types.js";
import { err, ok } from "../types.js";

export interface SevenPassTransfer {
  /** Cards leaving the source hand, bound for the target's. */
  given: Card[];
  /** What is left of the source hand. May be empty: that is a normal agari (§7.3). */
  remaining: Card[];
}

/** Resolved rank 7, at any count (§5.4: a bound joker is a 7). */
export function firesSevenPass(combo: PlayCombo, config: Readonly<HouseRulesConfig>): boolean {
  return config.sevenPass && combo.resolvedRank === 7;
}

/** `k = min(C, remaining)`, floored at zero (§6). */
export function sevenPassCount(combo: PlayCombo, cardsRemaining: number): number {
  return Math.max(0, Math.min(combo.cards.length, cardsRemaining));
}

/** The nearest player still in the round to the left, or null when nobody is. */
export function sevenPassTarget(playerId: string, seating: SeatingContext): string | null {
  const from = seatIndexOf(playerId, seating);
  if (from === -1) return null;
  const index = nextInRoundIndex(seating, from);
  if (index === null) return null;
  const target = seating.turnOrder[index];
  return target === undefined || target === playerId ? null : target;
}

/**
 * The pending action Phase B sets, or null when the pipeline should run on.
 *
 * Null covers three cases that all mean the same thing downstream: the rule is
 * off, `k` is 0, or there is no non-finished player to give cards to.
 */
export function sevenPassPending(
  combo: PlayCombo,
  playerId: string,
  cardsRemaining: number,
  seating: SeatingContext,
  config: Readonly<HouseRulesConfig>,
): PendingAction | null {
  if (!firesSevenPass(combo, config)) return null;
  const count = sevenPassCount(combo, cardsRemaining);
  if (count === 0) return null;
  const targetPlayerId = sevenPassTarget(playerId, seating);
  if (targetPlayerId === null) return null;
  return { type: "RESOLVE_7_PASS", count, sourcePlayerId: playerId, targetPlayerId };
}

/**
 * Apply a `SUBMIT_7_PASS` against the source hand (§7.2).
 *
 * The engine appends `given` to the target's hand and stores `remaining` as the
 * source's, then resumes at Phase C. Returning the split rather than mutating two
 * hands here keeps card conservation checkable in one place.
 */
export function resolveSevenPass(
  pending: PendingAction | null,
  playerId: string,
  cardIds: readonly string[],
  hand: readonly Card[],
): Result<SevenPassTransfer, ErrorCode> {
  if (pending === null) return err("NO_PENDING_ACTION");
  if (pending.type !== "RESOLVE_7_PASS") return err("WRONG_PENDING_ACTION");
  if (pending.sourcePlayerId !== playerId) return err("NOT_YOUR_TURN");
  if (cardIds.length !== pending.count) return err("WRONG_CARD_COUNT");

  const split = takeFromHand(hand, cardIds);
  if (!split.ok) return split;
  return ok({ given: split.value.selected, remaining: split.value.remaining });
}
