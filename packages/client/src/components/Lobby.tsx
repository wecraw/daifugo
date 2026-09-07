import { PlayerIcon } from "./PlayerIcon";
/**
 * The lobby (§9, §10.11): the roster before the first deal, and the standings
 * between rounds.
 *
 * **The standings order comes from core.** Between rounds, `roundResults` is
 * `finishOrderOf` followed by `assignRoles` (§4.1) — everyone who went out, then
 * whoever was still holding cards, then the `droppedPlayerIds` bottom block —
 * and the rows are rendered in exactly that order. The client never re-derives a
 * finish order from points or seats: a miyako-ochi demotion (§4.5) and a
 * mid-round leave (§7.7) both land in that bottom block whatever the hand held,
 * and only core knows where.
 *
 * At `MATCH_END` the table instead orders by `matchStandings` — cumulative
 * points descending (§9) — since that is the ranking the match actually ended
 * on, not the last round's finish order. The role shown per row is still each
 * seat's role from that final round (`Player.role`), just reordered by points.
 *
 * That is also why a demoted player reads as `DAI_HINMIN` on `0` points while
 * still holding a full hand. The `history.miyakoOchi` line is surfaced beside the
 * table so the zero explains itself rather than looking like a scoring bug.
 *
 * **Readiness gates the deal** (§8.6), and the control that answers it is
 * `NextRoundActions` — shared with the round-end curtain (§10.12), which is where
 * a player who just finished the round readies up instead.
 *
 * **The roster is a table with chairs.** Below `MIN_PLAYERS` the list is padded out
 * with open seats, so a table that cannot be dealt says so by looking short rather
 * than only by the note under a disabled button. Past the minimum one open seat
 * remains until `MAX_PLAYERS`, so a room with space left never reads as full.
 *
 * **Layout is the landscape split of the main menu** (§0: landscape only). The left
 * rail carries what the room *is* — the join code to read aloud, the round, the
 * house rules, the way out — and the right column carries the table: who is in it,
 * and the one action this seat can take.
 */
import { useState } from "react";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  matchStandings,
  roundResults,
  type Player,
  type PublicGameState,
  type Role,
} from "@daifugo/core";
import { useSocket } from "../context/SocketContext";
import { historyLine } from "../history";
import { useTranslate } from "../i18n/index";
import { ConnectionStatus } from "./ConnectionStatus";
import { HostPanel } from "./HostPanel";
import { NextRoundActions, rosterSize } from "./NextRoundActions";

/** Where a row stands relative to the next deal, or null for a settled seat. */
type PendingChange = "joining" | "leaving" | null;

/**
 * The roster the *deal* would take, which is not the seated one (§7.7).
 *
 * A join outside `LOBBY` — and the between-round lobby is outside it — queues in
 * `pendingJoins` rather than taking a seat, and §8.6 counts that player for
 * readiness. Listing `players` alone therefore leaves the start button held for
 * someone who is nowhere on screen, and leaves the newcomer looking at a roster
 * without their own name in it. A queued leave is the mirror: the seat is still
 * in `players` but the next round will not deal it in.
 *
 * The order is seated first, arrivals after, which is the order they will hold
 * once the boundary applies.
 *
 * A seat that is *both* queued to leave and disconnected is dropped from the list
 * entirely: that is the shape of a grace expiry (§8.3), and the only reason the
 * seat still exists in state is so the sleeping browser's token can reclaim it
 * (§8.1). Drawing it as a row makes a table that cannot be dealt look full — the
 * host reads three names and a note saying they need three players — because the
 * row is a chair nobody counts. The one who queued their own leave and is still
 * connected keeps their row: "leaving after this round" is news.
 */
function rosterRows(room: PublicGameState): { seat: Player; pending: PendingChange }[] {
  const leaving = new Set(room.pendingLeaves);
  const gone = (seat: Player): boolean => leaving.has(seat.id) && !seat.isConnected;
  return [
    ...room.players
      .filter((seat) => !gone(seat))
      .map((seat) => ({
        seat,
        pending: (leaving.has(seat.id) ? "leaving" : null) as PendingChange,
      })),
    ...room.pendingJoins
      .filter((seat) => !gone(seat))
      .map((seat) => ({
        seat,
        pending: "joining" as PendingChange,
      })),
  ];
}

