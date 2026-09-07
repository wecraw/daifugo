/** Celebrate the instant the round gets its first finisher — its new Daifugo. */
import type { PublicGameState } from "@daifugo/core";
import confetti from "canvas-confetti";
import { useEffect, useRef } from "react";

interface CrowningSnapshot {
  roomId: string;
  roundNumber: number;
  finishers: number;
}

export function useDaifugoCrowning(room: PublicGameState): void {
  const previous = useRef<CrowningSnapshot | null>(null);

  useEffect(() => {
    const current: CrowningSnapshot = {
      roomId: room.roomId,
      roundNumber: room.roundNumber,
      finishers: room.finishedPlayerIds.length,
    };
    const prev = previous.current;
    previous.current = current;

    // An initial state may be a reconnect into an active or completed round.
    // Only a live 0 -> non-zero transition crowns somebody on this client.
    if (prev === null) return;
    if (prev.roomId !== current.roomId || prev.roundNumber !== current.roundNumber) return;
    if (prev.finishers !== 0 || current.finishers === 0) return;

    void confetti({
      particleCount: 120,
      spread: 100,
      startVelocity: 45,
      origin: { y: 0.45 },
      colors: ["#e8b64c", "#f5f3ee", "#d84b3e", "#2f80c9"],
      disableForReducedMotion: true,
      zIndex: 1000,
    });
  }, [room]);
}
