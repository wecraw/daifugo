/**
 * The hand row: the fan of §10.2 in its own row, the selection of §10.4, and the
 * joker binding badge of §10.5.
 *
 * Every figure comes from `layout/handLayout.ts`, every decision from
 * `useHandController`, and the fan's DOM from `CardFan` — which the exchange
 * (§4.3) renders too, out of a different hook. What is left here is what only
 * the hand row has: the drag-across selection, the badge, and the two notices
 * the row raises over its own cards.
 *
 * * **Nothing here plays a card.** Tap selects and tap again deselects; the Play
 *   button is the only way a card reaches the table (§10.4).
 * * **A dimmed card refuses the tap, and says why.** The controller will not add
 *   a card no legal move contains, so the dark cards are inert rather than merely
 *   discouraging. The refusal raises a notice over the row for a couple of
 *   seconds, in the same words the Play button would have used (§10.4, §10.6) —
 *   keyed on the notice id so tapping the same dead card twice replays it rather
 *   than looking like the second tap did nothing at all.
 *
 * The shrinking and dimming are turn-scoped: off turn the controller reports every
 * card playable, so the row reads as a plain fan (§10.3).
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
import { AUTO_PASS_DELAY_MS, SELECTION_NOTICE_MS } from "../layout/handLayout";
import { CardFan } from "./CardFan";

export function Hand({ hand }: { hand: HandController }) {
  const t = useTranslate();

  return (
    <div className="hand">
      <CardFan
        cards={hand.cards}
        layout={hand.layout}
        {...(hand.autoPassing ? { className: "hand__fan--passing" } : {})}
        isSelected={hand.isSelected}
        isUnplayable={hand.isUnplayable}
        isDimmed={hand.isDimmed}
        isSelectable={hand.isSelectable}
        bindingOf={hand.bindingOf}
        onToggle={hand.toggle}
        onBeginDrag={hand.beginDrag}
        onExtendTo={hand.extendTo}
        onEndDrag={hand.endDrag}
        renderBadge={(card, binding) =>
          // §10.5: the badge appears only where there is a choice to make.
          card.isJoker && hand.isSelected(card.id) && hand.bindingChoices > 1 ? (
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
          ) : null
        }
      />

      {/*
        §10.4: the refused tap's answer, over the cards it was about. It sits
        where the auto-pass card does — the one place in the row nothing else
        occupies — and the two can never be up together, since a hand with no
        legal play has nothing left to refuse.
      */}
      {hand.selectionNotice !== null && (
        <p
          key={hand.selectionNotice.id}
          className="hand__notice"
          role="status"
          style={{ "--notice-duration": `${SELECTION_NOTICE_MS}ms` } as CSSProperties}
        >
          {t(hand.selectionNotice.key, hand.selectionNotice.params)}
        </p>
      )}

      {/*
        §10.7: the pass the player did not have to make still gets its beat. The
        card rises, holds, and leaves on the same 1.2s the controller waits before
        sending the pass, and the fan stands down under it — the animation is what
        stops the turn from feeling dropped, so its duration comes from the same
        constant the timer does rather than being typed twice.
      */}
      {hand.autoPassing && (
        <p
          className="hand__auto-pass"
          role="status"
          style={{ "--auto-pass-duration": `${AUTO_PASS_DELAY_MS}ms` } as CSSProperties}
        >
          {t("ui.action.autoPass")}
        </p>
      )}
    </div>
  );
}
