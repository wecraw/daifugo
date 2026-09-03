/**
 * The lobby (§9, §10.11): the roster before the first deal, and the standings
 * between rounds.
 *
 * **The standings order comes from core.** `roundResults` is `finishOrderOf`
 * followed by `assignRoles` (§4.1) — everyone who went out, then whoever was
 * still holding cards, then the `droppedPlayerIds` bottom block — and the rows
 * are rendered in exactly that order. The client never re-derives a finish order
 * from points or seats: a miyako-ochi demotion (§4.5) and a mid-round leave
 * (§7.7) both land in that bottom block whatever the hand held, and only core
 * knows where.
 *
 * That is also why a demoted player reads as `DAI_HINMIN` on `0` points while
 * still holding a full hand. The `history.miyakoOchi` line is surfaced beside the
 * table so the zero explains itself rather than looking like a scoring bug.
 *
 * **Readiness gates the deal** (§8.6). Every seat but the host readies itself with
 * `setReady`; the host's start click is their own readiness, so they get no toggle.
 * Who the deal is still waiting on comes from core's `unreadyPlayerIds` — the same
 * answer `START_GAME` checks — so the start button is disabled exactly when the
 * engine would refuse it and `PLAYERS_NOT_READY` never reaches a banner (§10.11).
 */
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  roundResults,
  unreadyPlayerIds,
  type PublicGameState,
} from "@daifugo/core";
import { useSocket } from "../context/SocketContext";
import { historyLine } from "../history";
import { useTranslate } from "../i18n/index";
import { HostPanel } from "./HostPanel";

/** The round a `startGame` would deal to (§7.7): queued joins and leaves land there. */
function rosterSize(room: PublicGameState): number {
  return room.players.length + room.pendingJoins.length - room.pendingLeaves.length;
}

export function Lobby({ room }: { room: PublicGameState }) {
  const t = useTranslate();
  const { playerId, send } = useSocket();

  const isHost = room.hostId === playerId;
  const betweenRounds = room.status === "ROUND_END" || room.status === "MATCH_END";
  const matchOver = room.status === "MATCH_END";
  const size = rosterSize(room);
  const tooFew = size < MIN_PLAYERS;
  const tooMany = size > MAX_PLAYERS;
  // §8.6, asked of core rather than re-derived: the host is exempt and so is a
  // disconnected seat, and only the engine should be deciding either.
  const waitingOn = matchOver ? [] : unreadyPlayerIds(room);
  const iAmReady = room.players.find((seat) => seat.id === playerId)?.isReady ?? false;

  // The last demotion of the round just ended (§4.5). Read off the redacted
  // history this seat already has; `miyakoOchi` names a count, never a card, so
  // every seat sees the same line (§8.5).
  const miyakoOchi = [...room.history]
    .reverse()
    .find((entry) => entry.key === "history.miyakoOchi");

  return (
    <div className="lobby">
      <p className="lobby__round">
        {room.roundLimit === null
          ? t("ui.lobby.round", { round: room.roundNumber })
          : t("ui.lobby.roundOfLimit", { round: room.roundNumber, limit: room.roundLimit })}
      </p>

      {betweenRounds && (
        <section className="lobby__standings">
          <h2>{t("ui.standings.title")}</h2>
          <table>
            <caption>{t("ui.standings.roundRoles", { round: room.roundNumber })}</caption>
            <thead>
              <tr>
                <th scope="col">{t("ui.standings.position")}</th>
                <th scope="col">{t("ui.standings.player")}</th>
                <th scope="col">{t("ui.standings.role")}</th>
                <th scope="col">{t("ui.standings.points")}</th>
              </tr>
            </thead>
            <tbody>
              {roundResults(room).map((result, index) => (
                <tr key={result.playerId}>
                  <td>{index + 1}</td>
                  <td>{nameOf(room, result.playerId)}</td>
                  <td>{t(`role.${result.role.kind}`)}</td>
                  <td>{room.points[result.playerId] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {miyakoOchi !== undefined && (
            <p className="lobby__miyako-ochi">{historyLine(t, miyakoOchi, room.players)}</p>
          )}
        </section>
      )}

      <section className="lobby__roster">
        <h2>{t("ui.lobby.roster")}</h2>
        <ul>
          {room.players.map((seat) => (
            <li key={seat.id}>
              <span className="lobby__name">{seat.name}</span>
              {seat.id === room.hostId && <span className="badge">{t("ui.lobby.host")}</span>}
              {seat.id === playerId && <span className="badge">{t("ui.lobby.you")}</span>}
              {seat.isReady && <span className="badge">{t("ui.lobby.ready")}</span>}
              <span className={seat.isConnected ? "badge badge--quiet" : "badge badge--warn"}>
                {t(seat.isConnected ? "ui.lobby.connected" : "ui.lobby.disconnected")}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <HostPanel room={room} />

      <div className="lobby__actions">
        {matchOver && <p className="lobby__note">{t("ui.lobby.matchOver")}</p>}
        {!matchOver && isHost && (
          <button
            type="button"
            disabled={tooFew || tooMany || waitingOn.length > 0}
            onClick={() => send("startGame")}
          >
            {t(betweenRounds ? "ui.lobby.nextRound" : "ui.lobby.start")}
          </button>
        )}
        {!matchOver && !isHost && (
          <button type="button" onClick={() => send("setReady", !iAmReady)}>
            {t(iAmReady ? "ui.lobby.unready" : "ui.lobby.readyUp")}
          </button>
        )}
        {!matchOver && !isHost && <p className="lobby__note">{t("ui.lobby.waitingForHost")}</p>}
        {!matchOver && isHost && !tooFew && !tooMany && waitingOn.length > 0 && (
          <p className="lobby__note">
            {t("ui.lobby.waitingForReady", { count: waitingOn.length })}
          </p>
        )}
        {!matchOver && isHost && tooFew && (
          <p className="lobby__note">{t("ui.lobby.needMorePlayers", { min: MIN_PLAYERS })}</p>
        )}
        {!matchOver && isHost && tooMany && (
          <p className="lobby__note">{t("ui.lobby.tooManyPlayers", { max: MAX_PLAYERS })}</p>
        )}
      </div>
    </div>
  );
}

function nameOf(room: PublicGameState, id: string): string {
  return room.players.find((seat) => seat.id === id)?.name ?? id;
}
