import { PlayerIcon } from "./PlayerIcon";
/**
 * The round-end curtain (§10.12): the result, drawn over the table it was won on.
 *
 * A round ends inside somebody's last play, so without this the winning card and
 * the lobby are one commit apart — the table the round was decided on is gone
 * before anyone has looked at it. The curtain keeps that table on screen and
 * raises the standings over it: the headline, then the places landing one at a
 * time in the order they finished, then the way on.
 *
 * **The order comes from core, exactly as the lobby's does.** `roundResults` is
 * `finishOrderOf` followed by `assignRoles` (§4.1) and `roundPoints` scores that
 * same order (§9); at `MATCH_END` the ranking is `matchStandings` instead, since
 * that is what the match ended on. The client never re-derives a finish order — a
 * miyako-ochi demotion (§4.5) and a mid-round leave (§7.7) both land in the
 * bottom block whatever the hand held, and only core knows where.
 *
 * **It is the between-round screen for anyone who was in the round**, not a banner
 * on the way to one: it stays up until the next deal, and the one control the
 * lobby offers between rounds — ready up, or deal — is on it. The rest of that
 * screen is a link away, because the host may want the house rules (§10.11) and
 * anyone may want out (§7.7); a newcomer who never saw the round end gets the
 * lobby itself (§10.12).
 *
 * **It is drawn over an already-correct state.** Everything here is read out of
 * the `PublicGameState` the lobby would render from, and leaving it changes
 * nothing about the room. It is `role="dialog"` and takes the focus, because
 * while it is up it *is* the screen.
 */
import {
  matchStandings,
  roundPoints,
  roundResults,
  type PublicGameState,
  type Role,
} from "@daifugo/core";
import { useEffect, useRef } from "react";
import { CURTAIN_ENTER_MS, CURTAIN_ROW_STAGGER_MS } from "../animation/roundEnd";
import { useTranslate } from "../i18n/index";
import { NextRoundActions } from "./NextRoundActions";
import { ProfileEditor } from "./ProfileEditor";

/** One line of the curtain: where a seat placed, and what it earned for it. */
interface Place {
  playerId: string;
  role: Role | null;
  /** Points this round put on the board. Zero for the bottom of the table. */
  gained: number;
  /** Points across the match so far (§9), which is what the lobby ranks on. */
  total: number;
}

function places(room: PublicGameState): Place[] {
  const results = roundResults(room);
  const gained = roundPoints(results.map((result) => result.playerId));
  const total = (playerId: string): number => room.points[playerId] ?? 0;

  if (room.status !== "MATCH_END") {
    return results.map((result) => ({
      playerId: result.playerId,
      role: result.role,
      gained: gained[result.playerId] ?? 0,
      total: total(result.playerId),
    }));
  }
  return matchStandings(room).map((standing) => ({
    playerId: standing.playerId,
    role: room.players.find((seat) => seat.id === standing.playerId)?.role ?? null,
    gained: gained[standing.playerId] ?? 0,
    total: standing.points,
  }));
}

function nameOf(room: PublicGameState, playerId: string): string {
  return room.players.find((seat) => seat.id === playerId)?.name ?? playerId;
}

export function RoundEndCurtain({
  room,
  onDismiss,
}: {
  room: PublicGameState;
  onDismiss: () => void;
}) {
  const t = useTranslate();
  const panel = useRef<HTMLDivElement>(null);
  const rows = places(room);
  const matchOver = room.status === "MATCH_END";
  const winner = rows[0];

  // The table behind is inert while this is up, so the focus has nowhere sensible
  // to have stayed — the card that was just played, most likely, which no longer
  // exists. The panel takes it rather than the ready button, so readying up is
  // never one stray Return away.
  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <div
      className="round-end"
      role="dialog"
      aria-modal="true"
      aria-label={t(matchOver ? "ui.roundEnd.matchTitle" : "ui.roundEnd.title")}
    >
      <div className="round-end__panel" ref={panel} tabIndex={-1}>
        <p className="round-end__eyebrow">
          {matchOver
            ? t("ui.roundEnd.matchTitle")
            : t("ui.roundEnd.roundLabel", { round: room.roundNumber })}
        </p>
        {winner !== undefined && (
          <h2 className="round-end__headline">
            {t(matchOver ? "ui.roundEnd.matchWinner" : "ui.roundEnd.winner", {
              player: nameOf(room, winner.playerId),
            })}
          </h2>
        )}

        <ol className="round-end__places">
          {rows.map((row, index) => (
            <li
              key={row.playerId}
              className={
                row.playerId === room.myPlayerId
                  ? "round-end__place round-end__place--me"
                  : "round-end__place"
              }
              style={{ animationDelay: `${CURTAIN_ENTER_MS + index * CURTAIN_ROW_STAGGER_MS}ms` }}
            >
              <span className="round-end__rank">{index + 1}</span>
              <span
                className={
                  row.playerId === room.myPlayerId
                    ? "round-end__player round-end__player--editable"
                    : "round-end__player"
                }
              >
                <PlayerIcon icon={room.players.find((seat) => seat.id === row.playerId)?.icon} />
                {nameOf(room, row.playerId)}
                {row.playerId === room.myPlayerId && (
                  <ProfileEditor
                    name={nameOf(room, row.playerId)}
                    icon={room.players.find((seat) => seat.id === row.playerId)?.icon}
                    takenNames={[...room.players, ...room.pendingJoins]
                      .filter((seat) => seat.id !== row.playerId)
                      .map((seat) => seat.name)}
                    disabled={
                      room.players.find((seat) => seat.id === row.playerId)?.isConnected === false
                    }
                  />
                )}
              </span>
              <span className="round-end__role">
                {row.role === null ? "" : t(`role.${row.role.kind}`)}
              </span>
              <span className="round-end__gained">
                {t("ui.roundEnd.gained", { points: row.gained })}
              </span>
              <span className="round-end__total">
                {t("ui.roundEnd.total", { points: row.total })}
              </span>
            </li>
          ))}
        </ol>

        <div className="round-end__actions ready-controls">
          <NextRoundActions room={room} />
        </div>

        {/* The rest of the lobby is one link away: the roster, the house rules
            (§10.11), and the way out (§7.7). */}
        <button type="button" className="round-end__lobby" onClick={onDismiss}>
          {t(matchOver ? "ui.roundEnd.finalStandings" : "ui.roundEnd.viewLobby")}
        </button>
      </div>
    </div>
  );
}
