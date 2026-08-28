/**
 * Revolution (§6, §7.1 Phase A).
 *
 * Four or more cards of one rank played at once toggle `isRevolution` for the
 * rest of the round. It is the only house rule with no rank condition: four 3s
 * revolt exactly as four 2s do.
 *
 * A wildcard joker counts toward the four — `JKR-as-K + K + K + K` is four kings
 * (§5.4) — because the count is the combo's card count and the combo already
 * resolved to one rank (§5.3). A pair of pure jokers is not four of anything.
 *
 * Unlike `trickInverted`, this survives `clearTrick` and only resets at the round
 * boundary (§7.4). The two combine by XOR (§5.2).
 */
import type { HouseRulesConfig, PlayCombo } from "../types.js";

/** Four or more cards sharing the resolved rank. */
export function firesKakumei(combo: PlayCombo, config: Readonly<HouseRulesConfig>): boolean {
  return config.kakumei && combo.cards.length >= 4;
}

/** `isRevolution` after the play. */
export function applyKakumei(
  isRevolution: boolean,
  combo: PlayCombo,
  config: Readonly<HouseRulesConfig>,
): boolean {
  return firesKakumei(combo, config) ? !isRevolution : isRevolution;
}
