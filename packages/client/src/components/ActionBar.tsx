/**
 * The action column of §10.6: Play, Pass, the sort toggle, and the turn ring.
 *
 * The Play button names the play from the *resolved* combo — "Play Pair of 8s",
 * "Play Four 3s" (§5.4, §10.6) — and when the selection cannot be played it is
 * disabled with the reason on it. The reason is an `error.*` code from the same
 * evaluator the server validates with (§8.0), so what the button says is what the
 * server would have said, and nothing the player could have seen coming ever
 * arrives as a toast.
 *
 * Pass is disabled the same way rather than sent and refused, which is the rule
 * §10.11 already applies to the host panel: `CANNOT_PASS_AS_LEADER` is not a
 * banner, it is a greyed button that says you have to play.
 *
 * The ring here is the player's own turn clock, so it shows only on their turn;
 * the strip's ring (§10.1) is the table's, and counts down for whoever is up.
 */
import { TURN_DURATION_MS, errorKey, type ErrorCode } from "@daifugo/core";
import type { HandController } from "../hooks/useHandController";
import { useTranslate, type I18nKey, type TranslateParams, type UiI18nKey } from "../i18n/index";
import { TurnTimer } from "./TurnTimer";

/**
 * The two reasons that have something concrete to name, and the param each needs.
 *
 * §10.6 wants the disabled button specific — "Must follow ♠", "Must play 2
 * card(s)" — but `error.*` is the *transport's* vocabulary (§8.0) and also has
 * to read in the `gameError` banner, where no params ever travel: the server
 * emits `{ code }` and nothing else (§8.4). An `error.*` string that
 * interpolated a param would therefore render its placeholder raw the moment it
 * lost the race to the disabled button.
 *
 * So the codes stay generic and the specific phrasing lives in `ui.*`, which is
 * client presentation text nothing in core emits (§11) — and which is rendered
 * only here, where the client is holding the values to fill it with.
 */
const SPECIFIC: Partial<Record<ErrorCode, { key: UiI18nKey; param: string }>> = {
  SUIT_LOCK_MISMATCH: { key: "ui.action.mustFollowSuits", param: "suits" },
  COMBO_COUNT_MISMATCH: { key: "ui.action.mustPlayCount", param: "count" },
};

/** The reason a control is disabled, as specifically as the client can put it. */
function blockerText(code: ErrorCode, params: TranslateParams): [I18nKey, TranslateParams] {
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

export interface ActionBarProps {
  hand: HandController;
  /** `GameState.deadline` (§10.10). The ring renders against it, never a local clock. */
  deadline: number | null;
  isMyTurn: boolean;
}

export function ActionBar({ hand, deadline, isMyTurn }: ActionBarProps) {
  const t = useTranslate();
  const { playBlocker, playLabel } = hand;

  return (
    <div className="action-bar">
      {isMyTurn && <TurnTimer deadline={deadline} durationMs={TURN_DURATION_MS} size="seat" />}

      <button
        type="button"
        className="action-bar__play"
        disabled={playBlocker !== null}
        onClick={hand.play}
      >
        {playBlocker !== null
          ? t(...blockerText(playBlocker, hand.blockerParams))
          : t("ui.action.play", {
              combo: playLabel === null ? "" : t(playLabel.key, playLabel.params),
            })}
      </button>

      <button
        type="button"
        className="action-bar__pass"
        disabled={hand.passBlocker !== null}
        onClick={hand.pass}
        title={
          hand.passBlocker === null
            ? t("ui.action.pass")
            : t(...blockerText(hand.passBlocker, hand.blockerParams))
        }
      >
        {t("ui.action.pass")}
      </button>

      <button
        type="button"
        className="action-bar__sort"
        onClick={hand.toggleSort}
      >
        {/* The label is the action, not the state: it names the order a tap
            gives you, so which of the two you get is never a guess (§10.8). */}
        {t(hand.sortMode === "rank" ? "ui.action.sortBySuit" : "ui.action.sortByRank")}
      </button>
    </div>
  );
}
