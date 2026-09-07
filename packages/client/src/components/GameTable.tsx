/**
 * The table itself: the 844x390 landscape frame of §10.1.
 *
 * ```text
 * ┌──────────────────────────────────────────────────────────┐
 * │  [seat] [seat] [seat]        history log       [timer]   │  56px
 * │ [seat]          TRICK AREA / BANNERS          [seat]     │  218px
 * │                    [ Play ]           [ Pass ]           │
 * │              HAND (single row, fanned)                   │  116px
 * └──────────────────────────────────────────────────────────┘
 * ```
 *
 * Three fixed bands that add up to the viewport exactly, with the action bar a
 * row above the hand rather than a column beside it — which is what leaves the
 * hand the full 844px width §10.2's step formula assumes. The numbers live in
 * `layout/tableLayout.ts` and reach the stylesheet as custom properties, so the
 * arithmetic has one home and a test can check it.
 *
 * Opponents ring the table starting to the viewer's left, the direction play
 * travels, and the seat that would be the viewer's own is the hand row. Who sits
 * where is `distributeSeats`; what each chip says is `PlayerSeat`.
 *
 * The hand row and the action bar above it fill that frame (§10.2-§10.8). They
 * are one interaction — what is selected decides what the Play button says — so
 * their state is `useHandController`, held here and handed to both.
 */
import type { CSSProperties } from "react";
import { TURN_DURATION_MS, seatingOf, type Player, type PublicGameState } from "@daifugo/core";
import { miyakoOchiTarget } from "../animation/events";
import { useTableAnimations } from "../animation/useTableAnimations";
import { useSocket } from "../context/SocketContext";
import { owesPendingAction } from "../hand/pendingAction";
import { useHandController } from "../hooks/useHandController";
import { useReactions } from "../hooks/useReactions";
import { useTranslate } from "../i18n/index";
import { FAN_FLOOR_INSET, liftOverhang } from "../layout/handLayout";
import {
  distributeSeats,
  finishPositionOf,
  opponentIds,
  seatStackCapacity,
  seatStatus,
  tableCssVariables,
  type SeatEdge,
} from "../layout/tableLayout";
import { ActionBar } from "./ActionBar";
import { AnimationLayer } from "./AnimationLayer";
import { ConnectionStatus } from "./ConnectionStatus";
import { ExchangeScreen } from "./ExchangeScreen";
import { Hand } from "./Hand";
import { HistoryLog } from "./HistoryLog";
import { PlayerSeat } from "./PlayerSeat";
import { ReactionMenu } from "./ReactionMenu";
import { TrickArea } from "./TrickArea";
import { TurnTimer } from "./TurnTimer";
import { YourTurnPopup } from "./YourTurnPopup";

