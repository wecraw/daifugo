/**
 * 11-Back (§6, §7.1 Phase A).
 *
 * Parity, not a set: `J` is the combo count, an odd count toggles
 * `trickInverted`, an even count is a no-op — two Jacks invert and un-invert in
 * the same breath. A joker bound to a Jack counts toward the parity like any
 * other card (§5.4).
 *
 * The flag lasts for the trick and resets on `clearTrick` (§7.4), which is why it
 * is separate from `isRevolution`: the two combine by XOR (§5.2), so revolution
 * plus an inverted trick is upright again.
 *
 * Phase A applies this *after* Phase 0 has validated the play against the
 * pre-play orientation, so an 11-back never retroactively makes the play that
 * caused it illegal.
 */
import type { HouseRulesConfig, PlayCombo } from "../types.js";

/** Resolved rank 11 with an odd count. */
export function firesElevenBack(combo: PlayCombo, config: Readonly<HouseRulesConfig>): boolean {
  return config.elevenBack && combo.resolvedRank === 11 && combo.cards.length % 2 === 1;
}

/** `trickInverted` after the play. */
export function applyElevenBack(
  trickInverted: boolean,
  combo: PlayCombo,
  config: Readonly<HouseRulesConfig>,
): boolean {
  return firesElevenBack(combo, config) ? !trickInverted : trickInverted;
}
