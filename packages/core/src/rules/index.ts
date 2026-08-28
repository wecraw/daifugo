/**
 * The nine house rules (§6), one file each.
 *
 * Every rule reads the *resolved* rank the parser produced, never `card.isJoker`,
 * so a joker bound to an 8 fires 8-giri without any rule file knowing jokers
 * exist (§5.4). The sole exception is the beater side of the Spade-3 counter,
 * which matches the card id `S-3`.
 *
 * A combo resolves to exactly one rank (§5.3), so at most one rank-triggered rule
 * fires per play and the trigger count is simply the combo's card count. Nothing
 * here reads or writes `GameState`: each rule reports what should happen and the
 * engine's pipeline (§7.1) applies it in phase order.
 */
export * from "./spade3BeatsJoker.js";
export * from "./fiveSkip.js";
export * from "./sevenPass.js";
export * from "./eightGiri.js";
export * from "./nineGiriMinPair.js";
export * from "./tenDiscard.js";
export * from "./elevenBack.js";
export * from "./kakumei.js";
export * from "./shibari.js";
