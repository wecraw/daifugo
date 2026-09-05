/**
 * What a seated player sees: whichever screen the room's status calls for.
 *
 * `LOBBY`, `ROUND_END` and `MATCH_END` are the lobby (§9, §10.11) — the roster
 * before the first deal, and the standings between rounds. `EXCHANGE` and
 * `IN_PROGRESS` are the table (§10.1).
 *
 * **The lobby gets a header; the table does not.** §10.1 budgets all 390px of a
 * landscape viewport to the table's three bands, so a room-code strip above it
 * would push the hand row off the screen. The room code and persistent connection
 * state therefore belong to the lobby. The table uses its existing clock cell for
 * exceptional connection states and carries the one control that cannot wait for
 * the next round boundary — leaving (§7.7).
 *
 * It renders from `PublicGameState` — already redacted for this seat (§8.5) — so
 * every screen below reads the same input.
 */
import type { PublicGameState } from "@daifugo/core";
import { useSocket } from "../context/SocketContext";
import { useTranslate } from "../i18n/index";
import { ConnectionStatus } from "./ConnectionStatus";
import { GameTable } from "./GameTable";
import { Lobby } from "./Lobby";

/** The statuses the lobby owns: before the first deal, and between rounds. */
function inLobby(room: PublicGameState): boolean {
  return room.status === "LOBBY" || room.status === "ROUND_END" || room.status === "MATCH_END";
}

export function RoomShell({ room }: { room: PublicGameState }) {
  const t = useTranslate();
  const { status, leaveRoom } = useSocket();

  if (!inLobby(room)) return <GameTable room={room} />;

  return (
    <div className="room-shell">
      <header className="room-shell__header">
        <h1>{t("ui.room.code", { code: room.roomId })}</h1>
        <ConnectionStatus status={status} className="room-shell__status" />
        <span className="room-shell__status">
          {t("ui.room.players", { count: room.players.length })}
        </span>
      </header>

      <Lobby room={room} />

      <button type="button" className="room-shell__leave" onClick={leaveRoom}>
        {t("ui.room.leave")}
      </button>
    </div>
  );
}
