/**
 * Shibari, the suit lock (§6, §7.1 Phase A).
 *
 * Two *consecutive* plays in a trick sharing an identical suit multiset lock the
 * trick to that multiset: every later play must match it exactly. Exactly, not by
 * overlap — {S,H} followed by {H,D} shares a heart and locks nothing. Mixed sets
 * lock as readily as uniform ones: hearts+spades twice locks to {S,H}.
 *
 * Once set, the lock runs to the end of the trick and `clearTrick` drops it
 * (§7.4). Enforcement lives in the evaluator, which every play already goes
 * through (`matchesSuitLock`); this file only decides when a lock comes into
 * being.
 *
 * Pure jokers are the wrinkle. A pure joker has no suit, so it *satisfies* any
 * lock and *maintains* one — the trick stays locked underneath it — but it cannot
 * establish one, because a suitless card pins no multiset down. A joker played
 * *bound* contributes the suit it was bound to, like every other rule that reads
 * the resolved view (§5.4).
 */
import { SUITS } from "../deck.js";
import type { HouseRulesConfig, PlayCombo, Suit } from "../types.js";

/** Deck order, so a reported lock reads the same way everywhere. Not a strength
 *  order: strength never depends on suit (§5.1). */
function suitOrder(suit: Suit): number {
  return SUITS.indexOf(suit);
}

/**
 * The trick's `suitLock` after `current` is played.
 *
 * `previous` is the play `current` landed on — the trick top before this play, or
 * null when `current` is leading. `existing` is the lock already in force, which
 * is returned unchanged: a play that got this far has already satisfied it.
 */
export function shibariLock(
  previous: PlayCombo | null,
  current: PlayCombo,
  existing: readonly Suit[] | null,
  config: Readonly<HouseRulesConfig>,
): Suit[] | null {
  if (!config.shibari) return null;
  if (existing !== null) return [...existing];
  if (previous === null) return null;

  const before = determinedSuits(previous);
  const after = determinedSuits(current);
  if (before === null || after === null) return null;
  if (before.length !== after.length) return null;
  if (before.some((suit, index) => suit !== after[index])) return null;

  return after;
}

/**
 * A combo's suits in a canonical order, or null when a pure joker leaves them
 * undetermined. Sorting makes the comparison a multiset comparison: the order
 * cards were selected in never mattered.
 */
function determinedSuits(combo: PlayCombo): Suit[] | null {
  const suits: Suit[] = [];
  for (const suit of combo.suits) {
    if (suit === null) return null;
    suits.push(suit);
  }
  return suits.sort((a, b) => suitOrder(a) - suitOrder(b));
}
