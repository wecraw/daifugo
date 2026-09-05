/**
 * Rendering a `HistoryEntry` (§11).
 *
 * Entries carry i18n keys and params, never bare strings, and the params name
 * things the engine can reach: *player ids*, *card ids*, and suit letters. A
 * name or a pip would be a bare string in `GameState`, so none of them are
 * there, and turning them back into something a player reads is this file's
 * whole job:
 *
 * * a value that names a seat becomes that seat's name;
 * * `cards` is a space-joined card-id list and becomes faces — §8.5's worked
 *   example is "Will passed 3♠ to Alex", not "Will passed S-3 to Alex";
 * * `suits` is the letter run of a shibari lock and becomes pips (§6), the same
 *   pips the trick area's badge shows;
 * * a nested key (the `role` of `history.roleAssigned`) is translated in place.
 *
 * Anything else — a count, a round number, the player-id list `history.fiveSkip`
 * carries in `skipped` — passes through untouched.
 */
import type { HistoryEntry, Player } from "@daifugo/core";
import { cardIdsFace, suitLetterGlyphs } from "./glyphs";
import type { I18nKey, Translate, TranslateParams } from "./i18n/index";

function isNestedKey(value: string): value is I18nKey {
  return value.startsWith("role.") || value.startsWith("rule.");
}

/** One history line, translated, with its ids and letters resolved for reading. */
export function historyLine(t: Translate, entry: HistoryEntry, players: readonly Player[]): string {
  const names = new Map(players.map((player) => [player.id, player.name]));
  const params: TranslateParams = {};

  for (const [name, value] of Object.entries(entry.params)) {
    if (typeof value !== "string") {
      params[name] = value;
    } else if (name === "cards") {
      params[name] = cardIdsFace(value);
    } else if (name === "suits") {
      params[name] = suitLetterGlyphs(value);
    } else {
      const seatName = names.get(value);
      params[name] = seatName ?? (isNestedKey(value) ? t(value) : value);
    }
  }

  // `HistoryEntry.key` is `HistoryKey`, a subset of the composed union (§11).
  return t(entry.key, params);
}
