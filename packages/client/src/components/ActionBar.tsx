/**
 * The action column of §10.6: Play, Pass, and the turn ring.
 *
 * The Play button names the play from the *resolved* combo — "Play Pair of 8s",
 * "Play Four 3s" (§5.4, §10.6) — and when the selection cannot be played it is
 * disabled with the reason on it. The reason is an `error.*` code from the same
 * evaluator the server validates with (§8.0), so what the button says is what the
 * server would have said, and nothing the player could have seen coming ever
 * arrives as a `gameError` banner (§8.4). The refused-tap notice over the hand
 * (§10.4) is the same judgement in the same words — both go through
 * `hand/blockerText.ts` — raised where the tap was rather than at the top of the
 * screen.
 *
 * Pass is disabled the same way rather than sent and refused, which is the rule
 * §10.11 already applies to the host panel: `CANNOT_PASS_AS_LEADER` is not a
 * banner, it is a greyed button that says you have to play.
 *
 * The ring here is the player's own turn clock, so it shows only on their turn;
 * the strip's ring (§10.1) is the table's, and counts down for whoever is up.
 *
 * **An owed 7-pass or 10-discard takes the column over (§7.2).** The selection
 * for it is made in the hand row like any other (see `hand/pendingAction.ts`), so
 * what changes here is the buttons: the submit replaces Play, Pass has nothing to
 * do while the pipeline is halted, and the prompt sits beside them because the
 * player has to be told what the count is for and what the clock will do if they
 * never answer (§7.6).
 */
import { TURN_DURATION_MS } from "@daifugo/core";
import { blockerText } from "../hand/blockerText";
import type { HandController } from "../hooks/useHandController";
import { useTranslate } from "../i18n/index";
import { TurnTimer } from "./TurnTimer";

export interface ActionBarProps {
  hand: HandController;
  /** `GameState.deadline` (§10.10). The ring renders against it, never a local clock. */
  deadline: number | null;
  isMyTurn: boolean;
}

export function ActionBar({ hand, deadline, isMyTurn }: ActionBarProps) {
  const t = useTranslate();
  const { pending } = hand;
  // The action is owed by this seat whether or not the turn is nominally theirs,
  // and nothing else can happen until it is answered (§7.1).
  const active = pending !== null || isMyTurn;

  return (
    // Off-turn the row is not merely disabled, it is gone: nothing here is
    // actionable while somebody else is up (§10.9), and the hand's own scrim is
    // already saying so. It fades rather than cuts so the turn arriving reads as
    // the controls coming to you. `inert` keeps the faded-out buttons out of the
    // tab order and the a11y tree, which `opacity: 0` alone would not.
    <div
      className={`action-bar${active ? " action-bar--active" : ""}${
        pending !== null ? " action-bar--pending" : ""
      }`}
      inert={!active}
    >
      {active && <TurnTimer deadline={deadline} durationMs={TURN_DURATION_MS} size="seat" />}

      {pending !== null ? (
        <>
          <span className="action-bar__pending">
            <span className="action-bar__prompt">{t(...pending.prompt)}</span>
            <span className="action-bar__note">{t(...pending.note)}</span>
          </span>
          <button
            type="button"
            className="action-bar__submit"
            disabled={!pending.complete}
            onClick={pending.submit}
          >
            {pending.complete
              ? t(...pending.submitLabel)
              : t("ui.select.more", { count: pending.missing })}
          </button>
        </>
      ) : (
        <PlayAndPass hand={hand} />
      )}
    </div>
  );
}

function PlayAndPass({ hand }: { hand: HandController }) {
  const t = useTranslate();
  const { playBlocker, playLabel } = hand;

  return (
    <>
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
    </>
  );
}
