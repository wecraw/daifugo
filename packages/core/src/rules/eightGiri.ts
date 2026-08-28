/**
 * 8-Giri (§6, §7.1 Phase D).
 *
 * Resolved rank 8, at any count: the trick clears immediately and the lead stays
 * with the player who played it. No minimum, which is the only thing separating
 * it from 9-giri (§6).
 *
 * The clear itself is `clearTrick(leader = playerId)` (§7.4) and belongs to the
 * engine: it resets `trickInverted` and `suitLock`, leaves `isRevolution` alone,
 * and hands the lead onward if the player has just gone out. This file only says
 * whether it fires.
 */
import type { HouseRulesConfig, PlayCombo } from "../types.js";

export function firesEightGiri(combo: PlayCombo, config: Readonly<HouseRulesConfig>): boolean {
  return config.eightGiri && combo.resolvedRank === 8;
}
