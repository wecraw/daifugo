/**
 * The fan itself (§10.2): the geometry `layout/handLayout.ts` computed, as DOM.
 *
 * Two screens choose cards out of a hand — a play or an owed 7-pass in the hand
 * row (§10.2, §7.2), and the exchange in the row's place (§4.3) — and they are
 * the same cards in the same fan, so the DOM for it is written once, here. What
 * differs is the rules of the choice, and those stay with the callers:
 * `useHandController` for the row, `useCardSelection` for the exchange.
 *
 * Two things about this DOM are load-bearing, and were the reason to have one
 * copy of it rather than two:
 *
 * * **The button is the exposed strip, not the card.** A card's visual box is
 *   64x90 and overflows its own hit target to the right, where the next card
 *   covers it. The strip is what takes the tap (§10.2), the last card's strip is
 *   its full width because nothing overlaps it, and the 6px of vertical slop is
 *   on the button rather than the card so it does not show up as a gap. The box
 *   itself takes no pointer events at all, so a selected card's lift and growth
 *   cannot put its overflow over the neighbour's strip. Selection does not raise
 *   the slot's `z-index` either: the fan stacks left to right whatever is
 *   selected, so a selected card rises out of the fan rather than over the top
 *   of the card to its right (§10.4).
 * * **A card that cannot be picked is a list item, not a disabled button.** The
 *   read-only faces — the poor side of an exchange (§4.3), a transfer that takes
 *   the whole hand (§7.3) — have no control to press at all, which is what makes
 *   them legible to a screen reader as well as to a finger. A card that is merely
 *   *refusing* taps is different: it stays a button carrying `aria-disabled`,
 *   because a disabled button fires no pointer events and a drag has to be able
 *   to cross it (§10.4).
 */
import type { CSSProperties, ReactNode } from "react";
import type { Card, JokerBinding } from "@daifugo/core";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  HIT_SLOP_Y,
  SELECTION_LIFT,
  SELECTION_SCALE,
  UNPLAYABLE_DROP,
  UNPLAYABLE_SATURATION,
  UNPLAYABLE_SCALE,
  type HandFanLayout,
} from "../layout/handLayout";
import { CardFace } from "./CardFace";

export interface CardFanProps {
  cards: readonly Card[];
  layout: HandFanLayout;
  /** The list's accessible name, where the fan is not the hand row itself. */
  label?: string;
  /** Extra class on the fan, e.g. the auto-pass stand-down (§10.7). */
  className?: string;
  isSelected: (cardId: string) => boolean;
  /** §10.3: shrunk and desaturated, as of turn start. */
  isUnplayable?: (cardId: string) => boolean;
  /** §10.3: dark, and narrowing within the turn. */
  isDimmed?: (cardId: string) => boolean;
  /** Whether a tap would be taken. False renders `aria-disabled` (§10.4). */
  isSelectable?: (cardId: string) => boolean;
  bindingOf?: (cardId: string) => JokerBinding | null;
  /** The joker badge of §10.5, where the choice it offers exists. */
  renderBadge?: (card: Card, binding: JokerBinding | null) => ReactNode;
  /** Omitted for a read-only fan; the cards then render as plain list items. */
  onToggle?: (cardId: string) => void;
  /** Drag-across-to-select (§10.4). Without it a press is a plain toggle. */
  onBeginDrag?: (cardId: string) => void;
  onExtendTo?: (cardId: string) => void;
  onEndDrag?: () => void;
}

export function CardFan({
  cards,
  layout,
  label,
  className,
  isSelected,
  isUnplayable,
  isDimmed,
  isSelectable,
  bindingOf,
  renderBadge,
  onToggle,
  onBeginDrag,
  onExtendTo,
  onEndDrag,
}: CardFanProps) {
  return (
    <ul
      className={`hand__fan${className === undefined ? "" : ` ${className}`}`}
      style={{ width: `${layout.width}px` }}
      {...(label === undefined ? {} : { "aria-label": label })}
    >
      {cards.map((card, index) => {
        const slot = layout.cards[index];
        if (slot === undefined) return null;

        const selected = isSelected(card.id);
        const unplayable = isUnplayable?.(card.id) ?? false;
        const dimmed = (isDimmed?.(card.id) ?? false) && !selected;
        const binding = selected ? (bindingOf?.(card.id) ?? null) : null;
        // Unplayable cards give up their rotation as well as their size (§10.3),
        // which is what makes the playable run read as a straight, brighter band.
        const rotation = unplayable ? 0 : slot.rotation;
        const lift =
          slot.rise + (selected ? SELECTION_LIFT : 0) - (unplayable ? UNPLAYABLE_DROP : 0);
        const scale = selected ? SELECTION_SCALE : unplayable ? UNPLAYABLE_SCALE : 1;

        const cardClass = [
          "hand__card",
          selected ? "hand__card--selected" : "",
          unplayable ? "hand__card--unplayable" : "",
          dimmed ? "hand__card--dimmed" : "",
        ]
          .filter((name) => name !== "")
          .join(" ");
        const cardStyle = {
          height: `${CARD_HEIGHT + HIT_SLOP_Y * 2}px`,
          top: `${-HIT_SLOP_Y}px`,
          "--hand-hit-slop": `${HIT_SLOP_Y}px`,
          "--card-transform": `translateY(${-lift}px) rotate(${rotation}deg) scale(${scale})`,
          "--card-saturation": unplayable ? UNPLAYABLE_SATURATION : 1,
        } as CSSProperties;
        const face = (
          <span className="hand__card-box" style={{ width: `${CARD_WIDTH}px` }}>
            <CardFace card={card} binding={binding ?? undefined} size="hand" />
          </span>
        );

        return (
          <li
            key={card.id}
            className="hand__slot"
            style={{
              left: `${slot.hitLeft}px`,
              width: `${slot.hitWidth}px`,
              zIndex: slot.zIndex,
            }}
          >
            {onToggle === undefined ? (
              <span
                className={`${cardClass} hand__card--fixed`}
                data-card-id={card.id}
                style={cardStyle}
              >
                {face}
              </span>
            ) : (
              <button
                type="button"
                className={cardClass}
                aria-pressed={selected}
                aria-disabled={!(isSelectable?.(card.id) ?? true)}
                data-card-id={card.id}
                style={cardStyle}
                onPointerDown={(event) => {
                  // A touch implicitly captures the pointer to the element it
                  // started on, which would stop `pointerenter` reaching the
                  // cards the finger crosses — and on a phone, dragging across
                  // is how a pair gets selected (§10.4). Releasing the capture
                  // puts hit testing back on every move.
                  const target = event.currentTarget;
                  if (target.hasPointerCapture?.(event.pointerId) === true) {
                    target.releasePointerCapture(event.pointerId);
                  }
                  (onBeginDrag ?? onToggle)(card.id);
                }}
                onPointerEnter={() => onExtendTo?.(card.id)}
                onPointerUp={onEndDrag}
                onKeyDown={(event) => {
                  // The tap is `pointerdown`, so a keyboard press has to select
                  // here rather than through a click the card does not listen for.
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onToggle(card.id);
                }}
              >
                {face}
              </button>
            )}

            {renderBadge?.(card, binding) ?? null}
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
