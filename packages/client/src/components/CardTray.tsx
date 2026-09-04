/**
 * A flat row of cards to pick from — or to be shown, when there is nothing to
 * pick.
 *
 * The exchange and the pending-action modals both put a subset of the hand in
 * front of the player, and one of them is read-only by rule: the poor side of an
 * exchange has its cards chosen for it (§4.3), and a transfer that empties the
 * hand takes every card there is (§7.3). So "read-only" here is not a disabled
 * button — it is a list item, with no control to press at all, which is what
 * makes the difference legible to a screen reader as well as to a finger.
 *
 * This is not the hand row of §10.2: no fan, no weighted layout, no dimming.
 * Those exist to answer "what can I play", and none of these choices has a
 * legality to compute — any `count` cards will do.
 */
import type { Card } from "@daifugo/core";
import { CardFace } from "./CardFace";

export interface CardTrayProps {
  cards: readonly Card[];
  /** The region's accessible name. */
  label: string;
  isSelected?: (cardId: string) => boolean;
  /** Omitted for a read-only tray; the cards then render as list items. */
  onToggle?: (cardId: string) => void;
}

export function CardTray({ cards, label, isSelected, onToggle }: CardTrayProps) {
  return (
    <ul className="card-tray" aria-label={label}>
      {cards.map((card) => {
        const selected = isSelected?.(card.id) ?? false;
        if (onToggle === undefined) {
          return (
            <li
              key={card.id}
              className="card-tray__card card-tray__card--fixed"
              data-card-id={card.id}
            >
              <CardFace card={card} size="hand" />
            </li>
          );
        }
        return (
          <li key={card.id}>
            <button
              type="button"
              className={`card-tray__card${selected ? " card-tray__card--selected" : ""}`}
              aria-pressed={selected}
              data-card-id={card.id}
              onClick={() => onToggle(card.id)}
            >
              <CardFace card={card} size="hand" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The cards of `hand` named by `cardIds`, in the order the ids were given. */
export function cardsById(hand: readonly Card[], cardIds: readonly string[]): Card[] {
  return cardIds.flatMap((id) => {
    const card = hand.find((each) => each.id === id);
    return card === undefined ? [] : [card];
  });
}
