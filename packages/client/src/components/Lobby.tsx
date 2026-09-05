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
 * **Readiness gates the deal** (§8.6). Every seat but the host readies itself with
 * `setReady`; the host's start click is their own readiness, so they get no toggle.
 * Who the deal is still waiting on comes from core's `unreadyPlayerIds` — the same
 * answer `START_GAME` checks — so the start button is disabled exactly when the
 * engine would refuse it and `PLAYERS_NOT_READY` never reaches a banner (§10.11).
 */
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  matchStandings,
  roundResults,
  unreadyPlayerIds,
  type Player,
  type PublicGameState,
  type Role,
} from "@daifugo/core";
import { useSocket } from "../context/SocketContext";
import { historyLine } from "../history";
import { useTranslate } from "../i18n/index";
import { HostPanel } from "./HostPanel";

/** The round a `startGame` would deal to (§7.7): queued joins and leaves land there. */
function rosterSize(room: PublicGameState): number {
  return room.players.length + room.pendingJoins.length - room.pendingLeaves.length;
}

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
 */
function rosterRows(room: PublicGameState): { seat: Player; pending: PendingChange }[] {
  const leaving = new Set(room.pendingLeaves);
  return [
    ...room.players.map((seat) => ({
      seat,
      pending: (leaving.has(seat.id) ? "leaving" : null) as PendingChange,
    })),
    ...room.pendingJoins.map((seat) => ({ seat, pending: "joining" as PendingChange })),
  ];
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
  // Off the same roster the deal takes, not just the seated one: a player who
  // joined mid-round waits in `pendingJoins` and readies from there (§7.7, §8.6),
  // so reading `players` alone would leave their own toggle stuck on "ready up"
  // with no way to take it back.
  const iAmReady =
    [...room.players, ...room.pendingJoins].find((seat) => seat.id === playerId)?.isReady ?? false;

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
                  <td>{nameOf(room, row.playerId)}</td>
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

      <section className="lobby__roster">
        <h2>{t("ui.lobby.roster")}</h2>
        <ul>
          {rosterRows(room).map(({ seat, pending }) => (
            <li key={seat.id}>
              <span className="lobby__name">{seat.name}</span>
              {seat.id === room.hostId && <span className="badge">{t("ui.lobby.host")}</span>}
              {seat.id === playerId && <span className="badge">{t("ui.lobby.you")}</span>}
              {/* A round boundary this promises never comes once the match is over
                  (§7.7) — a queued join/leave from just before `MATCH_END` still
                  sits in the arrays with no deal left to consume it. */}
              {pending !== null && !matchOver && (
                <span className="badge badge--quiet">
                  {t(pending === "joining" ? "ui.lobby.joining" : "ui.lobby.leaving")}
                </span>
              )}
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
