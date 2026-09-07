/**
 * The exchange phase in the hand row's place (§4.3, §4.4).
 *
 * The phase is a choice for one side of each pair and an announcement for the
 * other, so this screen has four faces and the state decides which:
 *
 * * **Rich.** Pick exactly `required` cards out of the hand and send them.
 *   Nothing starts selected, as in a 7-pass or a 10-discard (§7.6): the clock's
 *   fallback is still the weakest `required` cards (§4.4) and the note says so,
 *   but that is the clock answering for a player who never chose, not a choice
 *   made on their behalf and left sitting on the button.
 * * **Poor.** Nothing to submit. The cards were computed at phase start and are
 *   rendered read-only (§4.3); `myForcedCards` is the viewer's own copy of them,
 *   since the sanitizer sends every other seat a count (§8.5).
 * * **Submitted.** The transfer is simultaneous and applies only when the last
 *   rich player submits or the clock expires (§4.3), so a player who has chosen
 *   waits — with what they sent still on screen, which is also what a reconnect
 *   renders from `mySubmittedCards` (§8.1).
 * * **Sitting out.** The exact middle seat at odd N exchanges nothing (§4.2) and
 *   is told so, rather than shown an empty tray.
 *
 * The countdown itself is not here: it is the centred ring `TrickArea` renders
 * against `state.deadline` for the whole table (§10.10), and one clock is enough.
 *
 * The layout is the in-game one (§10.6): the tray takes the hand row, and the
 * prompt with its single primary button floats in the band above it, in the
 * place — and the shape — Play and the pending-action submit occupy the rest of
 * the round. Nothing is written across the cards, and the choice always reads as
 * the same one control in the same spot.
 *
 * The cards are the fan of §10.2, not a flat tray: this row stands in the hand
 * row's place, and a player who has spent every other phase reading their hand
 * as a fan should not have to re-find it in some other shape to give two cards
 * away. Nothing dims — any `required` cards will do (§4.3) — so the fan is
 * evenly weighted and the only state a card carries is whether it is going.
 *
 * Round 1 never reaches this screen — the engine skips straight to `IN_PROGRESS`
 * (§4.3) — so there is no round check here to drift from the one in core.
 */
import { invertedIn, trickContextOf, type PublicGameState } from "@daifugo/core";
import { useSocket } from "../context/SocketContext";
import { sortHand } from "../hand/sort";
import { selectionKey, useCardSelection } from "../hooks/useCardSelection";
import { useTranslate } from "../i18n/index";
import { layoutHand, weightOf } from "../layout/handLayout";
import { CardFan, cardsById } from "./CardFan";

export function ExchangeScreen({ room }: { room: PublicGameState }) {
  const t = useTranslate();
  const { send } = useSocket();

  const exchange = room.exchange;
  const required = exchange?.required[room.myPlayerId] ?? 0;
  const partnerId = exchange?.partner[room.myPlayerId] ?? null;
  const partnerName = room.players.find((seat) => seat.id === partnerId)?.name ?? "";
  // Rank order, as the hand row reads it (§10.8) — the tray stands in the hand
  // row's place, so it sorts the same way.
  const inverted = invertedIn(trickContextOf(room));
  const hand = sortHand(room.myHand, inverted);
  const forced = room.myForcedCards;
  const submitted = room.mySubmittedCards;
  const hasSubmitted = submitted.length > 0 || exchange?.submitted[room.myPlayerId] !== undefined;

  // Choosing is what the rich side does, so the picker only exists there — but
  // the hook runs unconditionally, on a key that is the choice itself.
  const selection = useCardSelection(
    required,
    selectionKey(
      "exchange",
      required,
      hand.map((card) => card.id),
    ),
  );

  const choosing = required > 0 && forced.length === 0 && !hasSubmitted;

  const prompt = ((): string => {
    if (required === 0) return t("ui.exchange.sitOut");
    if (forced.length > 0)
      return t("ui.exchange.forced", { count: forced.length, player: partnerName });
    if (hasSubmitted) return t("ui.exchange.sent", { player: partnerName });
    return t("ui.exchange.giveTo", { count: required, player: partnerName });
  })();

  const shown = choosing ? hand : cardsById(hand, forced.length > 0 ? forced : submitted);
  // Evenly weighted: §10.3's weighting answers "what can I play", and here every
  // card is as choosable as every other.
  const layout = layoutHand(shown.map(() => weightOf(true)));

  return (
    <>
      {/* Floated clear of the tray, where Play and the pending submit sit the
          rest of the round (§10.6). */}
      <section className="game-table__turn-actions" aria-label={t("ui.table.actionArea")}>
        <div className="action-bar action-bar--active action-bar--pending">
          <span className="action-bar__pending">
            <span className="action-bar__prompt">{prompt}</span>
            <span className="action-bar__note">
              {choosing ? t("ui.exchange.timeout", { count: required }) : t("ui.exchange.waiting")}
            </span>
          </span>
          {choosing && (
            <button
              type="button"
              className="action-bar__submit exchange__send"
              disabled={!selection.complete}
              onClick={() => send("exchangeCards", selection.selected)}
            >
              {selection.complete
                ? t("ui.exchange.send", { count: required })
                : t("ui.select.more", { count: selection.missing })}
            </button>
          )}
        </div>
      </section>

      <section className="game-table__hand exchange" aria-label={t("ui.exchange.title")}>
        {shown.length > 0 && (
          <div className="hand">
            <CardFan
              cards={shown}
              layout={layout}
              label={prompt}
              isSelected={choosing ? selection.isSelected : () => false}
              {...(choosing ? { onToggle: selection.toggle } : {})}
            />
          </div>
        )}
      </section>
    </>
  );
}
