/**
 * Kaidan, the rank-sequence lock (§6, §7.1 Phase A).
 *
 * Two *consecutive* plays in a trick that land exactly one strength-index step
 * apart (§5.1), in the winning direction under `effectiveInverted` (§5.2), lock
 * the trick: every later play must land on exactly the next step, not merely beat
 * the top. 3-3 then 4-4 locks the trick to 5s; the player after that may play 5-5
 * and nothing else.
 *
 * Once set, the lock advances by one step on every accepted play — a play that
 * got this far already matched the previous lock, so `existing` only tells this
 * function the lock is live, not what it currently requires — and `clearTrick`
 * drops it (§7.4). Enforcement lives in the evaluator, which every play already
 * goes through; this file only decides what the lock requires next.
 *
 * A step that would run past the ends of the strength range (below a 3, or past
 * a pure joker) sets a lock index no real play can ever match. That is not a
 * special case: nothing needs to detect it, because it simply behaves like any
 * other top nobody can beat, and the trick ends the way it always does.
 */
import { strengthOf } from "../strength.js";
import type { HouseRulesConfig, PlayCombo } from "../types.js";

/**
 * The trick's `kaidanLock` after `current` is played.
 *
 * `previous` is the play `current` landed on — the trick top before this play, or
 * null when `current` is leading. `existing` is the lock already in force.
 *
 * The two orientations are deliberately different. `inverted` is the pre-play
 * `effectiveInverted`, the direction under which `current` had to beat
 * `previous`, so it is what decides whether the pair is one step apart.
 * `nextInverted` is the orientation *after* Phase A's revolution and 11-back
 * toggles, which is the direction the next play will be judged in, so it is what
 * decides which way the requirement advances. A Jack that satisfies the lock and
 * flips 11-back must ask for a 10 next, not a Queen: a Queen could not beat it.
 */
export function kaidanLock(
  previous: PlayCombo | null,
  current: PlayCombo,
  existing: number | null,
  inverted: boolean,
  nextInverted: boolean,
  config: Readonly<HouseRulesConfig>,
): number | null {
  if (!config.kaidan) return null;

  const currentIndex = strengthOf(current.resolvedRank);
  const advanced = currentIndex + (nextInverted ? -1 : 1);

  if (existing !== null) return advanced;
  if (previous === null) return null;
  if (previous.cards.length !== current.cards.length) return null;

  const previousIndex = strengthOf(previous.resolvedRank);
  const step = inverted ? previousIndex - currentIndex : currentIndex - previousIndex;
  if (step !== 1) return null;

  return advanced;
}
