/**
 * The exchange phase in the hand row's place (§4.3, §4.4).
 *
 * The phase is a choice for one side of each pair and an announcement for the
 * other, so this screen has four faces and the state decides which:
 *
 * * **Rich.** Pick exactly `required` cards out of the hand and send them. The
 *   weakest `required` start selected, because that is what the deadline sends
 *   for a player who never chooses (§4.4) — the timeout then shows its own
 *   selection rather than looking like a dropped turn.
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
 * Round 1 never reaches this screen — the engine skips straight to `IN_PROGRESS`
 * (§4.3) — so there is no round check here to drift from the one in core.
 */
import { weakestSelection, type PublicGameState } from "@daifugo/core";
import { useSocket } from "../context/SocketContext";
import { selectionKey, useCardSelection } from "../hooks/useCardSelection";
import { useTranslate } from "../i18n/index";
import { CardTray, cardsById } from "./CardTray";

export function ExchangeScreen({ room }: { room: PublicGameState }) {
  const t = useTranslate();
  const { send } = useSocket();

  const exchange = room.exchange;
  const required = exchange?.required[room.myPlayerId] ?? 0;
  const partnerId = exchange?.partner[room.myPlayerId] ?? null;
  const partnerName = room.players.find((seat) => seat.id === partnerId)?.name ?? "";
  const forced = room.myForcedCards;
  const submitted = room.mySubmittedCards;
  const hasSubmitted = submitted.length > 0 || exchange?.submitted[room.myPlayerId] !== undefined;

  // Choosing is what the rich side does, so the picker only exists there — but
  // the hook runs unconditionally, on a key that is the choice itself.
  const selection = useCardSelection(
    required,
    weakestSelection(room.myHand, required),
    selectionKey(
      "exchange",
      required,
      room.myHand.map((card) => card.id),
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

  const shown = choosing
    ? room.myHand
    : cardsById(room.myHand, forced.length > 0 ? forced : submitted);

  return (
    <>
      <section className="game-table__hand exchange" aria-label={t("ui.exchange.title")}>
        <p className="exchange__prompt">{prompt}</p>
        {shown.length > 0 && (
          <CardTray
            cards={shown}
            label={prompt}
            isSelected={choosing ? selection.isSelected : undefined}
            onToggle={choosing ? selection.toggle : undefined}
          />
        )}
      </section>

      <section className="game-table__action" aria-label={t("ui.table.actionArea")}>
        {choosing ? (
          <>
            <button
              type="button"
              className="exchange__send"
              disabled={!selection.complete}
              onClick={() => send("exchangeCards", selection.selected)}
            >
              {selection.complete
                ? t("ui.exchange.send", { count: required })
                : t("ui.select.more", { count: selection.missing })}
            </button>
            <p className="exchange__note">{t("ui.select.timeout")}</p>
          </>
        ) : (
          <p className="exchange__note">{t("ui.exchange.waiting")}</p>
        )}
      </section>
    </>
  );
}