export function Lobby({ room }: { room: PublicGameState }) {
  const t = useTranslate();
  const { playerId, status, leaveRoom } = useSocket();
  const [copied, setCopied] = useState(false);

  const betweenRounds = room.status === "ROUND_END" || room.status === "MATCH_END";
  const matchOver = room.status === "MATCH_END";
  const size = rosterSize(room);

  // The room code is already in the URL (the client route joins it on load), so
  // the current location is the whole invite — nothing to build server-side.
  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ url });
      } catch {
        // A cancelled share sheet is not an error worth surfacing.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied — nothing more to offer than the room code
      // already on screen.
    }
  };

  // The demotion of the round just ended (§4.5). Read off the redacted history
  // this seat already has; `miyakoOchi` names a count, never a card, so every seat
  // sees the same line (§8.5).
  const miyakoOchi = miyakoOchiThisRound(room);

  const standingsRows = matchOver
    ? matchStandings(room).map((standing) => ({
        playerId: standing.playerId,
        role: roleOf(room, standing.playerId),
        points: standing.points,
      }))
    : roundResults(room).map((result) => ({
        playerId: result.playerId,
        role: result.role as Role | null,
        points: room.points[result.playerId] ?? 0,
      }));

  const seats = rosterRows(room);
  // The chairs nobody is in yet. Short of the minimum, enough of them to show
  // how far the table is from dealable; past it, exactly one — a table with room
  // left should never read as closed, and eight dotted rows would be decoration.
  // At `MAX_PLAYERS` there is genuinely nothing to sit in, so the padding stops.
  const openSeats = size >= MAX_PLAYERS ? 0 : Math.max(1, MIN_PLAYERS - size);

  return (
    <div className="lobby">
      <div className="lobby__rail">
        <div className="lobby__identity">
          <h1 className="lobby__code">
            <span className="lobby__code-label">{t("ui.room.codeLabel")}</span>{" "}
            <span className="lobby__code-value">{room.roomId}</span>
          </h1>
          <button type="button" className="lobby__share" onClick={handleShare}>
            {copied ? t("ui.room.linkCopied") : t("ui.room.share")}
          </button>
          <hr className="lobby__rule" />
          <p className="lobby__round">
            {room.roundLimit === null
              ? t("ui.lobby.round", { round: room.roundNumber })
              : t("ui.lobby.roundOfLimit", { round: room.roundNumber, limit: room.roundLimit })}
          </p>
        </div>

        {betweenRounds && (
          <section className="lobby__standings" aria-label={t("ui.standings.title")}>
            <table>
              <caption>
                {matchOver
                  ? t("ui.standings.matchResult")
                  : t("ui.standings.roundRoles", { round: room.roundNumber })}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t("ui.standings.position")}</th>
                  <th scope="col">{t("ui.standings.player")}</th>
                  <th scope="col">{t("ui.standings.role")}</th>
                  <th scope="col">{t("ui.standings.points")}</th>
                </tr>
              </thead>
              <tbody>
                {standingsRows.map((row, index) => (
                  <tr key={row.playerId}>
                    <td>{index + 1}</td>
                    <td>
                      <PlayerIcon
                        icon={room.players.find((seat) => seat.id === row.playerId)?.icon}
                      />
                      {nameOf(room, row.playerId)}
                    </td>
                    <td>{row.role === null ? "" : t(`role.${row.role.kind}`)}</td>
                    <td>{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {miyakoOchi !== undefined && (
              <p className="lobby__miyako-ochi">{historyLine(t, miyakoOchi, room.players)}</p>
            )}
          </section>
        )}

        <HostPanel room={room} />
      </div>

      <section className="lobby__roster">
        <h2>{t("ui.lobby.roster")}</h2>
        <ul>
          {seats.map(({ seat, pending }, index) => (
            <li
              key={seat.id}
              className={[
                "seat-row",
                seat.id === playerId ? "seat-row--me" : "",
                seat.isConnected ? "" : "seat-row--offline",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="seat-row__index">{index + 1}</span>
              <PlayerIcon icon={seat.icon} />
              <span className="lobby__name">{seat.name}</span>
              {seat.id === room.hostId && (
                <span className="badge badge--host">{t("ui.lobby.host")}</span>
              )}
              {seat.id === playerId && (
                <span className="badge badge--you">{t("ui.lobby.you")}</span>
              )}
              {/* A round boundary this promises never comes once the match is over
                  (§7.7) — a queued join/leave from just before `MATCH_END` still
                  sits in the arrays with no deal left to consume it. */}
              {pending !== null && !matchOver && (
                <span className="badge badge--quiet">
                  {t(pending === "joining" ? "ui.lobby.joining" : "ui.lobby.leaving")}
                </span>
              )}
              <span className="seat-row__state">
                {/* A seat that is simply connected says nothing: on a full table
                    that chip repeated itself once per row and carried no news. */}
                {!seat.isConnected && (
                  <span className="seat-row__offline">{t("ui.lobby.disconnected")}</span>
                )}
                {seat.isReady && <span className="seat-row__ready">{t("ui.lobby.ready")}</span>}
              </span>
            </li>
          ))}
          {Array.from({ length: openSeats }, (_, index) => (
            <li key={`open-${index}`} className="seat-row seat-row--open">
              <span className="seat-row__index">{seats.length + index + 1}</span>
              <span className="seat-row__open">{t("ui.lobby.openSeat")}</span>
            </li>
          ))}
        </ul>

        <div className="lobby__actions">
          <NextRoundActions room={room} />
        </div>
      </section>

      <div className="lobby__exit">
        <button type="button" className="lobby__leave" onClick={leaveRoom}>
          {t("ui.room.leave")}
        </button>
        <ConnectionStatus status={status} className="lobby__connection" />
      </div>
    </div>
  );
}

/**
 * This round's miyako-ochi entry, or `undefined` if the round just ended had none.
 *
 * `history` spans the whole match, so the reverse scan stops at this round's
 * `history.roundStarted` — the same bound core's own `demotedThisRound` uses.
 * Without it, one demotion in round 2 would keep explaining a zero beside every
 * later round's standings.
 */
function miyakoOchiThisRound(
  room: PublicGameState,
): PublicGameState["history"][number] | undefined {
  for (let index = room.history.length - 1; index >= 0; index--) {
    const entry = room.history[index];
    if (entry === undefined || entry.key === "history.roundStarted") return undefined;
    if (entry.key === "history.miyakoOchi") return entry;
  }
  return undefined;
}

function nameOf(room: PublicGameState, id: string): string {
  return room.players.find((seat) => seat.id === id)?.name ?? id;
}

/** A seat's role from the round that just ended, for the `MATCH_END` table. */
function roleOf(room: PublicGameState, id: string): Role | null {
  return room.players.find((seat) => seat.id === id)?.role ?? null;
}
