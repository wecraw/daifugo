/**
 * The round-end curtain's pacing (§10.12, §10.9).
 *
 * A round ends inside the winner's own action, so the state that carries the
 * standings is the same one that empties the table — and rendering it means
 * swapping the table for the lobby in a single commit. The curtain is what stops
 * that from being a warp: the final table stays on screen and the result rises
 * over it, with the next round's one control under it.
 *
 * The pacing is a pure function here, for the same reason the rest of `animation/`
 * is: what the curtain shows needs a browser to judge, how it is timed does not.
 */
import type { PublicGameState } from "@daifugo/core";

/** The headline, before the first place lands under it. */
export const CURTAIN_ENTER_MS = 620;
/** One place per this: the order lands top-down, the way it was finished. */
export const CURTAIN_ROW_STAGGER_MS = 260;

/** The statuses a round can end *from*: only these raise a curtain. */
export function isPlayingStatus(status: PublicGameState["status"]): boolean {
  return status === "IN_PROGRESS" || status === "EXCHANGE";
}

/** The statuses the curtain covers, which are the lobby's between-round ones. */
export function isResultStatus(status: PublicGameState["status"]): boolean {
  return status === "ROUND_END" || status === "MATCH_END";
}

/** When the last place has landed, and the panel is fully readable. */
export function curtainRevealMs(room: PublicGameState): number {
  return CURTAIN_ENTER_MS + CURTAIN_ROW_STAGGER_MS * Math.max(1, room.turnOrder.length);
}
