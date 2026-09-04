/**
 * Rendering a `HistoryEntry` (§11).
 *
 * Entries carry i18n keys and params, never bare strings, and the params name
 * *player ids* — the engine has no access to anything else, and a name would be
 * a bare string in `GameState`. So the client resolves ids to the names on its
 * own roster at render time, and translates a nested key (the `role` of
 * `history.roleAssigned`) the same way.
 *
 * Only params that exactly match a seat or a key are rewritten; a count, a round
 * number, or a card id passes through untouched.
 */
import type { HistoryEntry, Player } from "@daifugo/core";
import type { I18nKey, Translate, TranslateParams } from "./i18n/index";

function isNestedKey(value: string): value is I18nKey {
  return value.startsWith("role.") || value.startsWith("rule.");
}

/** One history line, translated, with its ids resolved against the roster. */
export function historyLine(t: Translate, entry: HistoryEntry, players: readonly Player[]): string {
  const names = new Map(players.map((player) => [player.id, player.name]));
  const params: TranslateParams = {};

  for (const [name, value] of Object.entries(entry.params)) {
    if (typeof value === "string") {
      const seatName = names.get(value);
      params[name] = seatName ?? (isNestedKey(value) ? t(value) : value);
    } else {
      params[name] = value;
    }
  }

  // `HistoryEntry.key` is `HistoryKey`, a subset of the composed union (§11).
  return t(entry.key, params);
}
