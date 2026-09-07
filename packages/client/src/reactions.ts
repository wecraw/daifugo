/**
 * The client half of the quick reactions (`core/reactions.ts`): which three the
 * menu offers, and where their English lives.
 *
 * Core owns the ids so the server can reject anything else; the phrases are
 * presentation and stay in the `ui.*` namespace the client owns (§11), one key
 * per id.
 */
import { REACTION_IDS, REACTION_MENU_SIZE, type ReactionId } from "@daifugo/core";
import type { UiI18nKey } from "./i18n/keys";

/** The copy key for one reaction. Every id has one; `keys.ts` lists them all. */
export function reactionKey(reaction: ReactionId): UiI18nKey {
  return `ui.reaction.${reaction}`;
}

/**
 * Draw the menu: `count` distinct reactions from the pool, in random order.
 *
 * A partial Fisher-Yates over a copy — `sort(() => Math.random() - 0.5)` is not
 * a shuffle, and with three of twenty on offer a biased draw would show the same
 * three all night. `random` is injected so a test can pin the draw; nothing else
 * passes it.
 */
export function drawReactions(
  count: number = REACTION_MENU_SIZE,
  random: () => number = Math.random,
): ReactionId[] {
  const pool = [...REACTION_IDS];
  const drawn: ReactionId[] = [];
  const wanted = Math.min(count, pool.length);
  for (let index = 0; index < wanted; index += 1) {
    const pick = index + Math.floor(random() * (pool.length - index));
    const chosen = pool[Math.min(pick, pool.length - 1)] as ReactionId;
    pool[Math.min(pick, pool.length - 1)] = pool[index] as ReactionId;
    pool[index] = chosen;
    drawn.push(chosen);
  }
  return drawn;
}
