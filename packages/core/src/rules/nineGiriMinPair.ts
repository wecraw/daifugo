/**
 * 9-Giri (§6, §7.1 Phase D).
 *
 * The same trick ender as 8-giri with one extra condition: the count must be two
 * or more. A single 9 does nothing at all — it is an ordinary 9.
 *
 * The minimum is on the *combo count*, and a bound joker is one of the cards that
 * counts toward it: `JKR-as-9 + 9` is a pair of 9s and clears (§5.4).
 */
import type { HouseRulesConfig, PlayCombo } from "../types.js";

export function firesNineGiri(combo: PlayCombo, config: Readonly<HouseRulesConfig>): boolean {
  return config.nineGiriMinPair && combo.resolvedRank === 9 && combo.cards.length >= 2;
}
