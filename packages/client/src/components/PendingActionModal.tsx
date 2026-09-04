/**
 * The two interactive rules, as the player who owes one meets them (§7.2).
 *
 * A `pendingAction` halts the pipeline: nobody plays until the owed 7-pass or
 * 10-discard is submitted, and the engine refuses everything else from everyone
 * with `PENDING_ACTION_BLOCKS` (§7.1, §8.0). So this is a modal in the literal
 * sense — it covers the table while it is owed, and the hand row underneath
 * cannot be reached. The other seats need no modal: their Play button already
 * carries the reason it is disabled (§10.6).
 *
 * **The weakest `count` start selected**, because that is what the turn clock
 * submits for a player who never answers (§7.6): a timeout then plays out on
 * screen as the selection the player was already looking at.
 *
 * **The transfer can empty the hand, and that is an agari** (§7.3): playing a
 * single 7 with two cards leaves one, `k = 1`, and passing it wins the round.
 * When the action owes every card there is, there is nothing left to choose, so
 * the tray goes read-only and says what is about to happen rather than offering a
 * selection with exactly one answer.
 */
import { TURN_DURATION_MS, weakestSelection, type PublicGameState } from "@daifugo/core";
import { useSocket } from "../context/SocketContext";
import { selectionKey, timeoutNote, useCardSelection } from "../hooks/useCardSelection";
import { useTranslate } from "../i18n/index";
import { CardTray } from "./CardTray";
import { TurnTimer } from "./TurnTimer";

/**
 * Whether this seat is the one a pending action is waiting on (§7.2).
 *
 * `GameTable` asks the same question to mark the table behind the modal inert:
 * covering the bands with an overlay stops a finger, but not a Tab key, and the
 * leave button under there ends the player's round (§7.7).
 */
export function owesPendingAction(room: PublicGameState): boolean {
  const pending = room.pendingAction;
  if (pending === null) return false;
  const owner = pending.type === "RESOLVE_7_PASS" ? pending.sourcePlayerId : pending.playerId;
  return owner === room.myPlayerId;
}

export function PendingActionModal({ room }: { room: PublicGameState }) {
  const t = useTranslate();
  const { send } = useSocket();

  const pending = room.pendingAction;
  const isMine = owesPendingAction(room);
  const count = pending?.count ?? 0;
  const hand = room.myHand;

  // Every card the player holds is owed: the submission is their agari (§7.3).
  const takesWholeHand = count >= hand.length;

  const selection = useCardSelection(
    count,
    takesWholeHand ? hand.map((card) => card.id) : weakestSelection(hand, count),
    selectionKey(
      pending?.type ?? "none",
      count,
      hand.map((card) => card.id),
    ),
  );

  if (pending === null || !isMine) return null;

  const isSevenPass = pending.type === "RESOLVE_7_PASS";
  const targetName = isSevenPass
    ? (room.players.find((seat) => seat.id === pending.targetPlayerId)?.name ?? "")
    : "";
  const prompt = isSevenPass
    ? t("ui.pending.sevenPass", { count, player: targetName })
    : t("ui.pending.tenDiscard", { count });

  const submit = (): void => {
    if (!selection.complete) return;
    send(isSevenPass ? "submit7Pass" : "submit10Discard", selection.selected);
  };

  return (
    <div
      className="pending-action"
      role="dialog"
      aria-modal="true"
      aria-label={t("ui.pending.title")}
    >
      <div className="pending-action__panel">
        <header className="pending-action__header">
          <p className="pending-action__prompt">{prompt}</p>
          <TurnTimer deadline={room.deadline} durationMs={TURN_DURATION_MS} size="strip" />
        </header>

        <CardTray
          cards={hand}
          label={prompt}
          isSelected={takesWholeHand ? undefined : selection.isSelected}
          onToggle={takesWholeHand ? undefined : selection.toggle}
        />

        <footer className="pending-action__footer">
          <p className="pending-action__note">
            {takesWholeHand
              ? t("ui.pending.lastCards")
              : t(...timeoutNote(selection.isDefault, count))}
          </p>
          <button
            type="button"
            className="pending-action__submit"
            // The modal opens on the server's word, not on a click of the
            // player's, so nothing has moved focus into it yet.
            autoFocus
            disabled={!selection.complete}
            onClick={submit}
          >
            {selection.complete
              ? isSevenPass
                ? t("ui.pending.submitPass", { count })
                : t("ui.pending.submitDiscard", { count })
              : t("ui.select.more", { count: selection.missing })}
          </button>
        </footer>
      </div>
    </div>
  );
}
