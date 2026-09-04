/**
 * The Play button's label (§10.6): "Play Pair of 8s", "Play Four 3s".
 *
 * The name comes off the *resolved* combo — its count and its resolved rank —
 * never off the cards, so a joker bound to an 8 reads as an 8 (§5.4) and the
 * label always says what the play will actually be.
 *
 * The count keys stop at four because four is the widest N-of-a-kind the deck's
 * naturals make; a bound joker beside four naturals can push a play to five or
 * six, and `ui.combo.many` names those.
 */
import type { PlayCombo } from "@daifugo/core";
import { RANK_LABEL } from "../glyphs";
import type { TranslateParams } from "../i18n/index";
import type { UiI18nKey } from "../i18n/keys";

export interface ComboLabel {
  key: UiI18nKey;
  params: TranslateParams;
}

const BY_COUNT: Readonly<Record<number, UiI18nKey>> = Object.freeze({
  1: "ui.combo.single",
  2: "ui.combo.pair",
  3: "ui.combo.triple",
  4: "ui.combo.quad",
});

export function comboLabel(combo: PlayCombo): ComboLabel {
  const count = combo.cards.length;
  if (combo.resolvedRank === null) {
    return count === 1
      ? { key: "ui.combo.joker", params: {} }
      : { key: "ui.combo.jokers", params: { count } };
  }
  const rank = RANK_LABEL[combo.resolvedRank];
  const key = BY_COUNT[count];
  return key === undefined
    ? { key: "ui.combo.many", params: { count, rank } }
    : { key, params: { rank } };
}