export function GameTable({ room }: { room: PublicGameState }) {
  const t = useTranslate();
  const { status, leaveRoom } = useSocket();

  const hand = useHandController(room);
  // Derived from the state that is already on screen (§10.9): what plays over the
  // table never gates what the table shows.
  const animations = useTableAnimations(room);
  const revolving = animations.some((animation) => animation.kind === "revolution");
  // §4.5: while the sweep runs, the demoted chip carries the reason it emptied.
  const demotedId = miyakoOchiTarget(animations);

  // Relayed rather than stored (`core/reactions.ts`): the bubbles ride beside
  // the table state, never inside it.
  const reactions = useReactions();

  const seating = seatingOf(room);
  const opponents = opponentIds(room);
  const edges = distributeSeats(opponents.length);
  const roster = new Map(room.players.map((seat) => [seat.id, seat]));
  const activeId = room.turnOrder[room.activePlayerIndex] ?? null;

  const seats = opponents.map((id, index) => ({ id, edge: edges[index] ?? "top" }));
  // Every chip fans its cards at the same step, sized off the largest hand this
  // table deals, so a fan's length reads as a count across the whole ring.
  const stackCapacity = seatStackCapacity(room.players.length);

  // Nobody is on turn outside `IN_PROGRESS`: `activePlayerIndex` still points at
  // the seat that will lead, but during `EXCHANGE` the deadline belongs to the
  // exchange and its ring is the centred one (§10.10).
  const inTurn = room.status === "IN_PROGRESS";

  // A pending action of this seat's halts everything until it is answered
  // (§7.2), so the rest of the table goes inert while it is owed — including the
  // leave button, which would otherwise end the player's round mid-action
  // (§7.7). The hand row and the action column above it are the exception: that
  // is where the choice is made (§7.2, see `hand/pendingAction.ts`).
  const blocked = owesPendingAction(room);

  // The exchange and an owed pending action are the same shape of moment: the
  // whole choice is in the player's own cards, and nothing else on the table is
  // theirs to act on. Both dim everything but the hand row (§4.3, §7.2).
  const handOnly = room.status === "EXCHANGE" || blocked;

  const renderEdge = (edge: SeatEdge) =>
    seats
      .filter((seat) => seat.edge === edge)
      .map(({ id }) => {
        const player: Player | undefined = roster.get(id);
        if (player === undefined) return null;
        return (
          <PlayerSeat
            key={id}
            player={player}
            cardCount={room.hands[id]?.cardCount ?? 0}
            status={seatStatus(id, seating)}
            finishPosition={finishPositionOf(id, room.finishedPlayerIds)}
            edge={edge}
            isActive={inTurn && id === activeId}
            demoted={id === demotedId}
            stackCapacity={stackCapacity}
            reaction={reactions[id]}
            deadline={room.deadline}
            turnDurationMs={TURN_DURATION_MS}
          />
        );
      });

  const activeName = room.players.find((seat) => seat.id === activeId)?.name ?? "";
  // Somebody else is up: the hand is covered and cannot be touched until it
  // comes back round.
  const waitingOnOther = inTurn && activeId !== null && activeId !== room.myPlayerId && !blocked;

  return (
    <div
      className="game-table"
      style={
        {
          ...tableCssVariables(),
          // The turn controls hang off the top edge of the hand row, so how far
          // a selected card lifts over that edge is how much room they need
          // above it (§10.6). The fan owns both numbers.
          "--hand-fan-floor": `${FAN_FLOOR_INSET}px`,
          "--hand-lift-clearance": `${liftOverhang()}px`,
        } as CSSProperties
      }
    >
      <div className="game-table__top" inert={blocked}>
        {/* The quick-react menu heads the strip: reachable with the left thumb
            in landscape, and clear of the seats, the log and the clock. It is
            outside the `inert` seats group only in spirit — an owed pending
            action freezes the whole strip, this included, because that moment
            belongs to the hand row (§7.2). */}
        <ReactionMenu own={reactions[room.myPlayerId]} />
        <div
          className="game-table__seats game-table__seats--top"
          aria-label={t("ui.table.opponents")}
          role="group"
        >
          {renderEdge("top")}
        </div>
        <HistoryLog room={room} />
        <div className="game-table__clock">
          {inTurn && (
            <span className="game-table__turn">
              {activeId === room.myPlayerId
                ? t("ui.table.yourTurn")
                : t("ui.table.turnOf", { player: activeName })}
            </span>
          )}
          {status !== "connected" && (
            <ConnectionStatus status={status} className="game-table__connection" />
          )}
          {inTurn && (
            <TurnTimer deadline={room.deadline} durationMs={TURN_DURATION_MS} size="strip" />
          )}
        </div>
        {/* The lobby's leave button is out of reach mid-round; §7.7 says a seat
            may go at any time, so the table keeps one of its own. */}
        <button
          type="button"
          className="game-table__leave"
          aria-label={t("ui.room.leave")}
          onClick={leaveRoom}
        >
          ×
        </button>
      </div>

      <div className="game-table__middle" inert={blocked}>
        <div
          className="game-table__seats game-table__seats--left"
          role="group"
          aria-label={t("ui.table.opponents")}
        >
          {renderEdge("left")}
        </div>
        <TrickArea room={room} />
        <div
          className="game-table__seats game-table__seats--right"
          role="group"
          aria-label={t("ui.table.opponents")}
        >
          {renderEdge("right")}
        </div>
      </div>

      {/* Under the hand row and the controls, over everything else: see
          `.table-focus`. */}
      {handOnly && <div className="table-focus" aria-hidden="true" />}

      <div className="game-table__bottom">
        {/* The exchange is a different choice from a play, over a hand that is
            not yet in a round (§4.3), so it takes the row rather than sharing
            it. */}
        {room.status === "EXCHANGE" ? (
          <ExchangeScreen room={room} />
        ) : (
          <>
            {/* Floated clear of the hand row rather than carved out of it: one
                band over the felt that says whose turn it is — the controls when
                it is yours, the wait when it is not — so nothing is ever written
                across the cards (§10.9). */}
            <section className="game-table__turn-actions" aria-label={t("ui.table.actionArea")}>
              <ActionBar
                hand={hand}
                deadline={room.deadline}
                isMyTurn={inTurn && activeId === room.myPlayerId}
              />
              {waitingOnOther && (
                <div className="turn-wait" role="status">
                  <span className="turn-wait__spinner" aria-hidden="true" />
                  <span className="turn-wait__label">
                    {t("ui.table.waitingFor", { player: activeName })}
                  </span>
                </div>
              )}
            </section>
            <section
              className={`game-table__hand${revolving ? " game-table__hand--revolution" : ""}`}
              aria-label={t("ui.table.handArea")}
            >
              {/* Off-turn the hand is covered rather than merely ignored: the
                  scrim is what says the wait is the table's, not a dead tap
                  (§10.9). It carries no text of its own — the wait is announced
                  above the row, where it is not written over the cards the
                  player is reading ahead with. */}
              <div className="game-table__hand-cards" inert={waitingOnOther}>
                <Hand hand={hand} />
              </div>
              {waitingOnOther && <div className="hand-wait" aria-hidden="true" />}
            </section>
          </>
        )}
      </div>

      {/* Over the table, never in front of it: the layer takes no pointer events
          and the state under it is already the authoritative one (§10.9). */}
      <AnimationLayer room={room} animations={animations} />

      {/* Fires off the turn itself, not off history, so it sits beside the
          animation layer rather than inside its queue (§10.9). */}
      <YourTurnPopup room={room} />
    </div>
  );
}
