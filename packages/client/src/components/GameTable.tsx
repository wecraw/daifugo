/**
 * The table itself: the 844x390 landscape frame of §10.1.
 *
 * ```text
 * ┌──────────────────────────────────────────────────────────┐
 * │  [seat] [seat] [seat]        history log       [timer]   │  56px
 * │ [seat]          TRICK AREA / BANNERS          [seat]     │  218px
 * │              HAND (single row, fanned)          [ACTION] │  116px
 * └──────────────────────────────────────────────────────────┘
 * ```
 *
 * Three fixed bands that add up to the viewport exactly, with the action column
 * on the right edge of the hand row rather than a bottom bar — which is what
 * leaves the hand the `W ≈ 780` §10.2's step formula assumes. The numbers live in
 * `layout/tableLayout.ts` and reach the stylesheet as custom properties, so the
 * arithmetic has one home and a test can check it.
 *
 * Opponents ring the table starting to the viewer's left, the direction play
 * travels, and the seat that would be the viewer's own is the hand row. Who sits
 * where is `distributeSeats`; what each chip says is `PlayerSeat`.
 *
 * The hand row and the action column fill that frame (§10.2-§10.8). They are one
 * interaction — what is selected decides what the Play button says — so their
 * state is `useHandController`, held here and handed to both.
 */
import type { CSSProperties } from "react";
import { TURN_DURATION_MS, seatingOf, type Player, type PublicGameState } from "@daifugo/core";
import { useSocket } from "../context/SocketContext";
import { useHandController } from "../hooks/useHandController";
import { useTranslate } from "../i18n/index";
import {
  distributeSeats,
  finishPositionOf,
  opponentIds,
  seatStatus,
  tableCssVariables,
  type SeatEdge,
} from "../layout/tableLayout";
import { ActionBar } from "./ActionBar";
import { ExchangeScreen } from "./ExchangeScreen";
import { Hand } from "./Hand";
import { PendingActionModal, owesPendingAction } from "./PendingActionModal";
import { HistoryLog } from "./HistoryLog";
import { PlayerSeat } from "./PlayerSeat";
import { TrickArea } from "./TrickArea";
import { TurnTimer } from "./TurnTimer";

export function GameTable({ room }: { room: PublicGameState }) {
  const t = useTranslate();
  const { leaveRoom } = useSocket();

  const hand = useHandController(room);

  const seating = seatingOf(room);
  const opponents = opponentIds(room);
  const edges = distributeSeats(opponents.length);
  const roster = new Map(room.players.map((seat) => [seat.id, seat]));
  const activeId = room.turnOrder[room.activePlayerIndex] ?? null;

  const seats = opponents.map((id, index) => ({ id, edge: edges[index] ?? "top" }));

  // Nobody is on turn outside `IN_PROGRESS`: `activePlayerIndex` still points at
  // the seat that will lead, but during `EXCHANGE` the deadline belongs to the
  // exchange and its ring is the centred one (§10.10).
  const inTurn = room.status === "IN_PROGRESS";

  // A pending action of this seat's halts everything until it is answered
  // (§7.2), so the table behind its modal is inert rather than merely covered:
  // an overlay stops a finger, but a Tab key would still reach the hand, the
  // sort toggle, and the leave button that ends the player's round (§7.7).
  const blocked = owesPendingAction(room);

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
            deadline={room.deadline}
            turnDurationMs={TURN_DURATION_MS}
          />
        );
      });

  const activeName = room.players.find((seat) => seat.id === activeId)?.name ?? "";

  return (
    <div className="game-table" style={tableCssVariables() as CSSProperties}>
      <div className="game-table__top" inert={blocked}>
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
            <>
              <span className="game-table__turn">
                {activeId === room.myPlayerId
                  ? t("ui.table.yourTurn")
                  : t("ui.table.turnOf", { player: activeName })}
              </span>
              <TurnTimer deadline={room.deadline} durationMs={TURN_DURATION_MS} size="strip" />
            </>
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

      <div className="game-table__bottom" inert={blocked}>
        {/* The exchange is a different choice from a play, over a hand that is
            not yet in a round (§4.3), so it takes the row rather than sharing
            it. */}
        {room.status === "EXCHANGE" ? (
          <ExchangeScreen room={room} />
        ) : (
          <>
            <section className="game-table__hand" aria-label={t("ui.table.handArea")}>
              <Hand hand={hand} />
            </section>
            <section className="game-table__action" aria-label={t("ui.table.actionArea")}>
              <ActionBar
                hand={hand}
                deadline={room.deadline}
                isMyTurn={inTurn && activeId === room.myPlayerId}
              />
            </section>
          </>
        )}
      </div>

      {/* Owed by this seat, it covers the table until it is answered (§7.2). */}
      <PendingActionModal room={room} />
    </div>
  );
}
