/**
 * The animation queue: what is currently playing over the table (§10.9).
 *
 * Two rules from #20's acceptance shape all of this.
 *
 * **Animations never delay the authoritative state.** Nothing is queued *before*
 * a render: the effect runs after React has already painted the new state, and
 * what it adds is decoration on top of a table that is correct without it. A
 * state arriving mid-animation is rendered at once and simply gains a second
 * animation over the first.
 *
 * **Animations never block input past their duration.** Each entry leaves the
 * queue on a timer of exactly its own delay plus duration, so a dropped socket, a
 * backgrounded tab, or an animation the browser never actually painted cannot
 * leave a banner on screen: the timer is what removes it, not the transition.
 * (The layer that renders them takes no pointer events at all, so they do not
 * block input *during* their duration either.)
 *
 * An entry with a delay — only miyako-ochi has one (§4.5) — is *added* when its
 * delay elapses rather than rendered invisibly until then, so the queue is
 * exactly what is on screen at any moment and anything reading it, such as the
 * demoted seat's own badge, is in step with the animation without a second clock.
 */
import { useEffect, useRef, useState } from "react";
import type { PublicGameState } from "@daifugo/core";
import { animationEndsAt, deriveTableAnimations, type TableAnimation } from "./events";

export function useTableAnimations(room: PublicGameState): TableAnimation[] {
  const previous = useRef<PublicGameState | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [active, setActive] = useState<TableAnimation[]>([]);

  useEffect(() => {
    const prev = previous.current;
    previous.current = room;
    // The first state a seat sees is the whole room at once — a join or a resume
    // (§8.1). There is no delta to animate, only a table to draw.
    if (prev === null) return;

    const derived = deriveTableAnimations(prev, room);
    if (derived.length === 0) return;

    const immediate = derived.filter((animation) => animation.delayMs === 0);
    if (immediate.length > 0) setActive((current) => [...current, ...immediate]);

    for (const animation of derived) {
      if (animation.delayMs > 0) {
        timers.current.push(
          setTimeout(() => {
            setActive((current) => [...current, animation]);
          }, animation.delayMs),
        );
      }
      timers.current.push(
        setTimeout(() => {
          setActive((current) => current.filter((entry) => entry.id !== animation.id));
        }, animationEndsAt(animation)),
      );
    }
  }, [room]);

  // Cleared on unmount only: clearing them when `room` changes would strand every
  // animation still playing, which is precisely the "blocks input past its
  // duration" failure this hook exists to prevent.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.length = 0;
    };
  }, []);

  return active;
}
