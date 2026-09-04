/**
 * Picking exactly `count` cards out of a hand, for the two screens that ask for
 * it: the exchange (§4.3) and the pending-action modals (§7.2).
 *
 * **The default selection is what the deadline would send.** Both clocks resolve
 * an unanswered choice by taking the player's weakest `count` cards — the rich
 * side of an exchange on expiry (§4.4), and an owed 7-pass or 10-discard on the
 * turn timer (§7.6) — so that is what starts selected. A player who does nothing
 * therefore watches the cards the server is about to send, rather than a blank
 * tray followed by a transfer they never saw; the acceptance criterion of the
 * issue is exactly that the timeout shows its selection instead of looking like a
 * dropped turn.
 *
 * **The cap is enforced by swapping, not by refusing.** With `count` cards
 * already selected, tapping an unselected one drops the oldest pick instead of
 * doing nothing, because doing nothing is indistinguishable from a dead tap on a
 * pre-filled tray. Deselecting still works, so a player who wants to build a
 * selection from scratch can.
 */
import { useState } from "react";
import type { I18nKey, TranslateParams } from "../i18n/index";

export interface CardSelection {
  /** The chosen ids, oldest pick first — the order the cap swaps against. */
  selected: string[];
  isSelected: (cardId: string) => boolean;
  toggle: (cardId: string) => void;
  /** How many more cards the choice needs. Zero means it can be submitted. */
  missing: number;
  complete: boolean;
  /**
   * Whether the selection is still the untouched default — the same *set* the
   * clock would submit on its own.
   *
   * The client never sends a selection the player did not submit, so once they
   * have changed it the deadline still takes the weakest cards (§4.4, §7.6) and
   * what is on screen is a draft, not a promise. This is what lets the two
   * screens say which of the two is about to happen.
   */
  isDefault: boolean;
}

/**
 * `resetKey` identifies the choice being made: a new one starts from `initial`
 * again. It must not change while the same choice is open — the exchange bumps
 * `stateVersion` every time another player submits, and a selection that reset on
 * that would rearrange itself under the player's finger.
 */
export function useCardSelection(
  count: number,
  initial: readonly string[],
  resetKey: string,
): CardSelection {
  const [key, setKey] = useState(resetKey);
  const [selected, setSelected] = useState<string[]>(() => [...initial]);

  // Adjusting state during render is the supported way to react to a changed
  // input without rendering the stale value first; `useHandController` resets its
  // own selection the same way at turn start.
  if (key !== resetKey) {
    setKey(resetKey);
    setSelected([...initial]);
  }

  const toggle = (cardId: string): void => {
    setSelected((current) => {
      if (current.includes(cardId)) return current.filter((id) => id !== cardId);
      const next = [...current, cardId];
      return next.length <= count ? next : next.slice(next.length - count);
    });
  };

  return {
    selected,
    isSelected: (cardId) => selected.includes(cardId),
    toggle,
    missing: Math.max(0, count - selected.length),
    complete: selected.length === count,
    isDefault: sameCards(selected, initial),
  };
}

/** Set equality: which cards, not the order they were picked in. */
function sameCards(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const held = new Set(a);
  return b.every((id) => held.has(id));
}

/**
 * A key for `resetKey`: what is being chosen, out of which cards, and how many.
 *
 * The hand is part of it because the hand is what the choice is over — a 7-pass
 * that empties it is followed by a different choice, not the same one — and
 * nothing else about the room belongs in it.
 */
export function selectionKey(kind: string, count: number, cardIds: readonly string[]): string {
  return `${kind}:${count}:${cardIds.join(" ")}`;
}

/**
 * What the clock is about to do with this selection, as a key and its params.
 *
 * The default selection *is* the weakest `count` cards, so while it is untouched
 * "this selection is sent" is the literal truth. The moment the player changes
 * it, it stops being: nothing reaches the server until they submit, and both
 * deadlines take the weakest cards regardless (§4.4, §7.6). Saying so is the
 * difference between a hint and a lie.
 */
export function timeoutNote(isDefault: boolean, count: number): [I18nKey, TranslateParams] {
  return isDefault ? ["ui.select.timeout", {}] : ["ui.select.timeoutChanged", { count }];
}
