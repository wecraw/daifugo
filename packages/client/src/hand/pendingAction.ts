/**
 * The two interactive rules, as the player who owes one meets them (§7.2).
 *
 * A `pendingAction` halts the pipeline: nobody plays until the owed 7-pass or
 * 10-discard is submitted, and the engine refuses everything else from everyone
 * with `PENDING_ACTION_BLOCKS` (§7.1, §8.0). The rest of the table is therefore
 * inert while it is owed — but the choice itself is made **in the hand row**,
 * with the same fan, the same taps and the same drag-across as a play (§10.4).
 * A 7-pass asks "which of your cards goes"; that is the question the hand row
 * exists to answer, and a tray in a dialog made the player re-find cards they
 * were already looking at. What changes is only what the action column says: the
 * Play button becomes the submit, and Pass has nothing to do here.
 *
 * **Nothing starts selected.** The turn clock still submits the weakest `count`
 * cards for a player who never answers (§7.6), but that is the clock's fallback,
 * not a suggestion made on the player's behalf: a pre-filled selection turns
 * "choose which cards to give away" into "notice and undo a choice already made
 * for you", and the note beside the button says what expiry would do anyway — in
 * that rule's own words, because a timed-out 10 discards to the graveyard rather
 * than sending anything to another seat (§7.6).
 *
 * **The transfer can empty the hand, and that is an agari** (§7.3): playing a
 * single 7 with two cards leaves one, `k = 1`, and passing it wins the round.
 * When the action owes every card there is, there is nothing left to choose, so
 * the whole hand is selected, the row stops taking taps, and the note says what
 * is about to happen rather than offering a selection with exactly one answer.
 */
import type { PublicGameState } from "@daifugo/core";
import type { I18nKey, TranslateParams } from "../i18n/index";

/** A message ready for `t(...)`: the key, and the params it interpolates. */
export type Message = [I18nKey, TranslateParams];

export interface PendingChoice {
  /** The socket event the submission goes out on. */
  event: "submit7Pass" | "submit10Discard";
  count: number;
  /** Every card the player holds is owed: the submission is their agari (§7.3). */
  takesWholeHand: boolean;
  /** What is being asked, naming the count and — for a 7 — the seat it goes to. */
  prompt: Message;
  /** What the deadline would do instead (§7.6), or that this is the agari (§7.3). */
  note: Message;
  /** The submit button's label once the selection is complete. */
  submitLabel: Message;
}

/**
 * Whether this seat is the one a pending action is waiting on (§7.2).
 *
 * `GameTable` asks the same question to mark the rest of the table inert:
 * covering the bands with an overlay stops a finger, but not a Tab key, and the
 * leave button up there ends the player's round (§7.7).
 */
export function owesPendingAction(room: PublicGameState): boolean {
  const pending = room.pendingAction;
  if (pending === null) return false;
  const owner = pending.type === "RESOLVE_7_PASS" ? pending.sourcePlayerId : pending.playerId;
  return owner === room.myPlayerId;
}

/** The choice this seat owes, or null when it owes none. */
export function pendingChoiceOf(room: PublicGameState): PendingChoice | null {
  const pending = room.pendingAction;
  if (pending === null || !owesPendingAction(room)) return null;

  const count = pending.count;
  const takesWholeHand = count >= room.myHand.length;
  const isSevenPass = pending.type === "RESOLVE_7_PASS";
  const targetName = isSevenPass
    ? (room.players.find((seat) => seat.id === pending.targetPlayerId)?.name ?? "")
    : "";

  return {
    event: isSevenPass ? "submit7Pass" : "submit10Discard",
    count,
    takesWholeHand,
    prompt: isSevenPass
      ? ["ui.pending.sevenPass", { count, player: targetName }]
      : ["ui.pending.tenDiscard", { count }],
    note: takesWholeHand
      ? ["ui.pending.lastCards", {}]
      : [isSevenPass ? "ui.pending.timeoutPass" : "ui.pending.timeoutDiscard", { count }],
    submitLabel: isSevenPass
      ? ["ui.pending.submitPass", { count }]
      : ["ui.pending.submitDiscard", { count }],
  };
}
