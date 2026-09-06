/**
 * The reason a play is refused, as specifically as the client can put it (§10.6).
 *
 * Shared by the two places a refusal surfaces: the disabled Play button, and the
 * notice a refused tap raises over the hand (§10.4). Both are the same judgement
 * from the same evaluator, so they must not phrase it two different ways.
 *
 * §10.6 wants the reason specific — "Must follow ♠", "Must play 2 card(s)" — but
 * `error.*` is the *transport's* vocabulary (§8.0) and also has to read in the
 * `gameError` banner, where no params ever travel: the server emits `{ code }`
 * and nothing else (§8.4). An `error.*` string that interpolated a param would
 * therefore render its placeholder raw the moment it lost the race to the
 * disabled button.
 *
 * So the codes stay generic and the specific phrasing lives in `ui.*`, which is
 * client presentation text nothing in core emits (§11) — and which is rendered
 * only from here, where the client is holding the values to fill it with.
 */
import { errorKey, type ErrorCode } from "@daifugo/core";
import type { I18nKey, TranslateParams, UiI18nKey } from "../i18n/index";

/** The codes that have something concrete to name, and the param each needs. */
const SPECIFIC: Partial<Record<ErrorCode, { key: UiI18nKey; param: string }>> = {
  SUIT_LOCK_MISMATCH: { key: "ui.action.mustFollowSuits", param: "suits" },
  COMBO_COUNT_MISMATCH: { key: "ui.action.mustPlayCount", param: "count" },
  KAIDAN_LOCK_MISMATCH: { key: "ui.action.mustPlayRank", param: "rank" },
};

export function blockerText(code: ErrorCode, params: TranslateParams): [I18nKey, TranslateParams] {
  const specific = SPECIFIC[code];
  if (specific !== undefined) {
    // Neither code can fire without its value, but a blank "Must follow " is a
    // worse failure than the generic sentence, so it falls back rather than
    // trusting that.
    const value = params[specific.param];
    if (value !== undefined && value !== "" && value !== 0) return [specific.key, params];
  }
  return [errorKey(code), params];
}
