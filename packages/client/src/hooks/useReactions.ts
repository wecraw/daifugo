/**
 * The reactions currently on screen, one per seat.
 *
 * A reaction is relayed, not stored (`core/reactions.ts`): it arrives on its own
 * socket event and lives here for {@link REACTION_LIFETIME_MS} before it fades.
 * That is deliberate — it never enters `PublicGameState`, so it costs no
 * `stateVersion` bump and a player who was looking away has missed nothing that
 * matters.
 *
 * One bubble per seat: a second reaction from the same player replaces the first
 * rather than stacking, so a fast thumb cannot bury the table under speech
 * bubbles. `nonce` is what makes the replacement re-animate even when the same
 * reaction is sent twice.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactionId } from "@daifugo/core";
import { useSocket } from "../context/SocketContext";

/** How long a bubble stays up. Long enough to read across the table, short
 *  enough that it is gone before the next trick. */
export const REACTION_LIFETIME_MS = 3500;

export interface ActiveReaction {
  reaction: ReactionId;
  /** Bumped on every arrival, so a repeat of the same reaction re-animates. */
  nonce: number;
}

export type ActiveReactions = Readonly<Record<string, ActiveReaction>>;

export function useReactions(): ActiveReactions {
  const { subscribe } = useSocket();
  const [active, setActive] = useState<ActiveReactions>({});
  // One pending expiry per seat, cleared when it is replaced or the view goes.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const nonce = useRef(0);

  useEffect(() => {
    const pending = timers.current;
    const stop = subscribe("reaction", ({ playerId, reaction }) => {
      nonce.current += 1;
      setActive((current) => ({ ...current, [playerId]: { reaction, nonce: nonce.current } }));
      const existing = pending.get(playerId);
      if (existing !== undefined) clearTimeout(existing);
      pending.set(
        playerId,
        setTimeout(() => {
          pending.delete(playerId);
          setActive((current) => {
            const next = { ...current };
            delete next[playerId];
            return next;
          });
        }, REACTION_LIFETIME_MS),
      );
    });
    return () => {
      stop();
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, [subscribe]);

  return active;
}
