/**
 * The brief "your turn" flash (§10.9's eye candy, not a §10.9 animation): it
 * fires off `activePlayerIndex` becoming this seat's turn, not off history, so
 * it lives beside the other turn-derived hooks rather than in `animation/`.
 *
 * It shows only on the false→true edge. The first render never counts as an
 * edge — joining or resuming mid-turn should not flash — and it does not
 * re-fire on every render while a turn continues; only a transition does.
 */
import { useEffect, useRef, useState } from "react";
import type { PublicGameState } from "@daifugo/core";

export const YOUR_TURN_POPUP_MS = 1400;

export function useYourTurnPopup(room: PublicGameState): boolean {
  const activeId = room.turnOrder[room.activePlayerIndex] ?? null;
  const isMyTurn = room.status === "IN_PROGRESS" && activeId === room.myPlayerId;
  const previous = useRef<boolean | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const becameMyTurn = previous.current === false && isMyTurn;
    previous.current = isMyTurn;
    if (!becameMyTurn) return;

    setShow(true);
    const timer = setTimeout(() => setShow(false), YOUR_TURN_POPUP_MS);
    return () => clearTimeout(timer);
  }, [isMyTurn]);

  return show;
}
