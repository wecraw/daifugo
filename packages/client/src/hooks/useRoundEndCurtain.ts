/**
 * Whether the round-end curtain is up (§10.12).
 *
 * It rises on a *transition* — a state where the round was still being played,
 * followed by one where it is over — and it stays up until the next deal. That is
 * the whole of who sees which screen between rounds: a player who just finished
 * the round watches it end and readies up from the curtain, and a player who was
 * not in it (a fresh join, or a resume into a room already between rounds, §8.1)
 * has no transition to have seen and lands in the lobby, which is the screen that
 * introduces a room rather than closing one.
 *
 * **It never delays the authoritative state.** The room behind it is already at
 * `ROUND_END` — the standings, the roles and the points are all decided — and
 * what it withholds is only the lobby's rendering of them. The one control the
 * lobby has between rounds is on the curtain too, and the way to the rest of that
 * screen (the roster, the house rules, the way out) is a link on it, so nothing is
 * unreachable while it is up.
 */
import { useEffect, useRef, useState } from "react";
import type { PublicGameState } from "@daifugo/core";
import { isPlayingStatus, isResultStatus } from "../animation/roundEnd";

export interface RoundEndCurtainState {
  /** Whether the table is still up with the result over it. */
  showing: boolean;
  /** Leave the result for the full lobby: the roster, the rules, the way out. */
  dismiss: () => void;
}

export function useRoundEndCurtain(room: PublicGameState): RoundEndCurtainState {
  const previous = useRef<PublicGameState | null>(null);
  const [raised, setRaised] = useState(false);

  useEffect(() => {
    const prev = previous.current;
    previous.current = room;
    if (prev === null) return;
    // A different room is a different table: whatever ended, this seat did not
    // watch it end.
    if (prev.roomId !== room.roomId) return;
    if (!isPlayingStatus(prev.status) || !isResultStatus(room.status)) return;
    setRaised(true);
  }, [room]);

  // The next deal takes the curtain down whatever else is true: a room that is
  // dealing again has nothing left to show, and the table under the curtain would
  // be the new one.
  return { showing: raised && isResultStatus(room.status), dismiss: () => setRaised(false) };
}
