/**
 * Spade 3 Beats Joker (§6, §5.4).
 *
 * The one house rule that is a *legality* exception rather than a state effect:
 * it makes a specific card legal over a specific top, so the evaluator consults
 * it before comparing strength (§10.3) and nothing in the engine pipeline has to
 * know it exists.
 *
 * On the **victim** side the check reads the resolved view, via `isPureJokerPlay`,
 * and never `card.isJoker`: a joker played as a 10 is a 10 and the 3 of Spades
 * does not beat it. A pair of jokers is out of scope — the counter is a single's
 * privilege — and a single cannot match a pair's count anyway.
 *
 * On the **beater** side the card id must be the true `S-3`. This is the sole
 * place in the game where card identity matters rather than resolved rank: a joker
 * bound to the 3 of Spades resolves to a 3 of spades in every observable way and
 * still does not qualify, because the counter is that card's privilege, not the
 * rank's (§5.4).
 *
 * Under revolution the exception is inert rather than absent: a 3 is the strongest
 * card while inverted and a pure joker the weakest (§5.2), so the comparison the
 * evaluator would otherwise run says yes on its own. Nothing needs to switch it
 * off, and switching it off would only add a branch no play can distinguish.
 */
import { DEFAULT_HOUSE_RULES } from "../config.js";
import { SPADE_3_ID } from "../deck.js";
import type { HouseRulesConfig, PlayCombo } from "../types.js";

/** Is `candidate` the 3 of Spades, played over a lone pure joker? */
export function spade3BeatsJoker(
  top: PlayCombo | null,
  candidate: PlayCombo,
  config: Readonly<HouseRulesConfig> = DEFAULT_HOUSE_RULES,
): boolean {
  if (!config.spade3BeatsJoker) return false;
  if (top === null || top.cards.length !== 1 || !top.isPureJokerPlay) return false;
  if (candidate.cards.length !== 1) return false;
  return candidate.cards[0]?.id === SPADE_3_ID;
}
