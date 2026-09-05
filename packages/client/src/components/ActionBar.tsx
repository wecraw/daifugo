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
import { useTranslate, type I18nKey, type TranslateParams } from "../i18n/index";
import { TurnTimer } from "./TurnTimer";

/**
 * The reason a control is disabled, as specifically as §10.6 asks for it.
 *
 * `error.*` is the transport's vocabulary (§8.0) and has to read sensibly in the
 * `gameError` banner too, where no params travel (§8.4) — so it stays generic.
 * The one blocker with something concrete to name is the shibari lock, and the
 * client already holds the suits, so it says them here: "Must follow ♠" rather
 * than "Must follow the locked suits". `ui.*` is where that belongs — it is
 * presentation text the client owns, and nothing in core emits it (§11).
 */
function blockerText(code: ErrorCode, params: TranslateParams): [I18nKey, TranslateParams] {
  const named = code === "SUIT_LOCK_MISMATCH" && params["suits"] !== "";
  return [named ? "ui.action.mustFollowSuits" : errorKey(code), params];
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
        aria-label={t("ui.action.sortLabel")}
        onClick={hand.toggleSort}
      >
        {t(hand.sortMode === "rank" ? "ui.action.sortByRank" : "ui.action.sortBySuit")}
      </button>
    </div>
  );
}
