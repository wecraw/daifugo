/**
 * 5-Skip (§6, §7.1 Phase E).
 *
 * `S` is the combo count — every combo resolves to one rank (§5.3), so a pair of
 * 5s skips two and there is no per-card accounting to do. The seats skipped are
 * *eligible* seats: a player who has already passed is out of this trick and
 * costs the skip nothing (§7.5).
 *
 * When `S` reaches every eligible opponent the skip would wrap onto the player
 * themselves, which the spec resolves by clearing the trick and keeping the lead
 * instead. That is not the same as skipping everybody and landing back on self:
 * the trick clears, `trickInverted` and `suitLock` reset (§7.4), and the player
 * leads a fresh trick.
 *
 * This file computes *where the turn goes*; the engine applies it. Phase E runs
 * after Phase C, so the player may already have gone out, in which case they are
 * no longer eligible and the walk skips over their own seat naturally.
 */
import type { HouseRulesConfig, PlayCombo } from "../types.js";
import {
  type SeatingContext,
  eligiblePlayerIds,
  nextEligibleIndex,
  seatIndexOf,
} from "../turnOrder.js";

export type FiveSkipEffect =
  /** The rule did not fire; Phase F advances normally. */
  | { kind: "NONE" }
  /** `S` reached every eligible opponent: clear the trick, lead stays. */
  | { kind: "CLEAR_TRICK"; leaderId: string }
  /** Advance past `skippedPlayerIds` to `nextIndex`, an index into `turnOrder`. */
  | { kind: "SKIP"; skippedPlayerIds: string[]; nextIndex: number };

/** Resolved rank 5, at any count (§5.4: a bound joker is a 5). */
export function firesFiveSkip(combo: PlayCombo, config: Readonly<HouseRulesConfig>): boolean {
  return config.fiveSkip && combo.resolvedRank === 5;
}

export function fiveSkip(
  combo: PlayCombo,
  playerId: string,
  seating: SeatingContext,
  config: Readonly<HouseRulesConfig>,
): FiveSkipEffect {
  if (!firesFiveSkip(combo, config)) return { kind: "NONE" };

  const skips = combo.cards.length;
  const eligibleOthers = eligiblePlayerIds(seating).filter((id) => id !== playerId);
  if (skips >= eligibleOthers.length) return { kind: "CLEAR_TRICK", leaderId: playerId };

  const from = seatIndexOf(playerId, seating);
  if (from === -1) return { kind: "NONE" };

  const skippedPlayerIds: string[] = [];
  let index = from;
  for (let taken = 0; taken < skips; taken++) {
    const next = nextEligibleIndex(seating, index);
    // Unreachable while `skips < eligibleOthers.length`, but a null here would
    // otherwise silently become seat 0 and hand the turn to the wrong player.
    if (next === null) return { kind: "CLEAR_TRICK", leaderId: playerId };
    const skipped = seating.turnOrder[next];
    if (skipped !== undefined) skippedPlayerIds.push(skipped);
    index = next;
  }

  const nextIndex = nextEligibleIndex(seating, index);
  if (nextIndex === null) return { kind: "CLEAR_TRICK", leaderId: playerId };
  return { kind: "SKIP", skippedPlayerIds, nextIndex };
}
