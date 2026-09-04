/**
 * The hand row: the fan of §10.2, the selection of §10.4, and the joker binding
 * badge of §10.5.
 *
 * Every figure comes from `layout/handLayout.ts` and every decision from
 * `useHandController`; this file is the DOM they land on. Two things about that
 * DOM are load-bearing:
 *
 * * **The button is the exposed strip, not the card.** A card's visual box is
 *   64x90 and overflows its own hit target to the right, where the next card
 *   covers it. The strip is what takes the tap (§10.2), the last card's strip is
 *   its full width because nothing overlaps it, and the 6px of vertical slop is
 *   on the button rather than the card so it does not show up as a gap.
 * * **Nothing here plays a card.** Tap selects and tap again deselects; the Play
 *   button is the only way a card reaches the table (§10.4).
 *
 * Drag-across-to-select is `pointerdown` on the first card and `pointerenter` on
 * the rest, because selecting a pair is the commonest action in the game and
 * two taps for it is one too many. A drag only ever adds: the first card
 * toggles, the ones dragged across select.
 */
import type { CSSProperties } from "react";
import { JOKER_GLYPH, bindingGlyph } from "../glyphs";
import type { HandController } from "../hooks/useHandController";
import { useTranslate } from "../i18n/index";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  HIT_SLOP_Y,
  SELECTION_LIFT,
  SELECTION_SCALE,
  UNPLAYABLE_DROP,
  UNPLAYABLE_SATURATION,
  UNPLAYABLE_SCALE,
} from "../layout/handLayout";
import { CardFace } from "./CardFace";

export function Hand({ hand }: { hand: HandController }) {
  const t = useTranslate();

  return (
    <div className="hand">
      <ul className="hand__fan" style={{ width: `${hand.layout.width}px` }}>
        {hand.cards.map((card, index) => {
          const slot = hand.layout.cards[index];
          if (slot === undefined) return null;

          const selected = hand.isSelected(card.id);
          const unplayable = hand.isUnplayable(card.id);
          const dimmed = hand.isDimmed(card.id) && !selected;
          const binding = selected ? hand.bindingOf(card.id) : null;
          // Unplayable cards give up their rotation as well as their size (§10.3),
          // which is what makes the playable run read as a straight, brighter band.
          const rotation = unplayable ? 0 : slot.rotation;
          const lift =
            slot.rise + (selected ? SELECTION_LIFT : 0) - (unplayable ? UNPLAYABLE_DROP : 0);
          const scale = selected ? SELECTION_SCALE : unplayable ? UNPLAYABLE_SCALE : 1;

          return (
            <li
              key={card.id}
              className="hand__slot"
              style={{
                left: `${slot.hitLeft}px`,
                width: `${slot.hitWidth}px`,
                zIndex: selected ? slot.zIndex + hand.cards.length : slot.zIndex,
              }}
            >
              <button
                type="button"
                className={[
                  "hand__card",
                  selected ? "hand__card--selected" : "",
                  unplayable ? "hand__card--unplayable" : "",
                  dimmed ? "hand__card--dimmed" : "",
                ]
                  .filter((name) => name !== "")
                  .join(" ")}
                aria-pressed={selected}
                data-card-id={card.id}
                style={
                  {
                    height: `${CARD_HEIGHT + HIT_SLOP_Y * 2}px`,
                    top: `${-HIT_SLOP_Y}px`,
                    "--hand-hit-slop": `${HIT_SLOP_Y}px`,
                    "--card-transform": `translateY(${-lift}px) rotate(${rotation}deg) scale(${scale})`,
                    "--card-saturation": unplayable ? UNPLAYABLE_SATURATION : 1,
                  } as CSSProperties
                }
                onPointerDown={() => hand.beginDrag(card.id)}
                onPointerEnter={() => hand.extendTo(card.id)}
                onPointerUp={hand.endDrag}
                onKeyDown={(event) => {
                  // The tap is `pointerdown`, so a keyboard press has to select
                  // here rather than through a click the card does not listen for.
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  hand.toggle(card.id);
                }}
              >
                <span className="hand__card-box" style={{ width: `${CARD_WIDTH}px` }}>
                  <CardFace card={card} binding={binding ?? undefined} size="hand" />
                </span>
              </button>

              {/* §10.5: the badge appears only where there is a choice to make. */}
              {card.isJoker && selected && hand.bindingChoices > 1 && (
                <button
                  type="button"
                  className="hand__binding"
                  onClick={hand.cycleBinding}
                  title={
                    binding === null
                      ? t("ui.hand.jokerPure")
                      : t("ui.hand.jokerBinding", { binding: bindingGlyph(binding) })
                  }
                >
                  {binding === null ? JOKER_GLYPH : bindingGlyph(binding)}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* §10.7: the pass the player did not have to make still gets its beat. */}
      {hand.autoPassing && (
        <p className="hand__auto-pass" role="status">
          {t("ui.action.autoPass")}
        </p>
      )}
    </div>
  );
}
